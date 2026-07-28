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
  resolveLocalUserDefaultAgentId,
  resolveLocalUserDefaultWorkspace,
  resolveLocalUserProjectsDir,
  resolveLocalUserProfilePath,
  resolveLocalUserSession,
  resolveLocalUserSkillsDir,
  revokeLocalUserSession,
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

  it("derives a stable private default-agent id per user", () => {
    expect(resolveLocalUserDefaultAgentId("owner")).toMatch(/^agent-[0-9a-f]{12}$/);
    expect(resolveLocalUserDefaultAgentId("owner")).toBe(resolveLocalUserDefaultAgentId("OWNER"));
    expect(resolveLocalUserDefaultAgentId("owner")).not.toBe(
      resolveLocalUserDefaultAgentId("alice"),
    );
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
    await expect(
      fs.stat(resolveLocalUserDefaultWorkspace("owner", stateDir)),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(fs.stat(resolveLocalUserProjectsDir("owner", stateDir))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(hasAnyLocalUsers({ stateDir })).resolves.toBe(true);
    await expect(
      initializeLocalAdmin({
        id: "second-admin",
        password: "another secure password",
        stateDir,
      }),
    ).rejects.toThrow("admin initialization is only available once");
  });

  it("allows only one concurrent first-admin initialization per state directory", async () => {
    const attempts = await Promise.allSettled([
      initializeLocalAdmin({
        id: "owner",
        password: "owner secure password",
        stateDir,
      }),
      initializeLocalAdmin({
        id: "second-admin",
        password: "second secure password",
        stateDir,
      }),
    ]);

    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining("admin initialization is only available once"),
      }),
    });
    await expect(listLocalUsers({ stateDir })).resolves.toEqual([
      expect.objectContaining({ role: "admin" }),
    ]);
  });

  it("keeps first-admin initialization independent across state directories", async () => {
    const otherStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-users-other-"));
    try {
      const [first, second] = await Promise.all([
        initializeLocalAdmin({
          id: "owner",
          password: "owner secure password",
          stateDir,
        }),
        initializeLocalAdmin({
          id: "owner",
          password: "owner secure password",
          stateDir: otherStateDir,
        }),
      ]);

      expect(first).toMatchObject({ id: "owner", role: "admin" });
      expect(second).toMatchObject({ id: "owner", role: "admin" });
    } finally {
      await fs.rm(otherStateDir, { recursive: true, force: true });
    }
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
    expect(resolveLocalUserProfilePath("alice", stateDir)).toBe(
      path.join(stateDir, "auth", "users", "alice", "profile.json"),
    );
    await expect(fs.stat(path.join(stateDir, "users", "alice", "default"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(stateDir, "users", "alice", "projects"))).resolves.toBeDefined();
    await expect(fs.stat(resolveLocalUserSkillsDir("alice", stateDir))).resolves.toBeDefined();
  });

  it("migrates legacy user profiles and sessions into auth without deleting user workspaces", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });
    const session = await createLocalUserSession({ userId: "alice", stateDir });
    const canonicalProfile = resolveLocalUserProfilePath("alice", stateDir);
    const legacyProfile = path.join(stateDir, "users", "alice", "profile.json");
    await fs.rename(canonicalProfile, legacyProfile);
    const canonicalSessions = path.join(stateDir, "auth", "sessions.json");
    const legacySessions = path.join(stateDir, "users", "_sessions.json");
    await fs.rename(canonicalSessions, legacySessions);

    await expect(readLocalUser("alice", { stateDir })).resolves.toMatchObject({ id: "alice" });
    await expect(
      resolveLocalUserSession({ token: session.token, stateDir }),
    ).resolves.toMatchObject({ user: { id: "alice" } });
    await expect(fs.stat(canonicalProfile)).resolves.toBeDefined();
    await expect(fs.stat(canonicalSessions)).resolves.toBeDefined();
    await expect(fs.stat(path.join(stateDir, "users", "alice", "projects"))).resolves.toBeDefined();
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
    const sessionsRaw = await fs.readFile(path.join(stateDir, "auth", "sessions.json"), "utf8");
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

  it("preserves every session created concurrently in one state directory", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });
    const now = new Date("2026-03-01T00:00:00.000Z");
    const sessions = await Promise.all(
      Array.from({ length: 12 }, () =>
        createLocalUserSession({
          userId: "alice",
          stateDir,
          now,
        }),
      ),
    );

    const persisted = JSON.parse(
      await fs.readFile(path.join(stateDir, "auth", "sessions.json"), "utf8"),
    ) as { sessions: unknown[] };
    expect(persisted.sessions).toHaveLength(sessions.length);
    await expect(
      Promise.all(
        sessions.map(({ token }) =>
          resolveLocalUserSession({
            token,
            stateDir,
            now: new Date("2026-03-01T00:00:01.000Z"),
          }),
        ),
      ),
    ).resolves.toEqual(
      sessions.map(() =>
        expect.objectContaining({
          user: expect.objectContaining({ id: "alice" }),
          session: expect.objectContaining({ userId: "alice" }),
        }),
      ),
    );
  });

  it("revokes only the selected local-user session", async () => {
    await createLocalUser({
      id: "alice",
      password: "alice secure password",
      stateDir,
    });
    const first = await createLocalUserSession({ userId: "alice", stateDir });
    const second = await createLocalUserSession({ userId: "alice", stateDir });

    await expect(revokeLocalUserSession({ token: first.token, stateDir })).resolves.toBe(true);
    await expect(resolveLocalUserSession({ token: first.token, stateDir })).resolves.toBeNull();
    await expect(resolveLocalUserSession({ token: second.token, stateDir })).resolves.toMatchObject(
      {
        user: { id: "alice" },
      },
    );
    await expect(revokeLocalUserSession({ token: first.token, stateDir })).resolves.toBe(false);
  });

  it("rejects unsafe user ids", () => {
    expect(validateLocalUserId("Alice_01")).toBe("alice_01");
    expect(() => validateLocalUserId("../alice")).toThrow("User ID must be");
    expect(() => validateLocalUserId("_sessions")).toThrow("User ID must be");
  });
});
