import { describe, expect, it } from "vitest";
import { buildNextGlobalModelConfig, createEmptyModelConfig } from "./global-model-config";

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
    };
    const next = buildNextGlobalModelConfig({
      config: {},
      modelConfigs: [row],
      currentModelId: "deepseek/deepseek-chat",
    }) as { models?: { providers?: Record<string, Record<string, unknown>> } };

    expect(next.models?.providers?.deepseek).toMatchObject({
      baseUrl: "https://api.deepseek.com/v1",
      models: [{ id: "deepseek-chat", name: "DeepSeek" }],
    });
    expect(next.models?.providers?.deepseek).not.toHaveProperty("apiKey");
  });
});
