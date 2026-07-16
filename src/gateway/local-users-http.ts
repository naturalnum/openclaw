import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, writeConfigFile } from "../config/config.js";
import {
  authenticateLocalUser,
  createLocalUserSession,
  createLocalUser,
  hasAnyLocalUsers,
  initializeLocalAdmin,
  listLocalUsers,
  normalizeLocalUserId,
  resolveLocalUserDefaultAgentId,
  resolveLocalUserDefaultWorkspace,
  resolveLocalUserSession,
  updateLocalUser,
  type LocalUserRole,
  type LocalUserStatus,
  type PublicLocalUserProfile,
} from "../users/local-users.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getHeader, authorizeGatewayHttpRequestOrReply } from "./http-utils.js";
import { isLoopbackHost } from "./net.js";

const MAX_BODY_BYTES = 64 * 1024;
const LOCAL_USER_SESSION_HEADER = "x-openclaw-user-session";
const LOCAL_USERS_RESERVED_PATHS = new Set(["status", "init-admin", "login", "me"]);

type LocalUserCredentialsBody = {
  id?: unknown;
  password?: unknown;
  displayName?: unknown;
  role?: unknown;
  status?: unknown;
};

type LocalUserUpdateBody = {
  password?: unknown;
  displayName?: unknown;
  role?: unknown;
  status?: unknown;
};

function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCredentialsBody(body: unknown): LocalUserCredentialsBody | null {
  if (!isRecord(body)) {
    return null;
  }
  return body;
}

function getLocalUserSessionToken(req: IncomingMessage): string | undefined {
  const header = req.headers[LOCAL_USER_SESSION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isLocalUserRole(value: unknown): value is LocalUserRole {
  return value === "admin" || value === "user";
}

function isLocalUserStatus(value: unknown): value is LocalUserStatus {
  return value === "active" || value === "disabled";
}

function resolveAllowedLocalUsersCorsOrigin(req: IncomingMessage): string | null {
  const origin = getHeader(req, "origin")?.trim();
  if (!origin || origin === "null") {
    return null;
  }
  try {
    const parsed = new URL(origin);
    return isLoopbackHost(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function applyLocalUsersCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = resolveAllowedLocalUsersCorsOrigin(req);
  if (!origin) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-openclaw-user-session",
  );
}

function parseUserIdFromPath(pathname: string): string | null {
  const prefix = "/local-users/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const suffix = pathname.slice(prefix.length);
  if (!suffix || suffix.includes("/") || LOCAL_USERS_RESERVED_PATHS.has(suffix)) {
    return null;
  }
  return decodeURIComponent(suffix);
}

async function requireGatewayAuth(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const cfg = loadConfig();
  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  return requestAuth !== null;
}

async function requireLocalAdminSession(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<PublicLocalUserProfile | null> {
  const token = getLocalUserSessionToken(req);
  if (!token) {
    sendJson(res, 401, {
      ok: false,
      error: { type: "unauthorized", message: "Local admin session is required." },
    });
    return null;
  }
  const resolved = await resolveLocalUserSession({ token });
  if (!resolved || resolved.user.role !== "admin") {
    sendJson(res, 403, {
      ok: false,
      error: { type: "forbidden", message: "Local admin role is required." },
    });
    return null;
  }
  return resolved.user;
}

function sendCredentialsError(res: ServerResponse): void {
  sendInvalidRequest(res, "id and password are required");
}

async function ensureLocalUserDefaultAgent(user: PublicLocalUserProfile): Promise<void> {
  const cfg = loadConfig();
  const workspace = resolveLocalUserDefaultWorkspace(user.id);
  const agentId = resolveLocalUserDefaultAgentId(user.id);
  const currentList = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const existingIndex = currentList.findIndex(
    (entry) => entry?.id === agentId || entry?.workspace === workspace,
  );
  const entry = {
    ...(existingIndex >= 0 ? currentList[existingIndex] : {}),
    id: agentId,
    name: "默认",
    workspace,
    identity: {
      ...(existingIndex >= 0 ? currentList[existingIndex]?.identity : {}),
      name: "默认",
    },
  };
  const list = [...currentList];
  if (existingIndex >= 0) {
    list[existingIndex] = entry;
  } else {
    list.push(entry);
  }
  const hasDefault = list.some((item) => item?.default === true);
  if (!hasDefault) {
    const ownIndex = list.findIndex((item) => item?.id === agentId);
    if (ownIndex >= 0) {
      list[ownIndex] = { ...list[ownIndex], default: true };
    }
  }
  await writeConfigFile({
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        workspace: cfg.agents?.defaults?.workspace ?? workspace,
      },
      list,
    },
  });
}

async function readCredentialsBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<LocalUserCredentialsBody | undefined> {
  const body = await readJsonBodyOrError(req, res, MAX_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const parsed = parseCredentialsBody(body);
  if (!parsed) {
    sendCredentialsError(res);
    return undefined;
  }
  if (typeof parsed.id !== "string" || typeof parsed.password !== "string") {
    sendCredentialsError(res);
    return undefined;
  }
  return parsed;
}

export function isLocalUsersHttpPath(pathname: string): boolean {
  return (
    pathname === "/local-users" ||
    pathname === "/local-users/status" ||
    pathname === "/local-users/init-admin" ||
    pathname === "/local-users/login" ||
    pathname === "/local-users/me" ||
    parseUserIdFromPath(pathname) !== null
  );
}

export async function handleLocalUsersHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const pathname = getRequestUrl(req).pathname;
  if (!isLocalUsersHttpPath(pathname)) {
    return false;
  }
  applyLocalUsersCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === "/local-users/status") {
    if (req.method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      initialized: await hasAnyLocalUsers(),
    });
    return true;
  }

  if (pathname === "/local-users/me") {
    if (req.method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return true;
    }
    const token = getLocalUserSessionToken(req);
    if (!token) {
      sendJson(res, 401, {
        ok: false,
        error: { type: "unauthorized", message: "Local user session is required." },
      });
      return true;
    }
    const resolved = await resolveLocalUserSession({ token });
    if (!resolved) {
      sendJson(res, 401, {
        ok: false,
        error: { type: "unauthorized", message: "Local user session is invalid or expired." },
      });
      return true;
    }
    sendJson(res, 200, { ok: true, ...resolved });
    return true;
  }

  if (pathname === "/local-users" && req.method === "GET") {
    if (!(await requireLocalAdminSession(req, res))) {
      return true;
    }
    sendJson(res, 200, { ok: true, users: await listLocalUsers() });
    return true;
  }

  const userIdFromPath = parseUserIdFromPath(pathname);
  if (userIdFromPath) {
    if (req.method !== "PATCH") {
      sendMethodNotAllowed(res, "PATCH");
      return true;
    }
    const adminUser = await requireLocalAdminSession(req, res);
    if (!adminUser) {
      return true;
    }
    const body = await readJsonBodyOrError(req, res, MAX_BODY_BYTES);
    if (body === undefined) {
      return true;
    }
    if (!isRecord(body)) {
      sendInvalidRequest(res, "request body must be an object");
      return true;
    }
    const parsed = body as LocalUserUpdateBody;
    const displayName =
      parsed.displayName === undefined
        ? undefined
        : typeof parsed.displayName === "string"
          ? parsed.displayName
          : null;
    const password =
      parsed.password === undefined
        ? undefined
        : typeof parsed.password === "string"
          ? parsed.password
          : null;
    const role = parsed.role === undefined ? undefined : parsed.role;
    const status = parsed.status === undefined ? undefined : parsed.status;
    if (
      displayName === null ||
      password === null ||
      (role !== undefined && !isLocalUserRole(role)) ||
      (status !== undefined && !isLocalUserStatus(status))
    ) {
      sendInvalidRequest(res, "displayName, password, role, or status is invalid");
      return true;
    }
    if (
      normalizeLocalUserId(userIdFromPath) === adminUser.id &&
      (role !== undefined || status !== undefined)
    ) {
      sendJson(res, 403, {
        ok: false,
        error: {
          type: "forbidden",
          message: "不能修改当前登录账号的角色或启用状态。请使用另一个管理员账号操作。",
        },
      });
      return true;
    }
    try {
      const user = await updateLocalUser({
        id: userIdFromPath,
        ...(displayName !== undefined ? { displayName } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      sendJson(res, 200, { ok: true, user });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, {
        ok: false,
        error: { type: "invalid_request_error", message },
      });
    }
    return true;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }
  if (
    pathname === "/local-users/init-admin" &&
    (await hasAnyLocalUsers()) &&
    !(await requireGatewayAuth(req, res, opts))
  ) {
    return true;
  }
  if (pathname === "/local-users" && !(await requireLocalAdminSession(req, res))) {
    return true;
  }

  const body = await readCredentialsBody(req, res);
  if (!body) {
    return true;
  }
  const id = body.id as string;
  const password = body.password as string;
  const displayName = typeof body.displayName === "string" ? body.displayName : undefined;

  if (pathname === "/local-users/init-admin") {
    try {
      const user = await initializeLocalAdmin({ id, password, displayName });
      await ensureLocalUserDefaultAgent(user);
      const session = await createLocalUserSession({ userId: user.id });
      sendJson(res, 201, { ok: true, user, ...session });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, {
        ok: false,
        error: { type: "invalid_request_error", message },
      });
    }
    return true;
  }

  if (pathname === "/local-users") {
    if (body.role !== undefined && !isLocalUserRole(body.role)) {
      sendInvalidRequest(res, "role is invalid");
      return true;
    }
    try {
      const user = await createLocalUser({
        id,
        password,
        displayName,
        role: body.role ?? "user",
      });
      await ensureLocalUserDefaultAgent(user);
      sendJson(res, 201, { ok: true, user });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, {
        ok: false,
        error: { type: "invalid_request_error", message },
      });
    }
    return true;
  }

  const authResult = await authenticateLocalUser({ id, password });
  if (!authResult.ok) {
    sendJson(res, 401, {
      ok: false,
      error: { type: "unauthorized", code: authResult.error, message: "账号或密码不正确。" },
    });
    return true;
  }
  await ensureLocalUserDefaultAgent(authResult.user);
  const session = await createLocalUserSession({ userId: authResult.user.id });
  sendJson(res, 200, { ok: true, user: authResult.user, ...session });
  return true;
}
