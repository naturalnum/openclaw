import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateLocalUser,
  createLocalUser,
  createLocalUserSession,
  hasAnyLocalUsers,
  initializeLocalAdmin,
  listLocalUsers,
  readLocalUser,
  resolveLocalUserSession,
  updateLocalUser,
  validateLocalUserId,
} from "./local-users.js";

describe("local users", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-users-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("initializes the first local admin once", async () => {
    await expect(hasAnyLocalUsers({ stateDir })).resolves.toBe(false);

    const admin = await initializeLocalAdmin({
      id: "Owner",
      password: "correct horse battery staple",
      stateDir,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(admin).toMatchObject({
      id: "owner",
      displayName: "owner",
      role: "admin",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(admin).not.toHaveProperty("passwordHash");
    await expect(hasAnyLocalUsers({ stateDir })).resolves.toBe(true);
    await expect(
      initializeLocalAdmin({
        id: "second-admin",
        password: "another secure password",
        stateDir,
      }),
    ).rejects.toThrow("admin initialization is only available once");
  });

  it("creates users and keeps private password hashes out of public listings", async () => {
    await createLocalUser({
      id: "alice",
      displayName: "Alice",
      password: "alice secure password",
      stateDir,
    });

    expect(await listLocalUsers({ stateDir })).toEqual([
      expect.objectContaining({
        id: "alice",
        displayName: "Alice",
        role: "user",
        status: "active",
      }),
    ]);
    expect(await listLocalUsers({ stateDir })).not.toEqual([
      expect.objectContaining({ passwordHash: expect.any(String) }),
    ]);
    const stored = await readLocalUser("alice", { stateDir });
    expect(stored?.passwordHash).toMatch(/^scrypt:v1:/);
  });

  it("authenticates active users and rejects wrong credentials", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });

    await expect(
      authenticateLocalUser({
        id: "alice",
        password: "alice secure password",
        stateDir,
        now: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      ok: true,
      user: {
        id: "alice",
        lastLoginAt: "2026-02-01T00:00:00.000Z",
      },
    });
    await expect(
      authenticateLocalUser({
        id: "alice",
        password: "wrong password",
        stateDir,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid-password" });
    await expect(
      authenticateLocalUser({
        id: "missing",
        password: "alice secure password",
        stateDir,
      }),
    ).resolves.toEqual({ ok: false, error: "not-found" });
  });

  it("updates local users and rejects disabled logins", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });

    await expect(
      updateLocalUser({
        id: "alice",
        displayName: "Alice Updated",
        role: "admin",
        status: "disabled",
        stateDir,
        now: new Date("2026-02-02T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "alice",
      displayName: "Alice Updated",
      role: "admin",
      status: "disabled",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    await expect(
      authenticateLocalUser({
        id: "alice",
        password: "alice secure password",
        stateDir,
      }),
    ).resolves.toEqual({ ok: false, error: "disabled" });

    await updateLocalUser({
      id: "alice",
      password: "alice new secure password",
      status: "active",
      stateDir,
    });
    await expect(
      authenticateLocalUser({
        id: "alice",
        password: "alice secure password",
        stateDir,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid-password" });
    await expect(
      authenticateLocalUser({
        id: "alice",
        password: "alice new secure password",
        stateDir,
      }),
    ).resolves.toMatchObject({ ok: true, user: { id: "alice" } });
  });

  it("creates resolvable sessions without storing plaintext tokens", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });

    const result = await createLocalUserSession({
      userId: "alice",
      stateDir,
      now: new Date("2026-03-01T00:00:00.000Z"),
      ttlMs: 1000,
    });

    expect(result.token).toHaveLength(43);
    expect(result.session).toMatchObject({
      userId: "alice",
      createdAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:01.000Z",
    });
    const sessionsRaw = await fs.readFile(path.join(stateDir, "users", "_sessions.json"), "utf8");
    expect(sessionsRaw).not.toContain(result.token);
    await expect(
      resolveLocalUserSession({
        token: result.token,
        stateDir,
        now: new Date("2026-03-01T00:00:00.500Z"),
      }),
    ).resolves.toMatchObject({
      user: { id: "alice" },
      session: { userId: "alice" },
    });
    await expect(
      resolveLocalUserSession({
        token: result.token,
        stateDir,
        now: new Date("2026-03-01T00:00:02.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("rejects unsafe user ids", () => {
    expect(validateLocalUserId("Alice_01")).toBe("alice_01");
    expect(() => validateLocalUserId("../alice")).toThrow("User ID must be");
    expect(() => validateLocalUserId("_sessions")).toThrow("User ID must be");
  });
});
