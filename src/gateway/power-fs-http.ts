import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "../infra/http-body.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { sendGatewayAuthFailure, sendMethodNotAllowed } from "./http-common.js";
import { isLoopbackAddress, resolveRequestClientIp } from "./net.js";
import { checkBrowserOrigin } from "./origin-check.js";

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
  const raw = String(typeof value === "string" ? value : "")
    .trim()
    .replaceAll("\\", "/");
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
  const name = String(typeof value === "string" ? value : "").trim();
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

function trimOptionalFormValue(value: string | null): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function resolveWorkspaceForAgent(agentIdRaw: unknown) {
  const agentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  if (!agentId) {
    throw new Error("agentId required");
  }
  const cfg = loadConfig();
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
  auth: ResolvedGatewayAuth;
  token?: string;
  password?: string;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  rateLimiter?: AuthRateLimiter;
}) {
  const token = params.token?.trim() || undefined;
  const password = params.password?.trim() || token;
  return authorizeHttpGatewayConnect({
    auth: params.auth,
    connectAuth: token || password ? { token, password } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    allowRealIpFallback: params.allowRealIpFallback,
    rateLimiter: params.rateLimiter,
  });
}

function resolveAllowedUploadOrigin(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): string | null {
  const origin = String(params.req.headers.origin ?? "").trim();
  if (!origin || origin === "null") {
    return null;
  }
  const check = checkBrowserOrigin({
    requestHost: Array.isArray(params.req.headers.host)
      ? params.req.headers.host[0]
      : params.req.headers.host,
    origin,
    allowHostHeaderOriginFallback: true,
    isLocalClient: isLoopbackAddress(
      resolveRequestClientIp(params.req, params.trustedProxies, params.allowRealIpFallback),
    ),
  });
  return check.ok ? origin : null;
}

function applyUploadCorsHeaders(params: {
  req: IncomingMessage;
  res: ServerResponse;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}) {
  const origin = resolveAllowedUploadOrigin(params);
  if (!origin) {
    return;
  }
  params.res.setHeader("Access-Control-Allow-Origin", origin);
  params.res.setHeader("Vary", "Origin");
  params.res.setHeader("Access-Control-Allow-Methods", POWER_FS_UPLOAD_ALLOW_METHODS);
  params.res.setHeader(
    "Access-Control-Allow-Headers",
    String(
      params.req.headers["access-control-request-headers"] ?? POWER_FS_UPLOAD_ALLOW_HEADERS_DEFAULT,
    ),
  );
  params.res.setHeader("Access-Control-Max-Age", "600");
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

export async function handlePowerFsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === POWER_FS_UPLOAD_HTTP_PATH) {
    applyUploadCorsHeaders({
      req,
      res,
      trustedProxies: opts.trustedProxies,
      allowRealIpFallback: opts.allowRealIpFallback,
    });
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

    const authResult = await authorizePowerFsRequest({
      req,
      auth: opts.auth,
      token: parseBearerToken(req),
      trustedProxies: opts.trustedProxies,
      allowRealIpFallback: opts.allowRealIpFallback,
      rateLimiter: opts.rateLimiter,
    });
    if (!authResult.ok) {
      sendGatewayAuthFailure(res, authResult);
      return true;
    }

    try {
      const { workspaceDir } = resolveWorkspaceForAgent(url.searchParams.get("agentId"));
      const currentPath = normalizeRelativePath(url.searchParams.get("path"));
      const name = normalizeFileName(url.searchParams.get("name"));
      const targetRelPath = currentPath ? path.posix.join(currentPath, name) : name;
      const requestedPath = await resolveParentForWrite(workspaceDir, targetRelPath);
      const tempPath = path.join(
        path.dirname(requestedPath),
        `.${path.basename(requestedPath)}.${process.pid}.${randomUUID()}.upload.tmp`,
      );
      const contentLength = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
      if (Number.isFinite(contentLength) && contentLength > POWER_FS_TRANSFER_MAX_BYTES) {
        sendJson(res, 413, { ok: false, error: "file exceeds 10GB upload limit" });
        return true;
      }

      let totalBytes = 0;
      const handle = await fsp.open(tempPath, "wx", 0o600);
      let tempExists = true;
      let handleClosed = false;
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
        await fsp.rename(tempPath, requestedPath);
        tempExists = false;
        const stats = await fsp.stat(requestedPath);
        sendJson(res, 200, {
          ok: true,
          entry: {
            name,
            path: requestedPath,
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
  }

  if (url.pathname === POWER_FS_DOWNLOAD_HTTP_PATH) {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      sendMethodNotAllowed(res, "GET, POST");
      return true;
    }
    try {
      const params = await readDownloadRequest(req);
      const authResult = await authorizePowerFsRequest({
        req,
        auth: opts.auth,
        token: params.token ?? parseBearerToken(req),
        password: params.password,
        trustedProxies: opts.trustedProxies,
        allowRealIpFallback: opts.allowRealIpFallback,
        rateLimiter: opts.rateLimiter,
      });
      if (!authResult.ok) {
        sendGatewayAuthFailure(res, authResult);
        return true;
      }

      const { workspaceDir } = resolveWorkspaceForAgent(params.agentId);
      const relPath = normalizeRelativePath(params.path);
      const file = await resolveExistingFile(workspaceDir, relPath);
      if (file.stat.size > POWER_FS_TRANSFER_MAX_BYTES) {
        sendJson(res, 413, { ok: false, error: "file exceeds 10GB download limit" });
        return true;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(file.stat.size));
      res.setHeader("Content-Disposition", buildContentDisposition(file.name));
      const stream = fs.createReadStream(file.path);
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
  }

  return false;
}
