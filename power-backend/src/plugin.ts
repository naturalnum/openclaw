import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveAgentWorkspaceDir } from "../../src/agents/agent-scope.js";
import { loadConfig } from "../../src/config/config.js";
import { authorizeHttpGatewayConnect, resolveGatewayAuth } from "../../src/gateway/auth.js";
import { readRequestBodyWithLimit } from "../../src/infra/http-body.js";
import { requestBodyErrorToText, isRequestBodyLimitError } from "../../src/infra/http-body.js";
import { PowerFsDownloadTicketStore } from "./download-ticket.js";
import { PowerFsService } from "./fs-service.js";

type PowerBackendPluginConfig = {
  roots: string[];
};

const POWER_FS_UPLOAD_HTTP_PATH = "/plugins/power-backend/fs/upload";
const POWER_FS_DOWNLOAD_HTTP_PATH = "/plugins/power-backend/fs/download";
const POWER_FS_TRANSFER_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const POWER_FS_DOWNLOAD_FORM_MAX_BYTES = 64 * 1024;
const POWER_FS_DOWNLOAD_TICKET_TTL_MS = 60 * 1000;

function parsePluginConfig(api: OpenClawPluginApi): PowerBackendPluginConfig {
  const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};

  const roots = Array.isArray(raw.roots)
    ? raw.roots
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => api.resolvePath(entry))
    : [];

  return { roots };
}

function sendError(respond: GatewayRequestHandlerOptions["respond"], error: unknown) {
  respond(false, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function getCorsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== "string") {
    return null;
  }
  const trimmed = origin.trim();
  return trimmed || null;
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = getCorsOrigin(req);
  if (!origin) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    String(req.headers["access-control-request-headers"] ?? "Authorization, Content-Type"),
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

async function authorizePowerFsHttpRequest(
  req: IncomingMessage,
  token?: string,
  password?: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const cfg = loadConfig();
  const resolvedAuth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
  });
  const result = await authorizeHttpGatewayConnect({
    auth: resolvedAuth,
    connectAuth: token || password ? { token, password } : null,
    req,
    trustedProxies: cfg.gateway?.trustedProxies ?? [],
    allowRealIpFallback: cfg.gateway?.allowRealIpFallback === true,
  });
  if (result.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    status: result.rateLimited ? 429 : 401,
    body: {
      ok: false,
      error: result.reason ?? "unauthorized",
      retryAfterMs: result.retryAfterMs,
    },
  };
}

function parseBearerToken(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || undefined;
}

function trimQueryValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildContentDisposition(fileName: string): string {
  const asciiFallback =
    fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function resolveWorkspaceForAgent(agentIdRaw: unknown) {
  const agentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  if (!agentId) {
    throw new Error("agentId required");
  }
  const cfg = loadConfig();
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspace?.trim()) {
    throw new Error(`No workspace configured for agent: ${agentId}`);
  }
  return {
    agentId,
    workspace,
  };
}

export default function register(api: OpenClawPluginApi) {
  const config = parsePluginConfig(api);
  const fsService = new PowerFsService(config);
  const downloadTicketStore = new PowerFsDownloadTicketStore(POWER_FS_DOWNLOAD_TICKET_TTL_MS);

  api.registerHttpRoute({
    path: POWER_FS_UPLOAD_HTTP_PATH,
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      applyCors(req, res);
      if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return true;
      }
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendText(res, 405, "Method Not Allowed");
        return true;
      }
      const url = new URL(req.url ?? POWER_FS_UPLOAD_HTTP_PATH, "http://localhost");
      const agentId = trimQueryValue(url.searchParams.get("agentId"));
      const currentPath = trimQueryValue(url.searchParams.get("path")) ?? null;
      const name = trimQueryValue(url.searchParams.get("name"));
      if (!agentId || !name) {
        sendJson(res, 400, { ok: false, error: "agentId and name are required" });
        return true;
      }
      const auth = await authorizePowerFsHttpRequest(
        req,
        parseBearerToken(req),
        parseBearerToken(req),
      );
      if (!auth.ok) {
        sendJson(res, auth.status, auth.body);
        return true;
      }
      try {
        const { workspace } = resolveWorkspaceForAgent(agentId);
        const targetPath = fsService.resolveWorkspaceUploadPath(workspace, currentPath, name);
        const tempPath = path.join(
          path.dirname(targetPath),
          `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.upload.tmp`,
        );
        const contentLength = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
        if (Number.isFinite(contentLength) && contentLength > POWER_FS_TRANSFER_MAX_BYTES) {
          sendJson(res, 413, { ok: false, error: "file exceeds 10GB upload limit" });
          return true;
        }
        let totalBytes = 0;
        const handle = await fsp.open(tempPath, "wx", 0o600);
        let handleClosed = false;
        let tempExists = true;
        try {
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buffer.byteLength;
            if (totalBytes > POWER_FS_TRANSFER_MAX_BYTES) {
              sendJson(res, 413, { ok: false, error: "file exceeds 10GB upload limit" });
              return true;
            }
            await handle.write(buffer);
          }
          await handle.close();
          handleClosed = true;
          await fsp.rename(tempPath, targetPath);
          tempExists = false;
          const stats = await fsp.stat(targetPath);
          sendJson(res, 200, {
            ok: true,
            entry: {
              name,
              path: targetPath,
              kind: "file",
              size: stats.size,
              updatedAtMs: Math.floor(stats.mtimeMs),
            },
          });
          return true;
        } finally {
          if (!handleClosed) {
            await handle.close().catch(() => {});
          }
          if (tempExists) {
            await fsp.rm(tempPath, { force: true }).catch(() => {});
          }
        }
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  api.registerHttpRoute({
    path: POWER_FS_DOWNLOAD_HTTP_PATH,
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      applyCors(req, res);
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (method !== "GET" && method !== "POST") {
        sendText(res, 405, "Method Not Allowed");
        return true;
      }
      try {
        let url = new URL(req.url ?? POWER_FS_DOWNLOAD_HTTP_PATH, "http://localhost");
        let agentId = trimQueryValue(url.searchParams.get("agentId"));
        let filePath = trimQueryValue(url.searchParams.get("path"));
        let ticket = trimQueryValue(url.searchParams.get("ticket"));
        let token = trimQueryValue(url.searchParams.get("token")) ?? parseBearerToken(req);
        let password = trimQueryValue(url.searchParams.get("password"));
        if (method === "POST") {
          const raw = await readRequestBodyWithLimit(req, {
            maxBytes: POWER_FS_DOWNLOAD_FORM_MAX_BYTES,
            encoding: "utf-8",
          });
          const form = new URLSearchParams(raw);
          agentId = trimQueryValue(form.get("agentId")) ?? agentId;
          filePath = trimQueryValue(form.get("path")) ?? filePath;
          ticket = trimQueryValue(form.get("ticket")) ?? ticket;
          token = trimQueryValue(form.get("token")) ?? token;
          password = trimQueryValue(form.get("password")) ?? password;
        }
        if (ticket) {
          const ticketRecord = downloadTicketStore.consume(ticket);
          if (!ticketRecord) {
            sendJson(res, 401, { ok: false, error: "invalid_or_expired_ticket" });
            return true;
          }
          agentId = ticketRecord.agentId;
          filePath = ticketRecord.filePath;
        } else {
          if (!agentId || !filePath) {
            sendJson(res, 400, { ok: false, error: "agentId and path are required" });
            return true;
          }
          const auth = await authorizePowerFsHttpRequest(req, token, password);
          if (!auth.ok) {
            sendJson(res, auth.status, auth.body);
            return true;
          }
        }
        const { workspace } = resolveWorkspaceForAgent(agentId);
        const info = fsService.statWorkspaceFile(workspace, filePath);
        if (info.size > POWER_FS_TRANSFER_MAX_BYTES) {
          sendJson(res, 413, { ok: false, error: "file exceeds 10GB download limit" });
          return true;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(info.size));
        res.setHeader("Content-Disposition", buildContentDisposition(info.name));
        const stream = fs.createReadStream(info.path);
        stream.on("error", (error) => {
          if (!res.headersSent) {
            sendJson(res, 500, { ok: false, error: error.message });
            return;
          }
          res.destroy(error);
        });
        stream.pipe(res);
        return true;
      } catch (error) {
        if (isRequestBodyLimitError(error)) {
          sendJson(res, error.statusCode, { ok: false, error: requestBodyErrorToText(error.code) });
          return true;
        }
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  api.registerGatewayMethod("power.fs.roots", async ({ respond }: GatewayRequestHandlerOptions) => {
    try {
      respond(true, fsService.listRoots());
    } catch (error) {
      sendError(respond, error);
    }
  });

  api.registerGatewayMethod(
    "power.fs.listDirs",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, fsService.listDirs(requestedPath || null));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.validateWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        respond(true, fsService.validateWorkspace(requestedPath));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createDir",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        respond(true, {
          ok: true,
          entry: fsService.createDirectory(requestedPath, name),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.listWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, {
          agentId,
          workspace,
          ...fsService.listWorkspaceEntries(workspace, requestedPath || null),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createFolder",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        const entry = fsService.createWorkspaceDirectory(workspace, currentPath || null, name);
        respond(true, { ok: true, agentId, workspace, entry });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.uploadFiles",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const files = Array.isArray(params?.files) ? params.files : [];
        if (files.length === 0) {
          respond(false, { error: "files required" });
          return;
        }
        const entries = files.map((file) => {
          const name = typeof file?.name === "string" ? file.name.trim() : "";
          const contentBase64 =
            typeof file?.contentBase64 === "string" ? file.contentBase64.trim() : "";
          if (!name || !contentBase64) {
            throw new Error("Each upload file requires name and contentBase64.");
          }
          return fsService.writeWorkspaceFile(workspace, currentPath || null, name, contentBase64);
        });
        respond(true, { ok: true, agentId, workspace, entries });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createDownloadTicket",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const filePath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!filePath) {
          respond(false, { error: "path required" });
          return;
        }
        const info = fsService.statWorkspaceFile(workspace, filePath);
        if (info.size > POWER_FS_TRANSFER_MAX_BYTES) {
          respond(false, { error: "file exceeds 10GB download limit" });
          return;
        }
        const ticket = downloadTicketStore.issue(agentId, filePath);
        respond(true, {
          ok: true,
          agentId,
          path: filePath,
          routePath: POWER_FS_DOWNLOAD_HTTP_PATH,
          ticket: ticket.ticket,
          expiresAtMs: ticket.expiresAtMs,
          fileName: info.name,
          size: info.size,
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.downloadFile",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const filePath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!filePath) {
          respond(false, { error: "path required" });
          return;
        }
        const file = fsService.readWorkspaceFile(workspace, filePath);
        respond(true, { agentId, workspace, file });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.deleteEntry",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const targetPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!targetPath) {
          respond(false, { error: "path required" });
          return;
        }
        const result = fsService.deleteWorkspaceEntry(workspace, targetPath);
        respond(true, { agentId, workspace, ...result });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.logger.info(
    `[power-backend] registered power.fs methods with ${fsService.listRoots().roots.length} allowed roots`,
  );
}
