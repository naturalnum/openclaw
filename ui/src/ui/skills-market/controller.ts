import type { GatewayBrowserClient } from "../gateway.ts";
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
} from "../types.ts";

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
  const res = await state.client.request<SkillsRegistryListResult>(
    "skills.registry.list",
    buildRegistryListParams(state),
  );
  state.skillsCatalog = res.items;
  state.skillsCategories = res.categories;
  state.skillsRegistryBaseUrl = res.baseUrl || null;
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
        state.skillsRegistryBaseUrl = null;
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

export function setSkillsFilter(state: SkillsMarketState, value: string) {
  state.skillsFilter = value;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  void loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsCategory(state: SkillsMarketState, category: string | null) {
  state.skillsCategory = category?.trim() ? category.trim() : null;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  void loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsSortBy(state: SkillsMarketState, sortBy: SkillsRegistrySortBy) {
  state.skillsSortBy = sortBy;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  void loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsInstallFilter(
  state: SkillsMarketState,
  installFilter: SkillsRegistryInstallFilter,
) {
  state.skillsInstallFilter = installFilter;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  void loadSkillsMarket(state, { refreshStatus: false });
}

export function setSkillsPage(state: SkillsMarketState, page: number) {
  state.skillsPagination = {
    ...state.skillsPagination,
    page: Math.max(1, Math.floor(page)),
  };
  void loadSkillsMarket(state, { refreshStatus: false });
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
      if (!item.installState.canUninstall) {
        throw new Error(
          "This skill was not installed from the registry and cannot be removed here.",
        );
      }
      const result = await state.client.request<SkillsRegistryUninstallResult>(
        "skills.registry.uninstall",
        {
          slug: item.slug,
        },
      );
      message = result.message || "Uninstalled";
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
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillsNotice(state);
  } finally {
    state.skillsArchiveBusy = false;
  }
}
