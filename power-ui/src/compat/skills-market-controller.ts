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

export type SkillsMarketClient = Pick<GatewayBrowserClient, "request">;

export function createScopedSkillsMarketClient(
  client: SkillsMarketClient | null,
  userSessionToken: string,
): SkillsMarketClient | null {
  if (!client) {
    return null;
  }
  return {
    request: async <T>(method: string, params?: unknown) => {
      const scopedParams = method.startsWith("skills.registry.")
        ? {
            ...(params && typeof params === "object" ? params : {}),
            userSessionToken,
          }
        : params;
      return await client.request<T>(method, scopedParams);
    },
  };
}

export type SkillsMarketState = {
  client: SkillsMarketClient | null;
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

async function loadSkillsCatalog(state: SkillsMarketState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const params = buildRegistryListParams(state);
  // The registry endpoint merges the remote catalog with the authenticated
  // local user's uploaded skills. Falling back to global skills.status here
  // would leak another user's skills into this page.
  const res = await state.client.request<SkillsRegistryListResult>("skills.registry.list", params);
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
    await loadSkillsCatalog(state);
  } catch (err) {
    state.skillsError = getErrorMessage(err);
    state.skillsCatalog = [];
    state.skillsCategories = [];
    state.skillsPagination = { ...DEFAULT_SKILLS_REGISTRY_PAGINATION };
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
  return loadSkillsMarket(state);
}

export function setSkillsCategory(
  state: SkillsMarketState,
  category: string | null,
): Promise<void> {
  state.skillsCategory = category?.trim() ? category.trim() : null;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state);
}

export function setSkillsSortBy(
  state: SkillsMarketState,
  sortBy: SkillsRegistrySortBy,
): Promise<void> {
  state.skillsSortBy = sortBy;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state);
}

export function setSkillsInstallFilter(
  state: SkillsMarketState,
  installFilter: SkillsRegistryInstallFilter,
): Promise<void> {
  state.skillsInstallFilter = installFilter;
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state);
}

export function showAllSkills(state: SkillsMarketState): Promise<void> {
  state.skillsCategory = null;
  state.skillsInstallFilter = "all";
  state.skillsPagination = { ...state.skillsPagination, page: 1 };
  return loadSkillsMarket(state);
}

export function setSkillsPage(state: SkillsMarketState, page: number): Promise<void> {
  state.skillsPagination = {
    ...state.skillsPagination,
    page: Math.max(1, Math.floor(page)),
  };
  return loadSkillsMarket(state);
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
    await loadSkillsMarket(state);
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
    await loadSkillsMarket(state);
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
