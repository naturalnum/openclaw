import { describe, expect, it } from "vitest";

import {
  resolveChatModelPool,
  resolveEffectiveChatModelRef,
} from "./configured-chat-models";
import type { WorkbenchSnapshot } from "../../adapters/mock-workbench-adapter";

function minimalSnapshot(overrides: Partial<WorkbenchSnapshot> = {}): WorkbenchSnapshot {
  return {
    assistantName: "OpenClaw",
    currentProjectId: null,
    currentSessionKey: "",
    agentsList: { defaultId: "main", agents: [] },
    agentIdentityById: {},
    agentFilesList: null,
    sessionsResult: { sessions: [], defaults: {} },
    chatMessages: [],
    skillsReport: { workspaceDir: "", managedSkillsDir: "", skills: [] },
    cronJobs: [],
    modelCatalog: [
      {
        id: "nova-lite",
        name: "Nova Lite",
        provider: "amazon-bedrock",
        contextWindow: 300_000,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        provider: "deepseek",
      },
    ],
    toolsCatalogResult: null,
    ...overrides,
  };
}

describe("resolveChatModelPool", () => {
  it("prefers models.providers from openclaw config over full gateway catalog", () => {
    const snapshot = minimalSnapshot({
      openclawConfig: {
        models: {
          providers: {
            deepseek: {
              baseUrl: "https://api.deepseek.com/v1",
              models: [{ id: "deepseek-reasoner", name: "deepseek-resoner" }],
            },
          },
        },
      },
    });
    const pool = resolveChatModelPool(snapshot, null, "");
    expect(pool).toHaveLength(1);
    expect(pool[0]?.provider).toBe("deepseek");
    expect(pool[0]?.id).toBe("deepseek-reasoner");
    expect(pool[0]?.name).toBe("deepseek-resoner");
  });

  it("does not fall back to full gateway catalog when providers are configured", () => {
    const snapshot = minimalSnapshot({
      openclawConfig: {
        models: {
          providers: {
            deepseek: {
              models: [{ id: "deepseek-reasoner", name: "DeepSeek" }],
            },
          },
        },
      },
    });
    const pool = resolveChatModelPool(snapshot, null, "");
    expect(pool).toHaveLength(1);
    expect(pool.some((m) => m.id === "nova-lite")).toBe(false);
  });
});

describe("resolveEffectiveChatModelRef", () => {
  const pool = [
    {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
      provider: "deepseek",
    },
    {
      id: "minimax-2.7",
      name: "MiniMax 2.7",
      provider: "minimax",
    },
  ] as const;

  it("prefers session-bound model over chat preference when sessionKey is set", () => {
    const snapshot = minimalSnapshot({
      openclawConfig: {
        agents: { defaults: { model: { primary: "deepseek/deepseek-reasoner" } } },
      },
      sessionsResult: {
        sessions: [{ key: "agent:main:chat:abc", model: "minimax/minimax-2.7" }],
        defaults: {},
      },
    });
    const ref = resolveEffectiveChatModelRef({
      snapshot,
      sessionKey: "agent:main:chat:abc",
      chatPreferredModelRef: "deepseek/deepseek-reasoner",
      configuredModels: [...pool],
    });
    expect(ref).toBe("minimax/minimax-2.7");
  });

  it("uses chat preference before primary when no session binding", () => {
    const snapshot = minimalSnapshot({
      openclawConfig: {
        agents: { defaults: { model: { primary: "deepseek/deepseek-reasoner" } } },
      },
    });
    const ref = resolveEffectiveChatModelRef({
      snapshot,
      sessionKey: "",
      chatPreferredModelRef: "minimax/minimax-2.7",
      configuredModels: [...pool],
    });
    expect(ref).toBe("minimax/minimax-2.7");
  });
});
