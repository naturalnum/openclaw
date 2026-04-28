import { afterEach, describe, expect, it, vi } from "vitest";
import { getConnectorProvider, listConnectorProviders } from "./index.js";

describe("connector providers catalog visibility", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hides email provider from catalog list", () => {
    const providerIds = listConnectorProviders().map((provider) => provider.definition.id);
    expect(providerIds).toContain("postgres");
    expect(providerIds).not.toContain("email");
  });

  it("shows email provider when enabled via category allowlist", () => {
    vi.stubEnv("OPENCLAW_CONNECTOR_CATEGORIES", "database,email");
    const providerIds = listConnectorProviders().map((provider) => provider.definition.id);
    expect(providerIds).toContain("postgres");
    expect(providerIds).toContain("email");
  });

  it("keeps legacy email flag behavior", () => {
    vi.stubEnv("OPENCLAW_ENABLE_EMAIL_CONNECTOR", "1");
    const providerIds = listConnectorProviders().map((provider) => provider.definition.id);
    expect(providerIds).toContain("email");
  });

  it("keeps email provider available for runtime lookups", () => {
    const provider = getConnectorProvider("email");
    expect(provider?.definition.id).toBe("email");
  });
});
