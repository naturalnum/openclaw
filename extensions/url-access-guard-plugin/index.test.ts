import { describe, expect, it } from "vitest";
import { evaluateUrlAccess, normalizeConfig } from "./index.ts";

describe("url-access-guard-plugin", () => {
  it("blocks configured domains in blocklist mode", () => {
    const reason = evaluateUrlAccess({
      toolName: "web_fetch",
      toolParams: { url: "https://forbidden.example/path" },
      config: normalizeConfig({
        mode: "blocklist",
        blocklist: ["forbidden.example"],
      }),
    });

    expect(reason).toContain("blocked URL access to forbidden.example");
  });

  it("allows unrelated public domains in blocklist mode", () => {
    const reason = evaluateUrlAccess({
      toolName: "web_fetch",
      toolParams: { url: "https://allowed.example/path" },
      config: normalizeConfig({
        mode: "blocklist",
        blocklist: ["forbidden.example"],
      }),
    });

    expect(reason).toBeNull();
  });

  it("blocks non-allowlisted domains in allowlist mode", () => {
    const reason = evaluateUrlAccess({
      toolName: "web_fetch",
      toolParams: { url: "https://outside.example/path" },
      config: normalizeConfig({
        mode: "allowlist",
        allowlist: ["docs.example"],
      }),
    });

    expect(reason).toContain("blocked URL access to outside.example");
    expect(reason).toContain("not in allowlist");
  });

  it("extracts URLs from curl-like command params", () => {
    const reason = evaluateUrlAccess({
      toolName: "curl",
      toolParams: { command: "curl https://forbidden.example/data" },
      config: normalizeConfig({
        mode: "blocklist",
        blocklist: ["forbidden.example"],
      }),
    });

    expect(reason).toContain("blocked URL access to forbidden.example");
  });
});
