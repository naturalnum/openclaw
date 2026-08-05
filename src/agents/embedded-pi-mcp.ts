import { normalizeConfiguredMcpServers } from "../config/mcp-config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { BundleMcpDiagnostic, BundleMcpServerConfig } from "../plugins/bundle-mcp.js";
import { loadEnabledBundleMcpConfig } from "../plugins/bundle-mcp.js";

export type EmbeddedPiMcpConfig = {
  mcpServers: Record<string, BundleMcpServerConfig>;
  diagnostics: BundleMcpDiagnostic[];
};

function isEnabledMcpServer(server: BundleMcpServerConfig): boolean {
  const flags = server as BundleMcpServerConfig & {
    enabled?: unknown;
    disabled?: unknown;
  };
  return flags.enabled !== false && flags.disabled !== true;
}

export function loadEmbeddedPiMcpConfig(params: {
  workspaceDir: string;
  cfg?: OpenClawConfig;
}): EmbeddedPiMcpConfig {
  const bundleMcp = loadEnabledBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  const mergedMcp = {
    ...bundleMcp.config.mcpServers,
    ...configuredMcp,
  };

  return {
    // OpenClaw config is the owner-managed layer, so it overrides bundle defaults.
    // Keep disabled entries in persisted config, but omit them from the runtime
    // snapshot so a disabled override can neither connect nor create MCP tools.
    mcpServers: Object.fromEntries(
      Object.entries(mergedMcp).filter(([, server]) => isEnabledMcpServer(server)),
    ),
    diagnostics: bundleMcp.diagnostics,
  };
}

export function hasEnabledEmbeddedPiMcpServers(params: {
  workspaceDir: string;
  cfg?: OpenClawConfig;
}): boolean {
  return Object.keys(loadEmbeddedPiMcpConfig(params).mcpServers).length > 0;
}
