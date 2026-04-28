import type { ConnectorProviderRuntime } from "../types.js";
import { emailConnectorProvider } from "./email.js";
import { postgresConnectorProvider } from "./postgres.js";

const CONNECTOR_PROVIDERS_ALL: ConnectorProviderRuntime[] = [
  postgresConnectorProvider,
  emailConnectorProvider,
];

const DEFAULT_ENABLED_CONNECTOR_CATEGORIES = new Set<string>(["database"]);

function resolveEnabledConnectorCategories(env: NodeJS.ProcessEnv): Set<string> {
  const enabled = new Set<string>(DEFAULT_ENABLED_CONNECTOR_CATEGORIES);
  const fromEnv = env.OPENCLAW_CONNECTOR_CATEGORIES?.trim() ?? "";
  if (fromEnv) {
    for (const token of fromEnv.split(",")) {
      const normalized = token.trim().toLowerCase();
      if (normalized) {
        enabled.add(normalized);
      }
    }
  }
  // Backward-compatible one-off switch while migrating to category allowlists.
  if (env.OPENCLAW_ENABLE_EMAIL_CONNECTOR?.trim() === "1") {
    enabled.add("email");
  }
  return enabled;
}

export function listConnectorProviders(): ConnectorProviderRuntime[] {
  const enabledCategories = resolveEnabledConnectorCategories(process.env);
  return CONNECTOR_PROVIDERS_ALL.filter((provider) =>
    enabledCategories.has(provider.definition.category),
  ).map((provider) => provider);
}

export function getConnectorProvider(providerId: string): ConnectorProviderRuntime | null {
  return CONNECTOR_PROVIDERS_ALL.find((provider) => provider.definition.id === providerId) ?? null;
}
