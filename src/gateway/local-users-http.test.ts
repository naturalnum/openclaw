import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter, type AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";

let stateDir = "";
const writeConfigFileMock = vi.hoisted(() => vi.fn(async (_next?: unknown) => {}));
const configState = vi.hoisted(() => ({
  current: {} as {
    gateway?: {
      controlUi?: { allowedOrigins?: string[] };
      trustedProxies?: string[];
      allowRealIpFallback?: boolean;
    };
    agents?: {
      defaults?: { workspace?: string };
      list?: Array<{ id?: string; workspace?: string }>;
    };
  },
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => stateDir,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => configState.current,
  writeConfigFile: writeConfigFileMock,
}));

vi.mock("./http-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./http-utils.js")>("./http-utils.js");
  return {
    ...actual,
    authorizeGatewayHttpRequestOrReply: vi.fn(async () => ({ ok: true, method: "trusted-proxy" })),
  };
});

const { handleLocalUsersHttpRequest } = await import("./local-users-http.js");

let port = 0;
let server: ReturnType<typeof createServer> | undefined;
let gatewayAuth: ResolvedGatewayAuth = { mode: "none", allowTailscale: false };
let rateLimiter: AuthRateLimiter | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleLocalUsersHttpRequest(req, res, {
      auth: gatewayAuth,
      rateLimiter,
    }).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end("not found");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("server missing address"));
        return;
      }
      port = address.port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(async () => {
  writeConfigFileMock.mockReset();
  writeConfigFileMock.mockImplementation(async (_next?: unknown) => {});
  configState.current = {};
  gatewayAuth = { mode: "none", allowTailscale: false };
  rateLimiter = undefined;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-users-http-"));
});

afterEach(async () => {
  rateLimiter?.dispose();
  await fs.rm(stateDir, { recursive: true, force: true });
});

function localUsersUrl(pathname: string) {
  return `http://127.0.0.1:${port}${pathname}`;
}

async function jsonRequest(
  pathname: string,
  init: {
    method?: string;
    body?: unknown;
    origin?: string;
    sessionToken?: string;
    forwardedFor?: string;
  } = {},
) {
  return await fetch(localUsersUrl(pathname), {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      ...(init.forwardedFor ? { "x-forwarded-for": init.forwardedFor } : {}),
      ...(init.sessionToken ? { "x-openclaw-user-session": init.sessionToken } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function initAdmin() {
  const response = await jsonRequest("/local-users/init-admin", {
    method: "POST",
    body: {
      id: "owner",
      password: "owner secure password",
    },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    token: string;
    user: { id: string; role: string };
    gatewayAuth: { mode: string; token?: string };
  };
}

describe("local users HTTP", () => {
  it("handles loopback browser CORS preflight", async () => {
    const response = await jsonRequest("/local-users/status", {
      method: "OPTIONS",
      origin: "http://localhost:5174",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-openclaw-user-session",
    );
  });

  it("does not grant CORS to non-loopback browser origins", async () => {
    const response = await jsonRequest("/local-users/status", {
      method: "OPTIONS",
      origin: "https://example.com",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not treat a remote browser's loopback Origin as a local client", async () => {
    configState.current = {
      gateway: {
        trustedProxies: ["127.0.0.1/32"],
      },
    };
    const response = await jsonRequest("/local-users/status", {
      method: "OPTIONS",
      origin: "http://127.0.0.1:5174",
      forwardedFor: "192.168.20.50",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("grants CORS only to an exact configured Control UI origin", async () => {
    configState.current = {
      gateway: {
        controlUi: {
          allowedOrigins: ["https://agent.example.com", "*"],
        },
      },
    };

    const allowed = await jsonRequest("/local-users/status", {
      method: "OPTIONS",
      origin: "https://agent.example.com",
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://agent.example.com");

    const wildcardOnly = await jsonRequest("/local-users/status", {
      method: "OPTIONS",
      origin: "https://other.example.com",
    });
    expect(wildcardOnly.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reports initialization status and initializes the first admin", async () => {
    const before = await jsonRequest("/local-users/status");
    await expect(before.json()).resolves.toEqual({ ok: true, initialized: false });

    const initialized = await initAdmin();
    expect(initialized).toMatchObject({
      user: { id: "owner", role: "admin" },
      token: expect.any(String),
      gatewayAuth: { mode: "none" },
    });

    const after = await jsonRequest("/local-users/status");
    await expect(after.json()).resolves.toEqual({ ok: true, initialized: true });
    expect(writeConfigFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: {
          defaults: {
            workspace: path.join(stateDir, "users", "owner", "default"),
          },
          list: [
            expect.objectContaining({
              id: expect.stringMatching(/^agent-[0-9a-f]{12}$/),
              default: true,
              name: "默认",
              workspace: path.join(stateDir, "users", "owner", "default"),
            }),
          ],
        },
      }),
    );
    await expect(fs.stat(path.join(stateDir, "users", "owner", "projects"))).resolves.toBeDefined();
  });

  it("logs in without requiring gateway bearer auth", async () => {
    await initAdmin();

    const response = await jsonRequest("/local-users/login", {
      method: "POST",
      body: {
        id: "owner",
        password: "owner secure password",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      token: expect.any(String),
      user: { id: "owner", role: "admin" },
      gatewayAuth: { mode: "none" },
    });
  });

  it("rate-limits repeated local-user login failures", async () => {
    await initAdmin();
    rateLimiter = createAuthRateLimiter({
      maxAttempts: 1,
      lockoutMs: 60_000,
      exemptLoopback: false,
      pruneIntervalMs: 0,
    });

    const invalid = await jsonRequest("/local-users/login", {
      method: "POST",
      body: { id: "owner", password: "wrong password" },
    });
    expect(invalid.status).toBe(401);

    const blocked = await jsonRequest("/local-users/login", {
      method: "POST",
      body: { id: "owner", password: "owner secure password" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("revokes the local-user session on logout", async () => {
    const admin = await initAdmin();

    const logout = await jsonRequest("/local-users/logout", {
      method: "POST",
      sessionToken: admin.token,
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("cache-control")).toBe("no-store");

    const me = await jsonRequest("/local-users/me", {
      sessionToken: admin.token,
    });
    expect(me.status).toBe(401);
  });

  it("returns token Gateway auth only after valid local-user authentication", async () => {
    gatewayAuth = {
      mode: "token",
      token: "gateway-bridge-token",
      allowTailscale: false,
    };
    const admin = await initAdmin();
    expect(admin.gatewayAuth).toEqual({
      mode: "token",
      token: "gateway-bridge-token",
    });

    const invalidLogin = await jsonRequest("/local-users/login", {
      method: "POST",
      body: { id: "owner", password: "wrong password" },
    });
    expect(invalidLogin.status).toBe(401);
    const invalidPayload = await invalidLogin.json();
    expect(invalidPayload).not.toHaveProperty("gatewayAuth");
    expect(JSON.stringify(invalidPayload)).not.toContain("gateway-bridge-token");

    const invalidMe = await jsonRequest("/local-users/me", {
      sessionToken: "invalid-local-user-session",
    });
    expect(invalidMe.status).toBe(401);
    const invalidMePayload = await invalidMe.json();
    expect(invalidMePayload).not.toHaveProperty("gatewayAuth");
    expect(JSON.stringify(invalidMePayload)).not.toContain("gateway-bridge-token");

    const login = await jsonRequest("/local-users/login", {
      method: "POST",
      body: { id: "owner", password: "owner secure password" },
    });
    await expect(login.json()).resolves.toMatchObject({
      gatewayAuth: { mode: "token", token: "gateway-bridge-token" },
    });
    expect(login.headers.get("cache-control")).toBe("no-store");

    const me = await jsonRequest("/local-users/me", {
      sessionToken: admin.token,
    });
    await expect(me.json()).resolves.toMatchObject({
      gatewayAuth: { mode: "token", token: "gateway-bridge-token" },
    });
    expect(me.headers.get("cache-control")).toBe("no-store");
  });

  it("reports password Gateway mode without exposing its password", async () => {
    await initAdmin();
    gatewayAuth = {
      mode: "password",
      password: "gateway-password-must-not-leak",
      allowTailscale: false,
    };

    const response = await jsonRequest("/local-users/login", {
      method: "POST",
      body: { id: "owner", password: "owner secure password" },
    });
    const payload = await response.json();
    expect(payload).toMatchObject({ gatewayAuth: { mode: "password" } });
    expect(payload.gatewayAuth).not.toHaveProperty("password");
    expect(JSON.stringify(payload)).not.toContain("gateway-password-must-not-leak");
  });

  it("repairs a missing default agent when restoring a persisted user session", async () => {
    const admin = await initAdmin();
    writeConfigFileMock.mockClear();

    const response = await jsonRequest("/local-users/me", {
      sessionToken: admin.token,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      user: { id: "owner", role: "admin" },
      gatewayAuth: { mode: "none" },
    });
    expect(writeConfigFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          list: [
            expect.objectContaining({
              id: expect.stringMatching(/^agent-[0-9a-f]{12}$/),
              name: "默认",
              workspace: path.join(stateDir, "users", "owner", "default"),
            }),
          ],
        }),
      }),
    );
  });

  it("lets admins create, list, and disable local users", async () => {
    const admin = await initAdmin();

    const create = await jsonRequest("/local-users", {
      method: "POST",
      sessionToken: admin.token,
      body: {
        id: "alice",
        displayName: "Alice",
        password: "alice secure password",
      },
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      ok: true,
      user: { id: "alice", displayName: "Alice", role: "user", status: "active" },
    });
    await expect(fs.stat(path.join(stateDir, "users", "alice", "default"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(stateDir, "users", "alice", "projects"))).resolves.toBeDefined();
    expect(writeConfigFileMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          list: [
            expect.objectContaining({
              id: expect.stringMatching(/^agent-[0-9a-f]{12}$/),
              name: "默认",
              workspace: path.join(stateDir, "users", "alice", "default"),
            }),
          ],
        }),
      }),
    );

    const list = await jsonRequest("/local-users", { sessionToken: admin.token });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      ok: true,
      users: [
        { id: "alice", role: "user", status: "active" },
        { id: "owner", role: "admin", status: "active" },
      ],
    });

    const disable = await jsonRequest("/local-users/alice", {
      method: "PATCH",
      sessionToken: admin.token,
      body: { status: "disabled" },
    });
    expect(disable.status).toBe(200);
    await expect(disable.json()).resolves.toMatchObject({
      ok: true,
      user: { id: "alice", status: "disabled" },
    });

    const login = await jsonRequest("/local-users/login", {
      method: "POST",
      body: {
        id: "alice",
        password: "alice secure password",
      },
    });
    expect(login.status).toBe(401);
  });

  it("preserves every default agent during concurrent user creation", async () => {
    writeConfigFileMock.mockImplementation(async (next?: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      configState.current = structuredClone(next) as typeof configState.current;
    });
    const admin = await initAdmin();

    const createUser = (id: string) =>
      jsonRequest("/local-users", {
        method: "POST",
        sessionToken: admin.token,
        body: {
          id,
          displayName: id,
          password: `${id} secure password`,
        },
      });
    const responses = await Promise.all([createUser("alice"), createUser("bob")]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const workspaces = configState.current.agents?.list
      ?.map((entry) => entry.workspace)
      .filter((workspace): workspace is string => Boolean(workspace));
    expect(workspaces).toEqual(
      expect.arrayContaining([
        path.join(stateDir, "users", "owner", "default"),
        path.join(stateDir, "users", "alice", "default"),
        path.join(stateDir, "users", "bob", "default"),
      ]),
    );
    expect(workspaces).toHaveLength(3);
  });

  it("gives additional admins their own workspace roots", async () => {
    const owner = await initAdmin();
    const create = await jsonRequest("/local-users", {
      method: "POST",
      sessionToken: owner.token,
      body: {
        id: "alice-admin",
        password: "alice admin secure password",
        role: "admin",
      },
    });

    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      user: { id: "alice-admin", role: "admin" },
    });
    await expect(
      fs.stat(path.join(stateDir, "users", "alice-admin", "default")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(stateDir, "users", "alice-admin", "projects")),
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(stateDir, "users", "owner", "projects"))).resolves.toBeDefined();
  });

  it("does not let admins change their own role or enabled status", async () => {
    const admin = await initAdmin();

    const demoteSelf = await jsonRequest("/local-users/owner", {
      method: "PATCH",
      sessionToken: admin.token,
      body: { role: "user" },
    });
    expect(demoteSelf.status).toBe(403);
    await expect(demoteSelf.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "forbidden" },
    });

    const disableSelf = await jsonRequest("/local-users/owner", {
      method: "PATCH",
      sessionToken: admin.token,
      body: { status: "disabled" },
    });
    expect(disableSelf.status).toBe(403);
    await expect(disableSelf.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "forbidden" },
    });

    const list = await jsonRequest("/local-users", { sessionToken: admin.token });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      ok: true,
      users: [{ id: "owner", role: "admin", status: "active" }],
    });
  });

  it("blocks non-admin sessions from managing users", async () => {
    const admin = await initAdmin();
    await jsonRequest("/local-users", {
      method: "POST",
      sessionToken: admin.token,
      body: {
        id: "alice",
        password: "alice secure password",
      },
    });
    const login = await jsonRequest("/local-users/login", {
      method: "POST",
      body: {
        id: "alice",
        password: "alice secure password",
      },
    });
    const alice = (await login.json()) as { token: string };

    const list = await jsonRequest("/local-users", { sessionToken: alice.token });
    expect(list.status).toBe(403);

    const create = await jsonRequest("/local-users", {
      method: "POST",
      sessionToken: alice.token,
      body: {
        id: "bob",
        password: "bob secure password",
      },
    });
    expect(create.status).toBe(403);
  });

  it("requires an admin session before creating users", async () => {
    await initAdmin();

    const response = await jsonRequest("/local-users", { method: "POST" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "unauthorized" },
    });
  });
});
