import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-workspace"),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
}));

const { workspaceHandlers } = await import("./workspace.js");

function makeCall(method: keyof typeof workspaceHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  const promise = workspaceHandlers[method]({
    params,
    respond,
    context: {} as never,
    req: { type: "req" as const, id: "1", method },
    client: null,
    isWebchatConnect: () => false,
  });
  return { respond, promise };
}

describe("workspaceHandlers", () => {
  const originalWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  beforeEach(() => {
    delete process.env.OPENCLAW_WORKSPACE_ROOT;
    mocks.loadConfig.mockReset();
    mocks.resolveDefaultAgentId.mockReset();
    mocks.resolveAgentWorkspaceDir.mockReset();
    mocks.loadConfig.mockReturnValue({ agents: { defaults: { workspace: "/configured/ws" } } });
    mocks.resolveDefaultAgentId.mockReturnValue("main");
    mocks.resolveAgentWorkspaceDir.mockReturnValue("/configured/ws");
  });

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.OPENCLAW_WORKSPACE_ROOT;
    } else {
      process.env.OPENCLAW_WORKSPACE_ROOT = originalWorkspaceRoot;
    }
  });

  it("lists the configured default agent workspace instead of process cwd", async () => {
    const cwdRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-cwd-"));
    const workspaceRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-root-"));
    const cwdRoot = await fs.realpath(cwdRootRaw);
    const workspaceRoot = await fs.realpath(workspaceRootRaw);
    try {
      await fs.writeFile(path.join(cwdRoot, "from-cwd.txt"), "cwd", "utf8");
      await fs.writeFile(path.join(workspaceRoot, "from-workspace.txt"), "workspace", "utf8");
      mocks.resolveAgentWorkspaceDir.mockReturnValue(workspaceRoot);

      const previousCwd = process.cwd();
      process.chdir(cwdRoot);
      try {
        const { respond, promise } = makeCall("workspace.list", {});
        await promise;

        expect(respond).toHaveBeenCalledWith(
          true,
          expect.objectContaining({
            root: workspaceRoot,
            entries: expect.arrayContaining([
              expect.objectContaining({ name: "from-workspace.txt" }),
            ]),
          }),
          undefined,
        );
        const [, payload] = respond.mock.calls[0] ?? [];
        expect(
          (payload as { entries: Array<{ name: string }> }).entries.some(
            (entry) => entry.name === "from-cwd.txt",
          ),
        ).toBe(false);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      await fs.rm(cwdRootRaw, { recursive: true, force: true });
      await fs.rm(workspaceRootRaw, { recursive: true, force: true });
    }
  });

  it("still honors OPENCLAW_WORKSPACE_ROOT when set", async () => {
    const envRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-env-"));
    const envRoot = await fs.realpath(envRootRaw);
    try {
      process.env.OPENCLAW_WORKSPACE_ROOT = envRoot;
      await fs.writeFile(path.join(envRoot, "from-env.txt"), "env", "utf8");

      const { respond, promise } = makeCall("workspace.list", {});
      await promise;

      expect(mocks.loadConfig).not.toHaveBeenCalled();
      expect(mocks.resolveAgentWorkspaceDir).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          root: envRoot,
          entries: expect.arrayContaining([expect.objectContaining({ name: "from-env.txt" })]),
        }),
        undefined,
      );
    } finally {
      await fs.rm(envRootRaw, { recursive: true, force: true });
    }
  });

  it("allows downloading files larger than the old 32 MB browser transfer limit", async () => {
    const workspaceRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-dl-"));
    const workspaceRoot = await fs.realpath(workspaceRootRaw);
    const largeFilePath = path.join(workspaceRoot, "large.bin");
    try {
      process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
      const largeFileSize = 33 * 1024 * 1024;
      await fs.writeFile(largeFilePath, Buffer.alloc(largeFileSize, 0x61));

      const { respond, promise } = makeCall("workspace.download", { path: "large.bin" });
      await promise;

      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          file: expect.objectContaining({
            name: "large.bin",
            path: "large.bin",
            size: largeFileSize,
          }),
        }),
        undefined,
      );
    } finally {
      await fs.rm(workspaceRootRaw, { recursive: true, force: true });
    }
  });
});
