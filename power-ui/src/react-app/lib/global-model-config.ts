/**
 * Mirrors `power-ui/src/app.ts` global model helpers so React settings can
 * persist `models.providers` via `config.set` without importing the Lit shell.
 */
import { cloneConfigObject, serializeConfigForm } from "../../compat/controllers";
import type { WorkbenchModelConfig } from "../../views/workbench";

export type { WorkbenchModelConfig };

const DEFAULT_PROVIDER_PREFIX = "provider";
const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

function createLocalId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `power-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyModelConfig(): WorkbenchModelConfig {
  return {
    id: createLocalId(),
    provider: "",
    enabled: true,
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  };
}

export function formatModelRef(provider: string, model: string): string {
  const normalizedProvider = provider.trim();
  const normalizedModel = model.trim();
  return normalizedProvider && normalizedModel ? `${normalizedProvider}/${normalizedModel}` : normalizedModel;
}

function readConfigObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRedactedSentinelValue(value: string): boolean {
  return value.trim() === REDACTED_SENTINEL;
}

function sanitizeProviderId(raw: string, fallbackSeed: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) {
    return normalized;
  }
  const fallback = fallbackSeed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fallback || `${DEFAULT_PROVIDER_PREFIX}-${createLocalId().slice(0, 8)}`;
}

/** 侧栏「新建项目」用的子目录名（仅字母数字与连字符）。 */
export function slugifyProjectFolderName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** 在默认 agent workspace 下为新建项目解析目录路径（由网关 resolveUserPath）。 */
export function resolveProjectWorkspacePath(
  config: Record<string, unknown> | null | undefined,
  projectName: string,
): string {
  const base =
    readDefaultAgentWorkspace(config)?.replace(/\/+$/, "") ?? "~/.openclaw/workspace";
  return `${base}/${slugifyProjectFolderName(projectName)}`;
}

export function readDefaultAgentWorkspace(
  config: Record<string, unknown> | null | undefined,
): string | null {
  const workspace = (
    config as {
      agents?: {
        defaults?: {
          workspace?: unknown;
        };
      };
    } | null
  )?.agents?.defaults?.workspace;
  return typeof workspace === "string" && workspace.trim() ? workspace.trim() : null;
}

export function resolvePrimaryModelFromConfig(config: Record<string, unknown> | null | undefined): string {
  const modelConfig = (config as { agents?: { defaults?: { model?: unknown } } } | null)?.agents?.defaults?.model;
  if (typeof modelConfig === "string") {
    return modelConfig.trim();
  }
  if (
    modelConfig &&
    typeof modelConfig === "object" &&
    typeof (modelConfig as { primary?: unknown }).primary === "string"
  ) {
    return ((modelConfig as { primary?: string }).primary ?? "").trim();
  }
  return "";
}

export function readGlobalModelConfigs(config: Record<string, unknown> | null | undefined): WorkbenchModelConfig[] {
  const providers = (
    config as {
      models?: {
        providers?: Record<
          string,
          {
            baseUrl?: unknown;
            apiKey?: unknown;
            models?: Array<{ id?: unknown; name?: unknown }>;
          }
        >;
      };
    }
  )?.models?.providers;
  if (!providers || typeof providers !== "object") {
    return [createEmptyModelConfig()];
  }

  const entries: WorkbenchModelConfig[] = [];

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const baseUrl = typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : "";
    const apiKey = typeof providerConfig?.apiKey === "string" ? providerConfig.apiKey : "";
    const models =
      Array.isArray(providerConfig?.models) && providerConfig.models.length > 0
        ? providerConfig.models
        : [{ id: "", name: "" }];

    for (const [index, modelConfig] of models.entries()) {
      const modelId = typeof modelConfig?.id === "string" ? modelConfig.id.trim() : "";
      entries.push({
        id: `${providerId}::${modelId || "model"}::${index}`,
        provider: providerId,
        enabled: true,
        name:
          typeof modelConfig?.name === "string" && modelConfig.name.trim()
            ? modelConfig.name.trim()
            : providerId,
        baseUrl,
        apiKey,
        model: modelId,
      });
    }
  }

  return entries.length > 0 ? entries : [createEmptyModelConfig()];
}

export function listConfiguredModelRefs(modelConfigs: WorkbenchModelConfig[]): string[] {
  const refs: string[] = [];
  for (const row of modelConfigs) {
    if (!row.enabled) {
      continue;
    }
    const modelId = row.model.trim();
    const providerId = sanitizeProviderId(row.provider, row.name || modelId || DEFAULT_PROVIDER_PREFIX);
    if (modelId) {
      refs.push(formatModelRef(providerId, modelId));
    }
  }
  return refs;
}

export function buildNextGlobalModelConfig(params: {
  config: Record<string, unknown> | null | undefined;
  modelConfigs: WorkbenchModelConfig[];
  currentModelId: string;
}): Record<string, unknown> {
  const next = cloneConfigObject(params.config ?? {});
  const existingModels =
    typeof next.models === "object" && next.models !== null ? (next.models as Record<string, unknown>) : {};
  const existingAgents =
    typeof next.agents === "object" && next.agents !== null ? (next.agents as Record<string, unknown>) : {};
  const existingDefaults =
    typeof existingAgents.defaults === "object" && existingAgents.defaults !== null
      ? (existingAgents.defaults as Record<string, unknown>)
      : {};
  const existingProviders =
    typeof existingModels.providers === "object" && existingModels.providers !== null
      ? (existingModels.providers as Record<string, Record<string, unknown>>)
      : {};
  const nextProviders: Record<string, Record<string, unknown>> = {};

  for (const [index, modelConfig] of params.modelConfigs.entries()) {
    if (!modelConfig.enabled) {
      continue;
    }
    const modelId = modelConfig.model.trim();
    const providerId = sanitizeProviderId(
      modelConfig.provider,
      modelConfig.name || modelId || `${DEFAULT_PROVIDER_PREFIX}-${index + 1}`,
    );
    const existingProvider =
      existingProviders[providerId] &&
      typeof existingProviders[providerId] === "object" &&
      existingProviders[providerId] !== null
        ? existingProviders[providerId]
        : {};
    const providerEntry =
      nextProviders[providerId] ??
      ({
        ...existingProvider,
        baseUrl: "",
        apiKey: "",
        api:
          typeof existingProvider.api === "string" && existingProvider.api.trim()
            ? existingProvider.api
            : "openai-completions",
        models: [],
      } as Record<string, unknown> & { models: Array<{ id: string; name: string }> });

    providerEntry.baseUrl = modelConfig.baseUrl.trim();
    providerEntry.apiKey = isRedactedSentinelValue(modelConfig.apiKey)
      ? typeof existingProvider.apiKey === "string"
        ? existingProvider.apiKey
        : ""
      : modelConfig.apiKey;
    if (modelId) {
      providerEntry.models.push({
        id: modelId,
        name: modelConfig.name.trim() || modelId,
      });
    }
    nextProviders[providerId] = providerEntry;
  }

  const configuredRefs = Object.entries(nextProviders).flatMap(([providerId, providerConfig]) =>
    Array.isArray(providerConfig.models)
      ? providerConfig.models
          .filter((model): model is { id: string; name: string } =>
            Boolean(model && typeof model.id === "string" && model.id.trim()),
          )
          .map((model) => formatModelRef(providerId, model.id))
      : [],
  );
  const normalizedCurrentModelId = params.currentModelId.trim();
  const nextPrimaryModel =
    configuredRefs.find((ref) => ref === normalizedCurrentModelId) ?? configuredRefs[0] ?? "";

  next.models = {
    ...existingModels,
    mode: "merge",
    providers: nextProviders,
  };
  next.agents = {
    ...existingAgents,
    defaults: {
      ...existingDefaults,
      model:
        nextPrimaryModel &&
        typeof existingDefaults.model === "object" &&
        existingDefaults.model !== null
          ? {
              ...(existingDefaults.model as Record<string, unknown>),
              primary: nextPrimaryModel,
            }
          : nextPrimaryModel
            ? { primary: nextPrimaryModel }
            : existingDefaults.model,
    },
  };
  return next;
}

export async function persistGlobalModelConfig(params: {
  adapter: { request: <T>(method: string, body?: unknown) => Promise<T> };
  modelConfigs: WorkbenchModelConfig[];
  currentModelId: string;
}): Promise<void> {
  const snapshot = await params.adapter.request<{ hash?: string | null; config?: Record<string, unknown> | null }>(
    "config.get",
    {},
  );
  const baseHash = snapshot.hash?.trim();
  if (!baseHash) {
    throw new Error("无法保存：配置缺少 baseHash，请刷新后重试。");
  }
  const nextConfig = buildNextGlobalModelConfig({
    config: snapshot.config ?? {},
    modelConfigs: params.modelConfigs,
    currentModelId: params.currentModelId,
  });
  await params.adapter.request("config.set", {
    raw: serializeConfigForm(nextConfig),
    baseHash,
  });
}
