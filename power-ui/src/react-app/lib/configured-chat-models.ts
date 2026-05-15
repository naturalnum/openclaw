import type { WorkbenchSnapshot } from "../../adapters/mock-workbench-adapter";
import type { ModelCatalogEntry } from "../../compat/types";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";

import { formatCatalogModelRef } from "./model-catalog";

/** 判断目录项是否匹配网关/配置里的 model ref（含 `provider/id` 或裸 `id`）。 */
export function catalogEntryMatchesRef(entry: ModelCatalogEntry, ref: string): boolean {
  const r = ref.trim();
  if (!r) {
    return false;
  }
  const formatted = formatCatalogModelRef(entry);
  if (formatted === r) {
    return true;
  }
  if (entry.id.trim() === r) {
    return true;
  }
  const lower = r.toLowerCase();
  const p = entry.provider.trim().toLowerCase();
  const id = entry.id.trim().toLowerCase();
  return lower === `${p}/${id}`;
}

export function resolveEffectiveAgentId(
  snapshot: WorkbenchSnapshot | null,
  selectedProjectId: string | null,
  selectedSessionKey: string,
): string | null {
  const sk = selectedSessionKey.trim();
  if (sk) {
    const parsed = parseAgentSessionKey(sk);
    if (parsed?.agentId) {
      return parsed.agentId;
    }
  }
  const pid = selectedProjectId?.trim();
  if (pid) {
    return pid;
  }
  return snapshot?.agentsList?.defaultId ?? snapshot?.agentsList?.agents?.[0]?.id ?? null;
}

/**
 * 从助手配置（primary + fallbacks）、会话列表默认值、当前会话绑定的 model
 * 收集「当前应可选」的 model ref 字符串，顺序去重。
 */
export function collectConfiguredModelRefStrings(
  snapshot: WorkbenchSnapshot | null,
  agentId: string | null,
  sessionKey: string,
): string[] {
  if (!snapshot) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = raw?.trim();
    if (!t || seen.has(t)) {
      return;
    }
    seen.add(t);
    out.push(t);
  };

  const agent = agentId ? snapshot.agentsList?.agents?.find((a) => a.id === agentId) : undefined;
  const modelBlock = agent?.model;
  if (modelBlock?.primary) {
    push(modelBlock.primary);
  }
  if (Array.isArray(modelBlock?.fallbacks)) {
    for (const f of modelBlock.fallbacks) {
      push(typeof f === "string" ? f : "");
    }
  }

  const def = snapshot.sessionsResult?.defaults;
  if (def?.model?.trim()) {
    const rawModel = def.model.trim();
    const prov = def.modelProvider?.trim();
    if (rawModel.includes("/")) {
      push(rawModel);
    } else if (prov) {
      push(`${prov}/${rawModel}`);
    } else {
      push(rawModel);
    }
  }

  const sk = sessionKey.trim();
  if (sk) {
    const row = snapshot.sessionsResult?.sessions?.find((s) => s.key === sk);
    const sm = row?.model?.trim();
    if (sm) {
      const rowProv = row.modelProvider?.trim();
      if (sm.includes("/")) {
        push(sm);
      } else if (rowProv) {
        push(`${rowProv}/${sm}`);
      } else {
        push(sm);
      }
    }
  }

  return out;
}

/** 按配置 ref 顺序，从全量目录中筛出可切换项（仅保留目录里存在的）。 */
export function orderedConfiguredCatalogEntries(
  catalog: ModelCatalogEntry[],
  refStrings: string[],
): ModelCatalogEntry[] {
  const used = new Set<string>();
  const out: ModelCatalogEntry[] = [];
  for (const ref of refStrings) {
    const hit = catalog.find((e) => catalogEntryMatchesRef(e, ref));
    if (!hit) {
      continue;
    }
    const key = formatCatalogModelRef(hit);
    if (!key || used.has(key)) {
      continue;
    }
    used.add(key);
    out.push(hit);
  }
  return out;
}

export function modelPickerSubtitle(entry: ModelCatalogEntry): string {
  if (entry.reasoning) {
    return "支持推理与更复杂任务";
  }
  const cw = entry.contextWindow;
  if (typeof cw === "number" && cw >= 100_000) {
    return "长上下文，适合大文档与多轮对话";
  }
  return "适合日常对话与快捷回复";
}

export function resolveChatModelPool(
  snapshot: WorkbenchSnapshot | null,
  selectedProjectId: string | null,
  selectedSessionKey: string,
): ModelCatalogEntry[] {
  const catalog = [...(snapshot?.modelCatalog ?? [])].sort((a, b) => {
    const ca = formatCatalogModelRef(a);
    const cb = formatCatalogModelRef(b);
    if (ca !== cb) {
      return ca.localeCompare(cb);
    }
    return a.id.localeCompare(b.id);
  });
  const agentId = resolveEffectiveAgentId(snapshot, selectedProjectId, selectedSessionKey);
  const refStrings = collectConfiguredModelRefStrings(snapshot, agentId, selectedSessionKey);
  if (refStrings.length === 0) {
    return catalog;
  }
  const configured = orderedConfiguredCatalogEntries(catalog, refStrings);
  return configured.length > 0 ? configured : catalog;
}
