import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../src/agents/agent-scope.js";
import { readConfigFileSnapshot } from "../../src/config/config.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "../../src/gateway/auth.js";
import { sendGatewayAuthFailure, sendMethodNotAllowed } from "../../src/gateway/http-common.js";
import { getBearerToken } from "../../src/gateway/http-utils.js";
import { isLoopbackAddress, resolveRequestClientIp } from "../../src/gateway/net.js";
import { checkBrowserOrigin } from "../../src/gateway/origin-check.js";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "../../src/infra/http-body.js";
import { PowerFsService } from "./fs-service.js";

export const POWER_FS_UPLOAD_HTTP_PATH = "/api/power/fs/upload";
export const POWER_FS_DOWNLOAD_HTTP_PATH = "/api/power/fs/download";

const POWER_FS_TRANSFER_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const POWER_FS_DOWNLOAD_FORM_MAX_BYTES = 64 * 1024;
const POWER_FS_UPLOAD_ALLOW_METHODS = "POST, OPTIONS";
const POWER_FS_UPLOAD_ALLOW_HEADERS_DEFAULT = "Authorization, Content-Type";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function normalizeRelativePath(value: unknown): string {
  const raw = (typeof value === "string" ? value : "").trim().replaceAll("\\", "/");
  if (!raw || raw === ".") {
    return "";
  }
  if (raw.startsWith("/") || path.win32.isAbsolute(raw)) {
    throw new Error("absolute paths are not allowed");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized === "") {
    return "";
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("path escapes workspace");
  }
  return normalized.replace(/^\.\/+/, "");
}

function normalizeFileName(value: unknown): string {
  const name = (typeof value === "string" ? value : "").trim();
  if (!name) {
    throw new Error("file name is required");
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("invalid file name");
  }
  return name;
}

function ensurePathInsideRoot(rootDir: string, targetPath: string): string {
  const resolved = path.resolve(rootDir, targetPath);
  const relative = path.relative(rootDir, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("path escapes workspace");
  }
  return resolved;
}

function buildContentDisposition(fileName: string): string {
  const asciiFallback =
    fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function trimOptionalFormValue(value: string | null): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

async function resolveWorkspaceForAgent(agentIdRaw: unknown) {
  const agentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  if (!agentId) {
    throw new Error("agentId required");
  }
  const cfg = (await readConfigFileSnapshot()).config;
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspaceDir?.trim()) {
    throw new Error(`No workspace configured for agent: ${agentId}`);
  }
  return {
    agentId,
    workspaceDir,
  };
}

async function resolveParentForWrite(rootDir: string, relPath: string) {
  const requestedPath = ensurePathInsideRoot(rootDir, relPath);
  const parentPath = path.dirname(requestedPath);
  const parentReal = await fsp.realpath(parentPath);
  ensurePathInsideRoot(rootDir, path.relative(rootDir, parentReal));
  const stat = await fsp.lstat(parentReal);
  if (stat.isSymbolicLink()) {
    throw new Error("symlink paths are not allowed");
  }
  return requestedPath;
}

async function resolveExistingFile(rootDir: string, relPath: string) {
  const requestedPath = ensurePathInsideRoot(rootDir, relPath || ".");
  const lstat = await fsp.lstat(requestedPath);
  if (lstat.isSymbolicLink()) {
    throw new Error("symlink paths are not allowed");
  }
  const realPath = await fsp.realpath(requestedPath);
  ensurePathInsideRoot(rootDir, path.relative(rootDir, realPath));
  const stat = await fsp.stat(realPath);
  if (!stat.isFile()) {
    throw new Error("path is not a file");
  }
  return {
    path: realPath,
    stat,
    name: path.basename(realPath),
  };
}

async function authorizePowerFsRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  auth: ResolvedGatewayAuth;
  token?: string;
  password?: string;
}) {
  const token = params.token?.trim() || undefined;
  const password = params.password?.trim() || token;
  const authResult = await authorizeHttpGatewayConnect({
    auth: params.auth,
    connectAuth: token || password ? { token, password } : null,
    req: params.req,
    browserOriginPolicy: {
      requestHost: Array.isArray(params.req.headers.host)
        ? params.req.headers.host[0]
        : params.req.headers.host,
      origin: Array.isArray(params.req.headers.origin)
        ? params.req.headers.origin[0]
        : params.req.headers.origin,
      allowHostHeaderOriginFallback: true,
    },
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(params.res, authResult);
    return false;
  }
  return true;
}

function resolveAllowedUploadOrigin(req: IncomingMessage): string | null {
  const origin = (req.headers.origin ?? "").trim();
  if (!origin || origin === "null") {
    return null;
  }
  const clientIp = resolveRequestClientIp(req, [], false);
  const check = checkBrowserOrigin({
    requestHost: Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host,
    origin,
    allowHostHeaderOriginFallback: true,
    isLocalClient: isLoopbackAddress(clientIp),
  });
  return check.ok ? origin : null;
}

function applyUploadCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = resolveAllowedUploadOrigin(req);
  if (!origin) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", POWER_FS_UPLOAD_ALLOW_METHODS);
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ?? POWER_FS_UPLOAD_ALLOW_HEADERS_DEFAULT,
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

async function readDownloadRequest(req: IncomingMessage): Promise<{
  agentId?: string;
  path?: string;
  token?: string;
  password?: string;
}> {
  if ((req.method ?? "GET").toUpperCase() === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    return {
      agentId: trimOptionalFormValue(url.searchParams.get("agentId")),
      path: trimOptionalFormValue(url.searchParams.get("path")),
      token: trimOptionalFormValue(url.searchParams.get("token")),
      password: trimOptionalFormValue(url.searchParams.get("password")),
    };
  }

  const raw = await readRequestBodyWithLimit(req, {
    maxBytes: POWER_FS_DOWNLOAD_FORM_MAX_BYTES,
    encoding: "utf-8",
  });
  const form = new URLSearchParams(raw);
  return {
    agentId: trimOptionalFormValue(form.get("agentId")),
    path: trimOptionalFormValue(form.get("path")),
    token: trimOptionalFormValue(form.get("token")),
    password: trimOptionalFormValue(form.get("password")),
  };
}

export function createPowerFsHttpHandler(params: {
  auth: ResolvedGatewayAuth;
  fsService: PowerFsService;
}) {
  const { auth, fsService } = params;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === POWER_FS_UPLOAD_HTTP_PATH) {
      applyUploadCorsHeaders(req, res);
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (method !== "POST") {
        sendMethodNotAllowed(res, "POST, OPTIONS");
        return true;
      }

      const bearerToken = getBearerToken(req);
      const token = trimOptionalFormValue(url.searchParams.get("token")) || bearerToken;
      const password = trimOptionalFormValue(url.searchParams.get("password"));
      if (!(await authorizePowerFsRequest({ req, res, auth, token, password }))) {
        return true;
      }

      try {
        const agentId = trimOptionalFormValue(url.searchParams.get("agentId"));
        const requestedPath = normalizeRelativePath(url.searchParams.get("path"));
        const fileName = normalizeFileName(url.searchParams.get("name"));
        const { workspaceDir } = await resolveWorkspaceForAgent(agentId);
        const targetPath = await resolveParentForWrite(
          workspaceDir,
          requestedPath ? `${requestedPath}/${fileName}` : fileName,
        );
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await new Promise<void>((resolve, reject) => {
          const stream = fs.createWriteStream(targetPath, { flags: "w" });
          let written = 0;
          const fail = (error: Error) => {
            stream.destroy();
            void fsp.unlink(targetPath).catch(() => {});
            reject(error);
          };
          req.on("data", (chunk: Buffer | string) => {
            const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
            written += size;
            if (written > POWER_FS_TRANSFER_MAX_BYTES) {
              fail(new Error("payload too large"));
              return;
            }
            if (!stream.write(chunk)) {
              req.pause();
              stream.once("drain", () => req.resume());
            }
          });
          req.on("end", () => stream.end());
          req.on("error", (error) =>
            fail(error instanceof Error ? error : new Error(String(error))),
          );
          stream.on("finish", () => resolve());
          stream.on("error", (error) =>
            fail(error instanceof Error ? error : new Error(String(error))),
          );
        });

        const fileInfo = fsService.statWorkspaceFile(workspaceDir, targetPath);
        const entry = {
          name: fileInfo.name,
          path: fileInfo.path,
          kind: "file" as const,
          size: fileInfo.size,
          updatedAtMs: fileInfo.updatedAtMs,
        };
        sendJson(res, 200, {
          ok: true,
          entry,
          requestId: randomUUID(),
        });
      } catch (error) {
        if (isRequestBodyLimitError(error)) {
          sendJson(res, 413, { ok: false, error: requestBodyErrorToText(error.code) });
          return true;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, message === "payload too large" ? 413 : 400, { ok: false, error: message });
      }
      return true;
    }

    if (url.pathname === POWER_FS_DOWNLOAD_HTTP_PATH) {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") {
        sendMethodNotAllowed(res, "GET, POST");
        return true;
      }

      try {
        const payload = await readDownloadRequest(req);
        const bearerToken = getBearerToken(req);
        const token = payload.token || bearerToken;
        if (
          !(await authorizePowerFsRequest({
            req,
            res,
            auth,
            token,
            password: payload.password,
          }))
        ) {
          return true;
        }

        const normalizedPath = normalizeRelativePath(payload.path);
        const { workspaceDir } = await resolveWorkspaceForAgent(payload.agentId);
        const file = await resolveExistingFile(workspaceDir, normalizedPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(file.stat.size));
        res.setHeader("Content-Disposition", buildContentDisposition(file.name));
        fs.createReadStream(file.path).pipe(res);
      } catch (error) {
        if (isRequestBodyLimitError(error)) {
          sendJson(res, 413, { ok: false, error: requestBodyErrorToText(error.code) });
          return true;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { ok: false, error: message });
      }
      return true;
    }

    return false;
  };
}
