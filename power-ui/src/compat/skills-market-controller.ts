import type { GatewayBrowserClient } from "./gateway.ts";
import type {
  SkillStatusReport,
  SkillsRegistryCatalogItem,
  SkillsRegistryCategory,
  SkillsRegistryInstallArchiveResult,
  SkillsRegistryInstallFilter,
  SkillsRegistryInstallResult,
  SkillsRegistryListResult,
  SkillsRegistryPagination,
  SkillsRegistrySortBy,
  SkillsRegistryUninstallResult,
} from "./types.ts";

export const DEFAULT_SKILLS_REGISTRY_PAGINATION: SkillsRegistryPagination = {
  page: 1,
  limit: 12,
  total: 0,
  totalPages: 1,
};

export const DEFAULT_SKILLS_SORT_BY: SkillsRegistrySortBy = "comprehensive";
export const DEFAULT_SKILLS_INSTALL_FILTER: SkillsRegistryInstallFilter = "all";

export type SkillMessage = {
  kind: "success" | "error";
  message: string;
};

export type SkillMessageMap = Record<string, SkillMessage>;

export type SkillsMarketState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillsBusyKey: string | null;
  skillsArchiveBusy: boolean;
  skillMessages: SkillMessageMap;
  skillsNotice: SkillMessage | null;
  skillsFilter: string;
  skillsCatalog: SkillsRegistryCatalogItem[];
  skillsCategories: SkillsRegistryCategory[];
  skillsRegistryBaseUrl: string | null;
  skillsPagination: SkillsRegistryPagination;
  skillsCategory: string | null;
  skillsSortBy: SkillsRegistrySortBy;
  skillsInstallFilter: SkillsRegistryInstallFilter;
};

type LoadSkillsOptions = {
  clearMessages?: boolean;
  refreshStatus?: boolean;
};

const pendingReloads = new WeakMap<SkillsMarketState, Required<LoadSkillsOptions>>();

function setSkillMessage(state: SkillsMarketState, key: string, message?: SkillMessage) {
  const normalized = key.trim();
  if (!normalized) {
    return;
  }
  const next = { ...state.skillMessages };
  if (message) {
    next[normalized] = message;
  } else {
    delete next[normalized];
  }
  state.skillMessages = next;
}

function setSkillsNotice(state: SkillsMarketState, notice?: SkillMessage) {
  state.skillsNotice = notice ?? null;
}

function queueReload(state: SkillsMarketState, options?: LoadSkillsOptions) {
  const previous = pendingReloads.get(state);
  pendingReloads.set(state, {
    clearMessages: previous?.clearMessages === true || options?.clearMessages === true,
    refreshStatus: previous?.refreshStatus === true || options?.refreshStatus === true,
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isLocalSkillEnabled(item: SkillsRegistryCatalogItem): boolean {
  const tags = new Set(item.tags.map((tag) => tag.trim().toLowerCase()));
  if (tags.has("disabled")) {
    return false;
  }
  if (tags.has("enabled")) {
    return true;
  }
  return true;
}

function buildRegistryListParams(state: SkillsMarketState) {
  return {
    q: state.skillsFilter.trim() || undefined,
    category: state.skillsCategory ?? undefined,
    sort: state.skillsSortBy,
    page: state.skillsPagination.page,
    limit: state.skillsPagination.limit,
    installFilter: state.skillsInstallFilter,
  };
}

function includesFilterText(item: SkillsRegistryCatalogItem, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [item.displayName, item.summary, item.slug, item.author ?? "", ...item.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function buildLocalCatalogFromStatus(state: SkillsMarketState): SkillsRegistryListResult {
  const report = state.skillsReport;
  const allItems: SkillsRegistryCatalogItem[] = (report?.skills ?? []).map((skill) => ({
    slug: skill.skillKey,
    displayName: skill.name,
    summary: skill.description,
    category: "local",
    tags: [
      "local",
      skill.eligible ? "ready" : "needs-setup",
      skill.disabled ? "disabled" : "enabled",
    ],
    version: null,
    downloads: 0,
    installs: 0,
    stars: 0,
    updatedAt: null,
    author: skill.source ?? "local",
    installState: {
      installed: true,
      installedVersion: null,
      latestVersion: null,
      managed: true,
      canUninstall: false,
      source: "directory",
    },
  }));

  let filtered = allItems.filter((item) => includesFilterText(item, state.skillsFilter));
  if (state.skillsInstallFilter === "not_installed") {
    filtered = [];
  }
  if (state.skillsCategory) {
    filtered = filtered.filter((item) => item.category === state.skillsCategory);
  }
  if (state.skillsSortBy === "updated") {
    filtered = filtered.toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } else if (state.skillsSortBy === "downloads") {
    filtered = filtered.toSorted((a, b) => b.downloads - a.downloads);
  } else {
    filtered = filtered.toSorted((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const page = Math.max(1, state.skillsPagination.page);
  const limit = Math.max(1, state.skillsPagination.limit);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const items = filtered.slice(start, start + limit);

  return {
    baseUrl: "",
    categories: [
      {
        id: "local",
        name: "本地技能",
        icon: "📦",
      },
    ],
    items,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  };
}

function mergeCatalogResults(
  state: SkillsMarketState,
  remote: SkillsRegistryListResult | null,
  local: SkillsRegistryListResult,
): SkillsRegistryListResult {
  const page = Math.max(1, state.skillsPagination.page);
  const limit = Math.max(1, state.skillsPagination.limit);

  const mergedBySlug = new Map<string, SkillsRegistryCatalogItem>();
  for (const item of remote?.items ?? []) {
    mergedBySlug.set(item.slug, item);
  }
  for (const item of local.items) {
    if (!mergedBySlug.has(item.slug)) {
      mergedBySlug.set(item.slug, item);
    }
  }

  const mergedItems = [...mergedBySlug.values()];
  const total = mergedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  const mergedCategories = [
    ...(remote?.categories ?? []),
    ...local.categories.filter(
      (category) => !(remote?.categories ?? []).some((entry) => entry.id === category.id),
    ),
  ];

  return {
    baseUrl: remote?.baseUrl ?? "",
    categories: mergedCategories,
    items: mergedItems.slice(start, start + limit),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  };
}

async function loadSkillsStatus(state: SkillsMarketState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const res = await state.client.request<SkillStatusReport | undefined>("skills.status", {});
  if (res) {
    state.skillsReport = res;
  }
}

async function loadSkillsCatalog(state: SkillsMarketState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const params = buildRegistryListParams(state);
  let remoteRes: SkillsRegistryListResult | null = null;
  try {
    remoteRes = await state.client.request<SkillsRegistryListResult>(
      "skills.registry.list",
      params,
    );
  } catch (err) {
    const message = getErrorMessage(err);
    if (!/unknown method|not configured|unavailable/i.test(message)) {
      throw err;
    }
    // Backward compatibility for older stacks that exposed a power-prefixed endpoint.
    try {
      remoteRes = await state.client.request<SkillsRegistryListResult>(
        "power.skills.catalog.list",
        params,
      );
    } catch {
      remoteRes = null;
    }
  }
  const localRes = buildLocalCatalogFromStatus(state);
  const res = mergeCatalogResults(state, remoteRes, localRes);
  state.skillsCatalog = res.items;
  state.skillsCategories = res.categories;
  state.skillsRegistryBaseUrl = res.baseUrl || state.skillsRegistryBaseUrl;
  state.skillsPagination = res.pagination;
}

export async function loadSkillsMarket(state: SkillsMarketState, options?: LoadSkillsOptions) {
  if (options?.clearMessages && Object.keys(state.skillMessages).length > 0) {
    state.skillMessages = {};
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillsLoading) {
    queueReload(state, options);
    return;
  }
  state.skillsLoading = true;
  state.skillsError = null;
  try {
    const results = await Promise.allSettled([
      options?.refreshStatus === false ? Promise.resolve(undefined) : loadSkillsStatus(state),
      loadSkillsCatalog(state),
    ]);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getErrorMessage(result.reason))
      .filter(Boolean);
    if (errors.length > 0) {
      state.skillsError = errors.join(" ");
      if (results[1]?.status === "rejected") {
        state.skillsCatalog = [];
        state.skillsCategories = [];
        state.skillsPagination = { ...DEFAULT_SKILLS_REGISTRY_PAGINATION };
      }
    }
  } finally {
    state.skillsLoading = false;
    const next = pendingReloads.get(state);
    if (next) {
      pendingReloads.delete(state);
      void loadSkillsMarket(state, next);
    }
  }
}

export function setSkillsFilter(state: SkillsMarketState, value: string): Promise<void> {
  state.skillsFilter = value;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsCategory(
  state: SkillsMarketState,
  category: string | null,
): Promise<void> {
  state.skillsCategory = category?.trim() ? category.trim() : null;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsSortBy(
  state: SkillsMarketState,
  sortBy: SkillsRegistrySortBy,
): Promise<void> {
  state.skillsSortBy = sortBy;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsInstallFilter(
  state: SkillsMarketState,
  installFilter: SkillsRegistryInstallFilter,
): Promise<void> {
  state.skillsInstallFilter = installFilter;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsPage(state: SkillsMarketState, page: number): Promise<void> {
  state.skillsPagination = {
    ...state.skillsPagination,
    page: Math.max(1, Math.floor(page)),
  };
  return loadSkillsMarket(state, { refreshStatus: false });
}

export async function toggleRegistrySkillInstall(
  state: SkillsMarketState,
  item: SkillsRegistryCatalogItem,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillsBusyKey || state.skillsArchiveBusy) {
    return;
  }
  const skillKey = item.slug;
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  setSkillsNotice(state);
  try {
    let message = "";
    if (item.installState.installed) {
      if (item.installState.source === "directory") {
        const currentlyEnabled = isLocalSkillEnabled(item);
        const nextEnabled = !currentlyEnabled;
        await state.client.request("skills.update", {
          skillKey: item.slug,
          enabled: nextEnabled,
        });
        message = nextEnabled ? "已启用" : "已禁用";
      } else if (!item.installState.canUninstall) {
        throw new Error(
          "This skill was not installed from the registry and cannot be removed here.",
        );
      } else {
        const result = await state.client.request<SkillsRegistryUninstallResult>(
          "skills.registry.uninstall",
          {
            slug: item.slug,
          },
        );
        message = result.message || "Uninstalled";
      }
    } else {
      const result = await state.client.request<SkillsRegistryInstallResult>(
        "skills.registry.install",
        {
          slug: item.slug,
          version: item.version ?? undefined,
        },
      );
      message = result.message || "Installed";
    }
    await loadSkillsMarket(state, { refreshStatus: true });
    setSkillMessage(state, skillKey, {
      kind: "success",
      message,
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function importRegistrySkillArchive(state: SkillsMarketState, file: File) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillsBusyKey || state.skillsArchiveBusy) {
    return;
  }
  const normalizedName = file.name.trim();
  if (!normalizedName.toLowerCase().endsWith(".zip")) {
    const message = "只支持导入 .zip 技能包。";
    state.skillsError = message;
    setSkillsNotice(state);
    return;
  }
  state.skillsArchiveBusy = true;
  state.skillsError = null;
  setSkillsNotice(state);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await state.client.request<SkillsRegistryInstallArchiveResult>(
      "skills.registry.installArchive",
      {
        fileName: normalizedName,
        archiveBase64: encodeUint8ArrayToBase64(bytes),
      },
    );
    await loadSkillsMarket(state, { refreshStatus: true });
    setSkillMessage(state, result.slug, {
      kind: "success",
      message: result.message || "已导入安装",
    });
    setSkillsNotice(state, {
      kind: "success",
      message: `已导入并安装技能包：${result.slug}`,
    });
  } catch (err) {
    state.skillsError = getErrorMessage(err);
    setSkillsNotice(state);
  } finally {
    state.skillsArchiveBusy = false;
  }
}
