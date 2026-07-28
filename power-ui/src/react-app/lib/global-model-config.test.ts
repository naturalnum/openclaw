import { describe, expect, it } from "vitest";
import {
  buildNextGlobalModelConfig,
  createEmptyModelConfig,
  readGlobalModelConfigs,
  resolveTemporaryChatWorkspacePath,
} from "./global-model-config";

describe("resolveTemporaryChatWorkspacePath", () => {
  it("places quick-chat workspaces under the selected local-user agent workspace", () => {
    const workspace = resolveTemporaryChatWorkspacePath(
      {
        agents: {
          defaults: { workspace: "/srv/agent/data/workspace" },
          list: [
            {
              id: "u-admin-default",
              workspace: "/srv/agent/data/users/admin/default",
            },
          ],
        },
      },
      "admin",
      "agent:u-admin-default:user:u-admin:quick:session-1",
      "u-admin-default",
    );

    expect(workspace).toBe(
      "/srv/agent/data/users/admin/default/temp/agent-u-admin-default-user-u-admin-quick-session-1",
    );
  });

  it("normalizes Windows agent workspaces for quick-chat paths", () => {
    const workspace = resolveTemporaryChatWorkspacePath(
      {
        agents: {
          list: [
            {
              id: "admin-default",
              workspace: "C:\\agent\\data\\users\\admin\\default",
            },
          ],
        },
      },
      "admin",
      "agent:admin-default:quick:session-1",
      "admin-default",
    );

    expect(workspace).toBe(
      "C:/agent/data/users/admin/default/temp/agent-admin-default-quick-session-1",
    );
  });
});

describe("buildNextGlobalModelConfig", () => {
  it("does not serialize an enabled placeholder row", () => {
    const row = { ...createEmptyModelConfig(), enabled: true };
    const next = buildNextGlobalModelConfig({
      config: {},
      modelConfigs: [row],
      currentModelId: "",
    });

    expect(next).toMatchObject({ models: { providers: {} } });
  });

  it("omits an empty API key from a complete provider", () => {
    const row = {
      ...createEmptyModelConfig(),
      enabled: true,
      provider: "deepseek",
      model: "deepseek-chat",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      input: ["text"] as Array<"text" | "image">,
    };
    const next = buildNextGlobalModelConfig({
      config: {},
      modelConfigs: [row],
      currentModelId: "deepseek/deepseek-chat",
    }) as { models?: { providers?: Record<string, Record<string, unknown>> } };

    expect(next.models?.providers?.deepseek).toMatchObject({
      baseUrl: "https://api.deepseek.com/v1",
      models: [{ id: "deepseek-chat", name: "DeepSeek", input: ["text"] }],
    });
    expect(next.models?.providers?.deepseek).not.toHaveProperty("apiKey");
    expect(next).toMatchObject({
      models: {
        mode: "replace",
      },
      agents: {
        defaults: {
          models: { "deepseek/deepseek-chat": {} },
        },
      },
    });
  });

  it("round-trips image input capability", () => {
    const row = {
      ...createEmptyModelConfig(),
      enabled: true,
      provider: "local-vision",
      model: "deepseek-vl2",
      name: "DeepSeek VL2",
      baseUrl: "http://127.0.0.1:8000/v1",
      input: ["text", "image"] as Array<"text" | "image">,
    };
    const next = buildNextGlobalModelConfig({
      config: {},
      modelConfigs: [row],
      currentModelId: "local-vision/deepseek-vl2",
    });

    expect(next).toMatchObject({
      models: {
        providers: {
          "local-vision": {
            models: [{ id: "deepseek-vl2", input: ["text", "image"] }],
          },
        },
      },
    });
    expect(readGlobalModelConfigs(next)[0]?.input).toEqual(["text", "image"]);
  });

  it("marks a configured API key as explicit auth", () => {
    const row = {
      ...createEmptyModelConfig(),
      enabled: true,
      provider: "deepseek",
      model: "deepseek-chat",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-current-config", // pragma: allowlist secret
    };
    const next = buildNextGlobalModelConfig({
      config: {},
      modelConfigs: [row],
      currentModelId: "deepseek/deepseek-chat",
    });

    expect(next).toMatchObject({
      models: {
        providers: {
          deepseek: {
            auth: "api-key",
            apiKey: "sk-current-config",
          },
        },
      },
    });
  });

  it("adds configured refs to the allowlist while preserving existing model options", () => {
    const row = {
      ...createEmptyModelConfig(),
      enabled: true,
      provider: "ollama",
      model: "qwen3-vl:4b",
      name: "qwen3-vl:4b",
      baseUrl: "http://127.0.0.1:11434/v1",
      input: ["text", "image"] as Array<"text" | "image">,
    };
    const next = buildNextGlobalModelConfig({
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: "http://127.0.0.1:11434",
              api: "ollama",
              models: [
                {
                  id: "qwen3-vl:4b",
                  name: "qwen3-vl:4b",
                  contextWindow: 32768,
                  maxTokens: 2048,
                  reasoning: false,
                },
              ],
            },
          },
        },
        agents: {
          defaults: {
            models: {
              "deepseek/deepseek-chat": { alias: "deepseek" },
            },
          },
        },
      },
      modelConfigs: [row],
      currentModelId: "ollama/qwen3-vl:4b",
    });

    expect(next).toMatchObject({
      models: {
        providers: {
          ollama: {
            api: "ollama",
            baseUrl: "http://127.0.0.1:11434",
            models: [
              {
                id: "qwen3-vl:4b",
                contextWindow: 32768,
                maxTokens: 2048,
                reasoning: false,
              },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: "ollama/qwen3-vl:4b" },
          models: {
            "deepseek/deepseek-chat": { alias: "deepseek" },
            "ollama/qwen3-vl:4b": {},
          },
        },
      },
    });
  });
});
