import { describe, expect, it } from "vitest";
import { evaluateNetworkToolCall, normalizeConfig } from "./index.ts";

describe("network-guard-plugin", () => {
  const resolveHostAddresses = async (host: string) => {
    if (host === "blocked.example") {
      return ["203.0.113.10"];
    }
    return [];
  };

  it("blocks configured URL prefixes", async () => {
    const reason = await evaluateNetworkToolCall({
      toolName: "web_fetch",
      toolParams: { url: "https://blocked.example/private/report" },
      config: normalizeConfig({
        blockedUrlPrefixes: ["https://blocked.example/private/"],
      }),
      resolveHostAddresses,
    });

    expect(reason).toBe("blocked URL prefix: https://blocked.example/private/");
  });

  it("blocks configured hosts and subdomains", async () => {
    const reason = await evaluateNetworkToolCall({
      toolName: "web_fetch",
      toolParams: { url: "https://api.blocked.example/v1" },
      config: normalizeConfig({
        blockedHosts: ["blocked.example"],
      }),
      resolveHostAddresses,
    });

    expect(reason).toBe("blocked host: blocked.example");
  });

  it("blocks shell commands that target configured hosts", async () => {
    const reason = await evaluateNetworkToolCall({
      toolName: "exec",
      toolParams: { command: "curl https://blocked.example/data" },
      config: normalizeConfig({
        blockedHosts: ["blocked.example"],
      }),
      resolveHostAddresses,
    });

    expect(reason).toBe("blocked host: blocked.example");
  });

  it("allows unrelated URLs", async () => {
    const reason = await evaluateNetworkToolCall({
      toolName: "web_fetch",
      toolParams: { url: "https://allowed.example/data" },
      config: normalizeConfig({
        blockedHosts: ["blocked.example"],
      }),
      resolveHostAddresses,
    });

    expect(reason).toBeNull();
  });
});
