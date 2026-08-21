import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpSdkMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  listTools: vi.fn(async () => ({ tools: [{ name: "get_weather_forecast" }] })),
  close: vi.fn(async () => {}),
  requestInit: null as unknown,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mcpSdkMocks.connect;
    listTools = mcpSdkMocks.listTools;
    close = mcpSdkMocks.close;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: function MockStreamableHttpTransport(_url: URL, options: unknown) {
    mcpSdkMocks.requestInit = options;
  },
}));

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
  const hooks = new Map<string, () => unknown>();
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
      on: vi.fn((name: string, handler: () => unknown) => {
        hooks.set(name, handler);
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    },
    gatewayMethods,
    hooks,
  };
}

describe("Power Agent identity prompt", () => {
  it("adds a stable product identity without interactive onboarding", async () => {
    const { default: register } = await import("./plugin.js");
    const { api, hooks } = createPluginApiMock();
    register(api as never);

    const hook = hooks.get("before_prompt_build");
    expect(hook).toBeDefined();
    expect(hook?.()).toEqual({
      appendSystemContext: expect.stringContaining("我是您的智能体助手。"),
    });
    expect(JSON.stringify(hook?.())).toContain("不要发起姓名、人格、风格或 Emoji");
  });
});

describe("power.mcp.test", () => {
  beforeEach(() => {
    mcpSdkMocks.connect.mockClear();
    mcpSdkMocks.listTools.mockClear();
    mcpSdkMocks.close.mockClear();
    mcpSdkMocks.requestInit = null;
  });

  it("tests the saved MCP server with its unredacted authorization header", async () => {
    const configModule = await import("../../src/config/config.js");
    vi.mocked(configModule.readConfigFileSnapshot).mockResolvedValueOnce({
      config: {
        mcp: {
          servers: {
            weather: {
              type: "http",
              url: "http://127.0.0.1:3310/mcp",
              headers: { Authorization: "Bearer saved-secret-token" },
            },
          },
        },
      },
    } as never);
    const { default: register } = await import("./plugin.js");
    const { api, gatewayMethods } = createPluginApiMock();
    register(api as never);

    const result = await invokeHandler(gatewayMethods.get("power.mcp.test")!, {
      name: "weather",
    });

    expect(result).toEqual({
      ok: true,
      data: { ok: true, toolCount: 1, tools: ["get_weather_forecast"] },
    });
    expect(mcpSdkMocks.connect).toHaveBeenCalledTimes(1);
    expect(mcpSdkMocks.listTools).toHaveBeenCalledTimes(1);
    expect(mcpSdkMocks.close).toHaveBeenCalledTimes(1);
    expect(mcpSdkMocks.requestInit).toEqual({
      requestInit: { headers: { Authorization: "Bearer saved-secret-token" } },
    });
  });
});

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
