import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/config.js", () => ({
  loadConfig: () => ({
    models: {
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "test-key",
          models: [{ id: "deepseek-chat" }],
        },
      },
    },
  }),
  readConfigFileSnapshot: vi.fn(async () => ({
    config: {
      models: {
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "test-key",
            models: [{ id: "deepseek-chat" }],
          },
        },
      },
    },
  })),
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
    for (const key of [
      "ANTHROPIC_AUTH_TOKEN",
      "OPENCLAW_CLAUDE_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "OPENCLAW_CLAUDE_API_KEY",
      "DEEPSEEK_API_KEY",
    ]) {
      vi.stubEnv(key, "");
    }
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
    vi.unstubAllEnvs();
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

describe("power.models.testText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies the model request through the gateway process", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock();
    register(api as never);

    const handler = gatewayMethods.get("power.models.testText");
    expect(handler).toBeDefined();
    const result = await invokeHandler(handler!, {
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(result).toEqual({ ok: true, data: { content: "ok" }, error: undefined });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.deepseek.com/v1/chat/completions"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses Ollama's native chat API when the provider is configured as ollama", async () => {
    const { readConfigFileSnapshot } = await import("../../src/config/config.js");
    vi.mocked(readConfigFileSnapshot).mockResolvedValueOnce({
      config: {
        models: {
          providers: {
            ollama: {
              api: "ollama",
              apiKey: "ollama-local",
              baseUrl: "http://127.0.0.1:11434",
              models: [{ id: "qwen3-vl:4b", name: "qwen3-vl:4b" }],
            },
          },
        },
      },
    } as never);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock();
    register(api as never);

    const handler = gatewayMethods.get("power.models.testText");
    expect(handler).toBeDefined();
    const result = await invokeHandler(handler!, {
      provider: "ollama",
      model: "qwen3-vl:4b",
    });

    expect(result).toEqual({ ok: true, data: { content: "ok" }, error: undefined });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:11434/api/chat"),
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof request.body !== "string") {
      throw new TypeError("expected request body to be a JSON string");
    }
    expect(JSON.parse(request.body) as unknown).toMatchObject({
      model: "qwen3-vl:4b",
      options: { num_predict: 8, temperature: 0 },
      stream: false,
    });
  });
});
