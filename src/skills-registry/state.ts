import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import type {
  SkillsRegistryCatalogItemBase,
  SkillsRegistryCategory,
  SkillsRegistryInstallFilter,
} from "./client.js";
import { readRegistryOrigin, type RegistryInstallSource, type RegistryOrigin } from "./origin.js";

export type SkillsRegistryInstallState = {
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  managed: boolean;
  canUninstall: boolean;
  source: RegistryInstallSource | null;
};

export type InstalledRegistrySkill = {
  slug: string;
  dir: string;
  origin: RegistryOrigin | null;
  source: RegistryInstallSource;
};

export type SkillsRegistryCatalogItem = SkillsRegistryCatalogItemBase & {
  installState: SkillsRegistryInstallState;
};

export type SkillsRegistryPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type SkillsRegistryListResult = {
  baseUrl: string;
  categories: SkillsRegistryCategory[];
  items: SkillsRegistryCatalogItem[];
  pagination: SkillsRegistryPagination;
};

const SOURCE_PRIORITY: Record<RegistryInstallSource, number> = {
  "openclaw-registry": 3,
  "clawhub-legacy": 2,
  directory: 1,
};

export function resolveManagedSkillsDir(managedSkillsDir?: string): string {
  return managedSkillsDir?.trim() ? managedSkillsDir : path.join(CONFIG_DIR, "skills");
}

export async function readInstalledRegistrySkills(params?: {
  managedSkillsDir?: string;
}): Promise<Map<string, InstalledRegistrySkill>> {
  const managedSkillsDir = resolveManagedSkillsDir(params?.managedSkillsDir);
  const map = new Map<string, InstalledRegistrySkill>();
  const entries = await fs.readdir(managedSkillsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillDir = path.join(managedSkillsDir, entry.name);
    const { origin, source } = await readRegistryOrigin(skillDir);
    const slug = origin?.slug?.trim() || entry.name.trim();
    if (!slug) {
      continue;
    }
    const resolvedSource = source ?? "directory";
    const current = map.get(slug);
    if (current && SOURCE_PRIORITY[current.source] >= SOURCE_PRIORITY[resolvedSource]) {
      continue;
    }
    map.set(slug, {
      slug,
      dir: skillDir,
      origin,
      source: resolvedSource,
    });
  }
  return map;
}

export function buildSkillsRegistryInstallState(params: {
  item: SkillsRegistryCatalogItemBase;
  installed: Map<string, InstalledRegistrySkill>;
}): SkillsRegistryInstallState {
  const hit = params.installed.get(params.item.slug) ?? null;
  const canUninstall = hit != null;
  return {
    installed: Boolean(hit),
    installedVersion: hit?.origin?.installedVersion ?? null,
    latestVersion: params.item.version,
    managed: hit != null && hit.source !== "directory",
    canUninstall,
    source: hit?.source ?? null,
  };
}

export function mergeRegistryCatalogItems(params: {
  items: SkillsRegistryCatalogItemBase[];
  installed: Map<string, InstalledRegistrySkill>;
}): SkillsRegistryCatalogItem[] {
  return params.items.map((item) => ({
    ...item,
    installState: buildSkillsRegistryInstallState({
      item,
      installed: params.installed,
    }),
  }));
}

export function filterRegistryCatalogItems(params: {
  items: SkillsRegistryCatalogItem[];
  installFilter?: SkillsRegistryInstallFilter;
}): SkillsRegistryCatalogItem[] {
  switch (params.installFilter) {
    case "installed":
      return params.items.filter((item) => item.installState.installed);
    case "not_installed":
      return params.items.filter((item) => !item.installState.installed);
    default:
      return params.items;
  }
}

export function paginateRegistryCatalogItems(params: {
  baseUrl: string;
  categories: SkillsRegistryCategory[];
  items: SkillsRegistryCatalogItem[];
  page?: number;
  limit?: number;
}): SkillsRegistryListResult {
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 12;
  const total = params.items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const requestedPage =
    typeof params.page === "number" && Number.isFinite(params.page)
      ? Math.max(1, Math.floor(params.page))
      : 1;
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * limit;
  return {
    baseUrl: params.baseUrl,
    categories: params.categories,
    items: params.items.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}
