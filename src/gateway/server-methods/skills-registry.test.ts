import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalUser,
  createLocalUserSession,
  resolveLocalUserSkillsDir,
} from "../../users/local-users.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  createSkillsRegistryClient: vi.fn(),
  installRegistrySkill: vi.fn(),
  installRegistrySkillArchive: vi.fn(),
  uninstallRegistrySkill: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../skills-registry/client.js", () => ({
  createSkillsRegistryClient: mocks.createSkillsRegistryClient,
}));

vi.mock("../../skills-registry/install.js", () => ({
  installRegistrySkill: mocks.installRegistrySkill,
  installSkillArchive: mocks.installRegistrySkillArchive,
  uninstallRegistrySkill: mocks.uninstallRegistrySkill,
}));

const { skillsRegistryHandlers } = await import("./skills-registry.js");

function callHandler(method: keyof typeof skillsRegistryHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  const handler = skillsRegistryHandlers[method];
  const promise = handler({
    params,
    respond,
    context: {} as never,
    req: { type: "req", id: "skills-registry-test", method },
    client: null,
    isWebchatConnect: () => false,
  });
  return { promise, respond };
}

describe("skills registry gateway handlers", () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skills-registry-handler-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    mocks.loadConfig.mockReturnValue({});
    mocks.createSkillsRegistryClient.mockReturnValue(null);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  async function createSession(userId: string) {
    await createLocalUser({
      id: userId,
      password: `${userId}-secure-password`,
      stateDir,
    });
    return await createLocalUserSession({ userId, stateDir });
  }

  it("rejects an invalid local-user session before accessing the registry", async () => {
    const { promise, respond } = callHandler("skills.registry.list", {
      userSessionToken: "invalid-token",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "local user session is required" }),
    );
    expect(mocks.createSkillsRegistryClient).not.toHaveBeenCalled();
  });

  it("lists only the authenticated user's local uploads when no registry is configured", async () => {
    const alice = await createSession("alice");
    const bob = await createSession("bob");
    await fs.mkdir(path.join(resolveLocalUserSkillsDir("alice", stateDir), "alice-skill"), {
      recursive: true,
    });

    const aliceCall = callHandler("skills.registry.list", {
      userSessionToken: alice.token,
    });
    await aliceCall.promise;
    const bobCall = callHandler("skills.registry.list", {
      userSessionToken: bob.token,
    });
    await bobCall.promise;

    expect(aliceCall.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        baseUrl: "",
        categories: [{ id: "local", name: "本地技能" }],
        items: [expect.objectContaining({ slug: "alice-skill" })],
      }),
      undefined,
    );
    expect(bobCall.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ categories: [], items: [] }),
      undefined,
    );
  });

  it("merges the local category and installs into the authenticated user's directory", async () => {
    const alice = await createSession("alice");
    const managedSkillsDir = resolveLocalUserSkillsDir("alice", stateDir);
    await fs.mkdir(path.join(managedSkillsDir, "local-upload"), { recursive: true });
    const client = {
      listCatalog: vi.fn().mockResolvedValue({
        baseUrl: "https://skills.example.com",
        categories: [{ id: "ai", name: "AI" }],
        items: [
          {
            slug: "remote-skill",
            displayName: "Remote Skill",
            summary: "remote",
            category: "ai",
            tags: [],
            version: "1.0.0",
            downloads: 1,
            installs: 1,
            stars: 0,
            updatedAt: 1,
            author: null,
          },
        ],
      }),
      downloadArtifact: vi.fn(),
      reportInstall: vi.fn(),
    };
    mocks.loadConfig.mockReturnValue({
      skills: { registry: { enabled: true, baseUrl: "https://skills.example.com" } },
    });
    mocks.createSkillsRegistryClient.mockReturnValue(client);
    mocks.installRegistrySkill.mockResolvedValue({
      slug: "remote-skill",
      version: "1.0.0",
      targetDir: path.join(managedSkillsDir, "remote-skill"),
      message: "Installed",
    });

    const listCall = callHandler("skills.registry.list", {
      userSessionToken: alice.token,
    });
    await listCall.promise;
    expect(listCall.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        categories: [
          { id: "ai", name: "AI" },
          { id: "local", name: "本地技能" },
        ],
        items: expect.arrayContaining([
          expect.objectContaining({ slug: "remote-skill" }),
          expect.objectContaining({ slug: "local-upload", category: "local" }),
        ]),
      }),
      undefined,
    );

    const installCall = callHandler("skills.registry.install", {
      userSessionToken: alice.token,
      slug: "remote-skill",
      version: "1.0.0",
    });
    await installCall.promise;
    expect(mocks.installRegistrySkill).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "remote-skill",
        managedSkillsDir,
      }),
    );
    expect(installCall.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, slug: "remote-skill" }),
      undefined,
    );
  });
});
