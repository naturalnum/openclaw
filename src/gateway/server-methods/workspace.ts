import { randomUUID } from "node:crypto";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { writeFileWithinRoot } from "../../infra/fs-safe.js";
import { readRequestBodyWithLimit } from "../../infra/http-body.js";
import { detectMime, getFileExtension } from "../../media/mime.js";
import type { AuthRateLimiter } from "../auth-rate-limit.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "../auth.js";
import { authorizeGatewayBearerRequestOrReply } from "../http-auth-helpers.js";
import {
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "../http-common.js";
import { isLoopbackAddress, resolveRequestClientIp } from "../net.js";
import { checkBrowserOrigin } from "../origin-check.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkspaceDeleteParams,
  validateWorkspaceDownloadParams,
  validateWorkspaceListParams,
  validateWorkspaceMkdirParams,
  validateWorkspaceRenameParams,
  validateWorkspaceUploadParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const WORKSPACE_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const WORKSPACE_UPLOAD_FILE_MAX_BYTES = 16 * 1024 * 1024;
const WORKSPACE_UPLOAD_TOTAL_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const WORKSPACE_UPLOAD_HTTP_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const WORKSPACE_UPLOAD_HTTP_PATH = "/api/workspace/upload";
export const WORKSPACE_DOWNLOAD_HTTP_PATH = "/api/workspace/download";
const WORKSPACE_UPLOAD_ALLOW_METHODS = "POST, OPTIONS";
const WORKSPACE_UPLOAD_ALLOW_HEADERS_DEFAULT = "Authorization, Content-Type";
const WORKSPACE_DOWNLOAD_ALLOW_METHODS = "GET, POST";
const WORKSPACE_DOWNLOAD_FORM_MAX_BYTES = 64 * 1024;

type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  mimeType?: string;
  size?: number;
  updatedAtMs?: number;
  previewKind?: "text" | "image" | "pdf" | "none";
  extension?: string;
};

class WorkspaceUploadTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`file exceeds HTTP upload limit of ${limitBytes} bytes`);
    this.name = "WorkspaceUploadTooLargeError";
    this.limitBytes = limitBytes;
  }
}

function resolveWorkspaceRoot(): string {
  const configuredRoot = process.env.OPENCLAW_WORKSPACE_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }
  const cfg = loadConfig();
  return path.resolve(resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)));
}

function resolveAllowedWorkspaceUploadOrigin(params: {
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

function applyWorkspaceUploadCorsHeaders(params: {
  req: IncomingMessage;
  res: ServerResponse;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): string | null {
  const allowedOrigin = resolveAllowedWorkspaceUploadOrigin(params);
  if (!allowedOrigin) {
    return null;
  }
  params.res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  params.res.setHeader("Vary", "Origin");
  params.res.setHeader("Access-Control-Allow-Methods", WORKSPACE_UPLOAD_ALLOW_METHODS);
  params.res.setHeader(
    "Access-Control-Allow-Headers",
    String(
      params.req.headers["access-control-request-headers"] ??
        WORKSPACE_UPLOAD_ALLOW_HEADERS_DEFAULT,
    ),
  );
  params.res.setHeader("Access-Control-Max-Age", "600");
  return allowedOrigin;
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

function ensurePathInsideRoot(rootDir: string, targetPath: string): string {
  const resolved = path.resolve(rootDir, targetPath);
  const relative = path.relative(rootDir, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("path escapes workspace");
  }
  return resolved;
}

function normalizeWorkspacePath(rootDir: string, targetPath: string): string {
  const rel = path.relative(rootDir, targetPath);
  if (!rel || rel === ".") {
    return "";
  }
  return rel.split(path.sep).join(path.posix.sep);
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

function buildContentDisposition(fileName: string): string {
  const asciiFallback =
    fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function trimOptionalFormValue(value: string | null): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

async function readWorkspaceDownloadRequest(req: IncomingMessage): Promise<{
  path: string;
  token?: string;
  password?: string;
}> {
  if (req.method === "GET") {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    return {
      path: String(url.searchParams.get("path") ?? ""),
    };
  }

  const raw = await readRequestBodyWithLimit(req, {
    maxBytes: WORKSPACE_DOWNLOAD_FORM_MAX_BYTES,
    encoding: "utf-8",
  });
  const params = new URLSearchParams(raw);
  return {
    path: String(params.get("path") ?? ""),
    token: trimOptionalFormValue(params.get("token")),
    password: trimOptionalFormValue(params.get("password")),
  };
}

async function ensureNoSymlink(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error("symlink paths are not allowed");
  }
}

async function resolveExistingWorkspacePath(rootDir: string, relPath: string) {
  const requestedPath = ensurePathInsideRoot(rootDir, relPath || ".");
  await ensureNoSymlink(requestedPath);
  const realPath = await fs.realpath(requestedPath);
  ensurePathInsideRoot(rootDir, path.relative(rootDir, realPath));
  await ensureNoSymlink(realPath);
  const stat = await fs.stat(realPath);
  return {
    realPath,
    relPath: normalizeWorkspacePath(rootDir, realPath),
    stat,
  };
}

async function resolveParentForWrite(rootDir: string, relPath: string) {
  const requestedPath = ensurePathInsideRoot(rootDir, relPath);
  const parentPath = path.dirname(requestedPath);
  const parentReal = await fs.realpath(parentPath);
  ensurePathInsideRoot(rootDir, path.relative(rootDir, parentReal));
  await ensureNoSymlink(parentReal);
  return {
    requestedPath,
    relPath: normalizeWorkspacePath(rootDir, requestedPath),
  };
}

async function writeWorkspaceUploadBuffer(params: {
  rootDir: string;
  directoryRelPath: string;
  name: string;
  buffer: Buffer;
}) {
  const targetRelPath = params.directoryRelPath
    ? path.posix.join(params.directoryRelPath, params.name)
    : params.name;
  const { relPath } = await resolveParentForWrite(params.rootDir, targetRelPath);
  await writeFileWithinRoot({
    rootDir: params.rootDir,
    relativePath: relPath,
    data: params.buffer,
    mkdir: true,
  });
}

async function streamWorkspaceUploadToFile(params: {
  req: IncomingMessage;
  rootDir: string;
  directoryRelPath: string;
  name: string;
  maxBytes: number;
}) {
  const targetRelPath = params.directoryRelPath
    ? path.posix.join(params.directoryRelPath, params.name)
    : params.name;
  const { requestedPath } = await resolveParentForWrite(params.rootDir, targetRelPath);
  const tempPath = path.join(
    path.dirname(requestedPath),
    `.${path.basename(requestedPath)}.${process.pid}.${randomUUID()}.upload.tmp`,
  );
  const contentLength = Number.parseInt(String(params.req.headers["content-length"] ?? ""), 10);
  if (Number.isFinite(contentLength) && contentLength > params.maxBytes) {
    throw new WorkspaceUploadTooLargeError(params.maxBytes);
  }

  let totalBytes = 0;
  const handle = await fs.open(tempPath, "wx", 0o600);
  let tempExists = true;
  let handleClosed = false;
  try {
    for await (const chunk of params.req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > params.maxBytes) {
        throw new WorkspaceUploadTooLargeError(params.maxBytes);
      }
      await handle.write(buffer);
    }
    await handle.close();
    handleClosed = true;
    await fs.rename(tempPath, requestedPath);
    tempExists = false;
  } finally {
    if (!handleClosed) {
      await handle.close().catch(() => {});
    }
    if (tempExists) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }
}

function previewKindForMime(mimeType?: string): "text" | "image" | "pdf" | "none" {
  if (!mimeType) {
    return "none";
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "text";
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  return "none";
}

async function buildWorkspaceEntry(
  rootDir: string,
  entryPath: string,
  name: string,
): Promise<WorkspaceEntry | null> {
  const lstat = await fs.lstat(entryPath);
  if (lstat.isSymbolicLink()) {
    return null;
  }
  const isDirectory = lstat.isDirectory();
  const ext = isDirectory ? undefined : getFileExtension(name);
  const mimeType = isDirectory ? undefined : await detectMime({ filePath: name });
  return {
    name,
    path: normalizeWorkspacePath(rootDir, entryPath),
    kind: isDirectory ? "directory" : "file",
    mimeType,
    size: isDirectory ? undefined : lstat.size,
    updatedAtMs: Math.floor(lstat.mtimeMs),
    previewKind: isDirectory ? undefined : previewKindForMime(mimeType),
    extension: ext,
  };
}

function compareWorkspaceEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

export const workspaceHandlers: GatewayRequestHandlers = {
  "workspace.list": async ({ params, respond }) => {
    if (!validateWorkspaceListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.list params: ${formatValidationErrors(validateWorkspaceListParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const relPath = normalizeRelativePath(params.path);
      const resolved = await resolveExistingWorkspacePath(rootDir, relPath);
      if (!resolved.stat.isDirectory()) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "workspace.list path must be a directory"),
        );
        return;
      }
      const entries = await Promise.all(
        (await fs.readdir(resolved.realPath, { withFileTypes: true })).map(async (dirent) => {
          const entryPath = path.join(resolved.realPath, dirent.name);
          return await buildWorkspaceEntry(rootDir, entryPath, dirent.name);
        }),
      );
      const filteredEntries = entries.filter((entry): entry is WorkspaceEntry => entry !== null);
      filteredEntries.sort(compareWorkspaceEntries);
      respond(
        true,
        {
          root: rootDir,
          currentPath: resolved.relPath,
          parentPath: resolved.relPath
            ? (() => {
                const parent = path.posix.dirname(resolved.relPath);
                return parent === "." ? "" : parent;
              })()
            : null,
          entries: filteredEntries,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
  "workspace.download": async ({ params, respond }) => {
    if (!validateWorkspaceDownloadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.download params: ${formatValidationErrors(validateWorkspaceDownloadParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const relPath = normalizeRelativePath(params.path);
      const resolved = await resolveExistingWorkspacePath(rootDir, relPath);
      if (!resolved.stat.isFile()) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "workspace.download path must be a file"),
        );
        return;
      }
      if (resolved.stat.size > WORKSPACE_DOWNLOAD_MAX_BYTES) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `file too large for browser transfer (${resolved.stat.size} bytes > ${WORKSPACE_DOWNLOAD_MAX_BYTES})`,
          ),
        );
        return;
      }
      const buffer = await fs.readFile(resolved.realPath);
      const mimeType =
        (await detectMime({ buffer, filePath: resolved.realPath })) ?? "application/octet-stream";
      respond(
        true,
        {
          file: {
            name: path.basename(resolved.realPath),
            path: resolved.relPath,
            mimeType,
            size: buffer.byteLength,
            contentBase64: buffer.toString("base64"),
            previewKind: previewKindForMime(mimeType),
          },
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
  "workspace.mkdir": async ({ params, respond }) => {
    if (!validateWorkspaceMkdirParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.mkdir params: ${formatValidationErrors(validateWorkspaceMkdirParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const relPath = normalizeRelativePath(params.path);
      if (!relPath) {
        throw new Error("cannot create workspace root");
      }
      const { requestedPath } = await resolveParentForWrite(rootDir, relPath);
      await fs.mkdir(requestedPath, { recursive: true });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
  "workspace.delete": async ({ params, respond }) => {
    if (!validateWorkspaceDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.delete params: ${formatValidationErrors(validateWorkspaceDeleteParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const relPath = normalizeRelativePath(params.path);
      if (!relPath) {
        throw new Error("cannot delete workspace root");
      }
      const resolved = await resolveExistingWorkspacePath(rootDir, relPath);
      await fs.rm(resolved.realPath, { recursive: true, force: false });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
  "workspace.rename": async ({ params, respond }) => {
    if (!validateWorkspaceRenameParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.rename params: ${formatValidationErrors(validateWorkspaceRenameParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const relPath = normalizeRelativePath(params.path);
      if (!relPath) {
        throw new Error("cannot rename workspace root");
      }
      const newName = normalizeFileName(params.newName);
      const resolved = await resolveExistingWorkspacePath(rootDir, relPath);
      const targetPath = path.join(path.dirname(resolved.realPath), newName);
      ensurePathInsideRoot(rootDir, path.relative(rootDir, targetPath));
      try {
        await fs.lstat(targetPath);
        throw new Error("target already exists");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code && code !== "ENOENT") {
          throw err;
        }
      }
      await fs.rename(resolved.realPath, targetPath);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
  "workspace.upload": async ({ params, respond }) => {
    if (!validateWorkspaceUploadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.upload params: ${formatValidationErrors(validateWorkspaceUploadParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const rootDir = resolveWorkspaceRoot();
      const dirRelPath = normalizeRelativePath(params.path);
      const directory = await resolveExistingWorkspacePath(rootDir, dirRelPath);
      if (!directory.stat.isDirectory()) {
        throw new Error("upload target must be a directory");
      }
      let totalBytes = 0;
      for (const file of params.files) {
        const name = normalizeFileName(file.name);
        const contentBase64 = String(file.contentBase64 ?? "");
        const buffer = Buffer.from(contentBase64, "base64");
        if (buffer.byteLength > WORKSPACE_UPLOAD_FILE_MAX_BYTES) {
          throw new Error(`file too large: ${name}`);
        }
        totalBytes += buffer.byteLength;
        if (totalBytes > WORKSPACE_UPLOAD_TOTAL_MAX_BYTES) {
          throw new Error("upload payload too large");
        }
        await writeWorkspaceUploadBuffer({
          rootDir,
          directoryRelPath: dirRelPath,
          name,
          buffer,
        });
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },
};

export async function handleWorkspaceUploadHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
    maxUploadBytes?: number;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== opts.pathname) {
    return false;
  }

  applyWorkspaceUploadCorsHeaders({
    req,
    res,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
  });

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Allow", WORKSPACE_UPLOAD_ALLOW_METHODS);
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, WORKSPACE_UPLOAD_ALLOW_METHODS);
    return true;
  }

  const authorized = await authorizeGatewayBearerRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authorized) {
    return true;
  }

  try {
    const rootDir = resolveWorkspaceRoot();
    const dirRelPath = normalizeRelativePath(url.searchParams.get("path") ?? "");
    const directory = await resolveExistingWorkspacePath(rootDir, dirRelPath);
    if (!directory.stat.isDirectory()) {
      throw new Error("upload target must be a directory");
    }
    const name = normalizeFileName(url.searchParams.get("name"));
    await streamWorkspaceUploadToFile({
      req,
      rootDir,
      directoryRelPath: dirRelPath,
      name,
      maxBytes: opts.maxUploadBytes ?? WORKSPACE_UPLOAD_HTTP_MAX_BYTES,
    });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    if (err instanceof WorkspaceUploadTooLargeError) {
      sendJson(res, 413, {
        error: { message: err.message, type: "invalid_request_error" },
      });
      return true;
    }
    sendInvalidRequest(res, String(err));
  }
  return true;
}

export async function handleWorkspaceDownloadHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== opts.pathname) {
    return false;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendMethodNotAllowed(res, WORKSPACE_DOWNLOAD_ALLOW_METHODS);
    return true;
  }

  let formAuth: { token?: string; password?: string } | null = null;
  let requestedPath = "";
  try {
    const payload = await readWorkspaceDownloadRequest(req);
    requestedPath = payload.path;
    if (payload.token || payload.password) {
      formAuth = { token: payload.token, password: payload.password };
    }
  } catch (err) {
    sendInvalidRequest(res, String(err));
    return true;
  }

  const authResult = formAuth
    ? await authorizeHttpGatewayConnect({
        auth: opts.auth,
        connectAuth: formAuth,
        req,
        trustedProxies: opts.trustedProxies,
        allowRealIpFallback: opts.allowRealIpFallback,
        rateLimiter: opts.rateLimiter,
      })
    : await (async () => {
        const ok = await authorizeGatewayBearerRequestOrReply({
          req,
          res,
          auth: opts.auth,
          trustedProxies: opts.trustedProxies,
          allowRealIpFallback: opts.allowRealIpFallback,
          rateLimiter: opts.rateLimiter,
        });
        return ok ? { ok: true } : { ok: false };
      })();

  if (!authResult.ok) {
    if ("reason" in authResult || "rateLimited" in authResult) {
      sendGatewayAuthFailure(res, authResult);
    }
    return true;
  }

  try {
    const rootDir = resolveWorkspaceRoot();
    const relPath = normalizeRelativePath(requestedPath);
    const resolved = await resolveExistingWorkspacePath(rootDir, relPath);
    if (!resolved.stat.isFile()) {
      sendInvalidRequest(res, "workspace.download path must be a file");
      return true;
    }
    const mimeType =
      (await detectMime({ filePath: resolved.realPath })) ?? "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(resolved.stat.size));
    res.setHeader("Content-Disposition", buildContentDisposition(path.basename(resolved.realPath)));
    res.setHeader("Cache-Control", "no-store");
    await new Promise<void>((resolve, reject) => {
      const stream = syncFs.createReadStream(resolved.realPath);
      stream.on("error", reject);
      res.on("close", resolve);
      res.on("finish", resolve);
      stream.pipe(res);
    });
  } catch (err) {
    if (!res.headersSent) {
      sendInvalidRequest(res, String(err));
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
  return true;
}
