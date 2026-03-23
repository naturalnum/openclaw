import { listAgentIds } from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "../memory/backend-config.js";
import { getMemorySearchManager } from "../memory/index.js";

export async function startGatewayMemoryBackend(params: {
  cfg: OpenClawConfig;
  log: { info?: (msg: string) => void; warn: (msg: string) => void };
}): Promise<void> {
  const agentIds = listAgentIds(params.cfg);
  for (const agentId of agentIds) {
    if (!resolveMemorySearchConfig(params.cfg, agentId)) {
      continue;
    }
    const resolved = resolveMemoryBackendConfig({ cfg: params.cfg, agentId });
    if (resolved.backend !== "qmd" || !resolved.qmd) {
      continue;
    }

    const t0 = Date.now();
    const { manager, error } = await getMemorySearchManager({ cfg: params.cfg, agentId });
    const elapsed = Date.now() - t0;
    if (!manager) {
      params.log.warn(
        `qmd memory startup initialization failed for agent "${agentId}": ${error ?? "unknown error"}`,
      );
      continue;
    }
    if (elapsed > 2_000) {
      params.log.warn(`qmd initialization slow for agent "${agentId}": ${elapsed}ms`);
    }
    params.log.info?.(`qmd memory startup initialization armed for agent "${agentId}"`);
  }
}
