import type { ConnectorProviderRuntime } from "../types.js";
import { emailConnectorProvider } from "./email.js";
import { postgresConnectorProvider } from "./postgres.js";

const CONNECTOR_PROVIDERS: ConnectorProviderRuntime[] = [
  postgresConnectorProvider,
  emailConnectorProvider,
];

export function listConnectorProviders(): ConnectorProviderRuntime[] {
  return CONNECTOR_PROVIDERS.map((provider) => provider);
}

export function getConnectorProvider(providerId: string): ConnectorProviderRuntime | null {
  return CONNECTOR_PROVIDERS.find((provider) => provider.definition.id === providerId) ?? null;
}
