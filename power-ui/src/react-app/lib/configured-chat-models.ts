import type { WorkbenchSnapshot } from "../../adapters/mock-workbench-adapter";
import type { ModelCatalogEntry } from "../../compat/types";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";

import { formatCatalogModelRef } from "./model-catalog";
import {
  listConfiguredModelRefs,
  readGlobalModelConfigs,
  resolvePrimaryModelFromConfig,
  type WorkbenchModelConfig,
} from "./global-model-config";

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

/** Align with Lit workbench `getComposerModelCatalog`: settings providers first, then gateway catalog. */
export function buildComposerModelCatalog(
  catalog: ModelCatalogEntry[],
  providerRefs: string[],
  modelConfigs?: WorkbenchModelConfig[],
): ModelCatalogEntry[] {
  if (providerRefs.length === 0) {
    return catalog;
  }
  const catalogByRef = new Map(
    catalog.map((entry) => [formatCatalogModelRef(entry), entry] as const),
  );
  const configs = modelConfigs ?? [];
  return providerRefs.map((ref) => {
    const fromCatalog = catalogByRef.get(ref);
    if (fromCatalog) {
      return fromCatalog;
    }
    const slashIndex = ref.indexOf("/");
    const provider = slashIndex >= 0 ? ref.slice(0, slashIndex) : "";
    const modelId = slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref;
    const row = configs.find(
      (c) =>
        c.enabled &&
        formatCatalogModelRef({ provider: c.provider, id: c.model }) === ref,
    );
    const displayName = row?.name?.trim() || modelId;
    return {
      id: modelId,
      name: displayName,
      provider,
    };
  });
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

/** 从 sessions.list 行解析 `provider/model` ref。 */
export function resolveSessionModelRef(
  snapshot: WorkbenchSnapshot | null,
  sessionKey: string,
): string | null {
  const sk = sessionKey.trim();
  if (!sk || !snapshot?.sessionsResult?.sessions) {
    return null;
  }
  const row = snapshot.sessionsResult.sessions.find((s) => s.key === sk);
  const sm = row?.model?.trim();
  if (!sm) {
    return null;
  }
  const rowProv = row.modelProvider?.trim();
  if (sm.includes("/")) {
    return sm;
  }
  return rowProv ? `${rowProv}/${sm}` : sm;
}

function pickRefFromPool(ref: string, pool: ModelCatalogEntry[]): string {
  const trimmed = ref.trim();
  if (!trimmed || pool.length === 0) {
    return "";
  }
  const hit = pool.find((m) => catalogEntryMatchesRef(m, trimmed));
  if (!hit) {
    return "";
  }
  return formatCatalogModelRef(hit) || trimmed;
}

/**
 * 对话顶栏 / 发送侧使用的 model ref，与网关运行时一致。
 *
 * 有 sessionKey 时（已选会话）：
 * 1. sessions.list 上的会话绑定（sessions.patch model → modelOverride，**真正生效**）
 * 2. agents.defaults.model.primary（设置页「默认主模型」，新会话默认）
 * 3. chatPreferredModelRef（仅作无会话绑定时的本地偏好）
 *
 * 无 sessionKey 时（尚未发首条消息）：
 * 1. chatPreferredModelRef
 * 2. agents.defaults.model.primary
 * 3. 可选列表首项
 *
 * 说明：`models.providers` 只定义可用提供商与密钥；不直接决定某条消息用哪个模型。
 */
export function resolveEffectiveChatModelRef(params: {
  snapshot: WorkbenchSnapshot | null;
  sessionKey: string;
  chatPreferredModelRef?: string;
  configuredModels: ModelCatalogEntry[];
}): string {
  const pool = params.configuredModels;
  const sk = params.sessionKey.trim();

  const fromSession = pickRefFromPool(resolveSessionModelRef(params.snapshot, sk) ?? "", pool);
  const fromPrimary = pickRefFromPool(
    resolvePrimaryModelFromConfig(params.snapshot?.openclawConfig ?? null),
    pool,
  );
  const fromPref = pickRefFromPool(params.chatPreferredModelRef ?? "", pool);

  if (sk) {
    if (fromSession) {
      return fromSession;
    }
    if (fromPrimary) {
      return fromPrimary;
    }
    if (fromPref) {
      return fromPref;
    }
  } else {
    if (fromPref) {
      return fromPref;
    }
    if (fromPrimary) {
      return fromPrimary;
    }
  }

  return pool[0] ? formatCatalogModelRef(pool[0]) : "";
}

export function modelOptionLabel(
  ref: string,
  modelConfigs: WorkbenchModelConfig[],
  pool: ModelCatalogEntry[],
): string {
  const entry = pool.find((m) => catalogEntryMatchesRef(m, ref));
  const name = entry?.name?.trim() || ref;
  return `${name} (${ref})`;
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

  const modelConfigs = readGlobalModelConfigs(snapshot?.openclawConfig ?? null);
  const providerRefs = listConfiguredModelRefs(modelConfigs);
  // 设置里配置了 models.providers 时，只展示这些模型，不回退到网关全量目录（避免 Nova 等与配置无关的项）。
  if (providerRefs.length > 0) {
    return buildComposerModelCatalog(catalog, providerRefs, modelConfigs);
  }

  const agentId = resolveEffectiveAgentId(snapshot, selectedProjectId, selectedSessionKey);
  const refStrings = collectConfiguredModelRefStrings(snapshot, agentId, selectedSessionKey);
  if (refStrings.length === 0) {
    return catalog;
  }
  const configured = orderedConfiguredCatalogEntries(catalog, refStrings);
  return configured.length > 0 ? configured : catalog;
}
