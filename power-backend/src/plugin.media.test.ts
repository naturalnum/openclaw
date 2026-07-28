import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  workspace: "",
}));

vi.mock("../../src/agents/agent-scope.js", () => ({
  listAgentIds: () => ["agent-1"],
  resolveAgentWorkspaceDir: () => testState.workspace,
}));

vi.mock("../../src/config/config.js", () => ({
  loadConfig: () => ({}),
  readConfigFileSnapshot: async () => ({ config: {} }),
}));

vi.mock("../../src/gateway/auth.js", () => ({
  resolveGatewayAuth: () => ({ mode: "token", token: "test-token" }),
}));

type RegisteredHandler = (options: {
  params?: Record<string, unknown>;
  respond: (ok: boolean, data?: unknown, error?: unknown) => void;
  client?: unknown;
}) => Promise<void>;

async function invokeHandler(handler: RegisteredHandler, params?: Record<string, unknown>) {
  return await new Promise<{ ok: boolean; data?: unknown; error?: unknown }>((resolve) => {
    void handler({
      params,
      respond: (ok, data, error) => resolve({ ok, data, error }),
    });
  });
}

function createPluginApiMock(
  runFile: ReturnType<typeof vi.fn>,
  detectMime: ReturnType<typeof vi.fn> = vi.fn(async ({ filePath }: { filePath?: string }) =>
    filePath?.endsWith(".mp4") ? "video/mp4" : "audio/mpeg",
  ),
) {
  const gatewayMethods = new Map<string, RegisteredHandler>();
  return {
    api: {
      pluginConfig: { roots: [], terminal: { enabled: false } },
      resolvePath: (input: string) => path.resolve(input),
      registerHttpRoute: vi.fn(),
      registerGatewayMethod: vi.fn((name: string, handler: RegisteredHandler) => {
        gatewayMethods.set(name, handler);
      }),
      runtime: {
        media: {
          detectMime,
          mediaKindFromMime: vi.fn((mime?: string) =>
            mime?.startsWith("video/") ? "video" : mime?.startsWith("audio/") ? "audio" : undefined,
          ),
        },
        mediaUnderstanding: { runFile },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    },
    gatewayMethods,
  };
}

describe("power.media.prepareWorkspaceFile", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "power-media-test-"));
    testState.workspace = path.join(tempDir, "workspace");
    await fs.mkdir(path.join(testState.workspace, ".chat-uploads"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes an audio transcript sidecar inside the same workspace directory", async () => {
    await fs.writeFile(path.join(testState.workspace, ".chat-uploads", "meeting.mp3"), "audio");
    const runFile = vi.fn(async () => ({ text: "会议转写内容" }));
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock(runFile);
    register(api as never);

    const handler = gatewayMethods.get("power.media.prepareWorkspaceFile");
    expect(handler).toBeDefined();
    const result = await invokeHandler(handler!, {
      agentId: "agent-1",
      path: ".chat-uploads/meeting.mp3",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { prepared: true, readablePath: ".chat-uploads/meeting.mp3.txt" },
    });
    expect(
      await fs.readFile(path.join(testState.workspace, ".chat-uploads", "meeting.mp3.txt"), "utf8"),
    ).toBe("会议转写内容");
    expect(runFile).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "audio", mime: "audio/mpeg" }),
    );
  });

  it("returns an honest warning when no media provider can prepare the file", async () => {
    await fs.writeFile(path.join(testState.workspace, ".chat-uploads", "clip.mp4"), "video");
    const runFile = vi.fn(async () => ({ text: undefined }));
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock(runFile);
    register(api as never);

    const result = await invokeHandler(gatewayMethods.get("power.media.prepareWorkspaceFile")!, {
      agentId: "agent-1",
      path: ".chat-uploads/clip.mp4",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { prepared: false, warning: expect.stringContaining("视频理解") },
    });
    await expect(
      fs.stat(path.join(testState.workspace, ".chat-uploads", "clip.mp4.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the accepted file extension when binary sniffing cannot identify the media", async () => {
    await fs.writeFile(path.join(testState.workspace, ".chat-uploads", "recording.caf"), "audio");
    const runFile = vi.fn(async () => ({ text: "CAF 转写" }));
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock(
      runFile,
      vi.fn(async () => undefined),
    );
    register(api as never);

    const result = await invokeHandler(gatewayMethods.get("power.media.prepareWorkspaceFile")!, {
      agentId: "agent-1",
      path: ".chat-uploads/recording.caf",
    });

    expect(result).toMatchObject({ ok: true, data: { prepared: true } });
    expect(runFile).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "audio", mime: "audio/x-caf" }),
    );
  });

  it("rejects paths outside the selected agent workspace", async () => {
    const outsidePath = path.join(tempDir, "outside.mp3");
    await fs.writeFile(outsidePath, "audio");
    const runFile = vi.fn();
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock(runFile);
    register(api as never);

    const result = await invokeHandler(gatewayMethods.get("power.media.prepareWorkspaceFile")!, {
      agentId: "agent-1",
      path: outsidePath,
    });

    expect(result.ok).toBe(false);
    expect(runFile).not.toHaveBeenCalled();
  });
});
