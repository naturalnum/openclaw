import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let stateDir = "";
const writeConfigFileMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => stateDir,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
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

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleLocalUsersHttpRequest(req, res, {
      auth: { mode: "none", allowTailscale: false },
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
  writeConfigFileMock.mockClear();
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-users-http-"));
});

afterEach(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

function localUsersUrl(pathname: string) {
  return `http://127.0.0.1:${port}${pathname}`;
}

async function jsonRequest(
  pathname: string,
  init: { method?: string; body?: unknown; origin?: string; sessionToken?: string } = {},
) {
  return await fetch(localUsersUrl(pathname), {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
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
  return (await response.json()) as { token: string; user: { id: string; role: string } };
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

  it("reports initialization status and initializes the first admin", async () => {
    const before = await jsonRequest("/local-users/status");
    await expect(before.json()).resolves.toEqual({ ok: true, initialized: false });

    const initialized = await initAdmin();
    expect(initialized).toMatchObject({
      user: { id: "owner", role: "admin" },
      token: expect.any(String),
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
    });
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
