import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/config.js", () => ({
  loadConfig: () => ({}),
  readConfigFileSnapshot: vi.fn(async () => ({ config: {} })),
}));

vi.mock("../../src/gateway/auth.js", () => ({
  resolveGatewayAuth: () => ({ mode: "token", token: "test-token" }),
}));

type RegisteredHandler = (options: {
  params?: unknown;
  respond: (ok: boolean, data?: unknown, error?: unknown) => void;
  client?: unknown;
}) => Promise<void>;

async function invokeHandler(handler: RegisteredHandler, params?: unknown) {
  return await new Promise<{ ok: boolean; data?: unknown; error?: unknown }>((resolve) => {
    void handler({
      params,
      respond: (ok, data, error) => resolve({ ok, data, error }),
    });
  });
}

function createPluginApiMock() {
  const gatewayMethods = new Map<string, RegisteredHandler>();
  return {
    api: {
      pluginConfig: {
        roots: ["/tmp"],
        terminal: { enabled: false },
      },
      resolvePath: (input: string) => path.resolve(input),
      registerHttpRoute: vi.fn(),
      registerGatewayMethod: vi.fn((name: string, handler: RegisteredHandler) => {
        gatewayMethods.set(name, handler);
      }),
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

describe("power.code.settings.set", () => {
  const originalHome = process.env.HOME;
  let tempHomeDir = "";

  beforeEach(async () => {
    tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "power-code-settings-test-"));
    process.env.HOME = tempHomeDir;
    await fs.mkdir(path.join(tempHomeDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tempHomeDir, ".claude", "settings.json"),
      `${JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: "https://old.example/v1",
            ANTHROPIC_AUTH_TOKEN: "token-old",
            ANTHROPIC_API_KEY: "apikey-old",
            ANTHROPIC_MODEL: "old-model",
            ANTHROPIC_SMALL_FAST_MODEL: "old-small",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (tempHomeDir) {
      await fs.rm(tempHomeDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("preserves auth fields when partial payload omits them", async () => {
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock();
    register(api as never);

    const setHandler = gatewayMethods.get("power.code.settings.set");
    const getHandler = gatewayMethods.get("power.code.settings.get");
    expect(setHandler).toBeDefined();
    expect(getHandler).toBeDefined();

    const setResult = await invokeHandler(setHandler!, {
      baseUrl: "https://new.example/v1",
      model: "new-model",
    });
    expect(setResult.ok).toBe(true);

    const getResult = await invokeHandler(getHandler!);
    expect(getResult.ok).toBe(true);
    expect(getResult.data).toMatchObject({
      settings: {
        baseUrl: "https://new.example/v1",
        model: "new-model",
        authToken: "token-old",
        apiKey: "apikey-old",
        smallFastModel: "old-small",
      },
    });
  });

  it("clears auth fields only when empty strings are explicitly provided", async () => {
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock();
    register(api as never);

    const setHandler = gatewayMethods.get("power.code.settings.set");
    const getHandler = gatewayMethods.get("power.code.settings.get");
    expect(setHandler).toBeDefined();
    expect(getHandler).toBeDefined();

    const setResult = await invokeHandler(setHandler!, {
      authToken: "",
      apiKey: "",
    });
    expect(setResult.ok).toBe(true);

    const getResult = await invokeHandler(getHandler!);
    expect(getResult.ok).toBe(true);
    expect(getResult.data).toMatchObject({
      settings: {
        authToken: "",
        apiKey: "",
        baseUrl: "https://old.example/v1",
        model: "old-model",
      },
    });
  });
});
