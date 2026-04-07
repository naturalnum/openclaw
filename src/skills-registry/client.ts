import type { OpenClawConfig } from "../config/config.js";
import { buildRemoteBaseUrlPolicy, withRemoteHttpResponse } from "../memory/remote-http.js";

export type SkillsRegistrySortBy = "comprehensive" | "downloads" | "updated";
export type SkillsRegistryInstallFilter = "all" | "installed" | "not_installed";

export type SkillsRegistryCategory = {
  id: string;
  name: string;
  icon?: string;
  bgColor?: string;
  textColor?: string;
};

export type SkillsRegistryCatalogItemBase = {
  slug: string;
  displayName: string;
  summary: string;
  category: string | null;
  tags: string[];
  version: string | null;
  downloads: number;
  installs: number;
  stars: number;
  updatedAt: number | null;
  author: string | null;
};

export type SkillsRegistryCatalogResponse = {
  baseUrl: string;
  categories: SkillsRegistryCategory[];
  items: SkillsRegistryCatalogItemBase[];
};

export type SkillsRegistryArtifact = {
  filename: string;
  version: string | null;
  contentType: string;
  bytes: Uint8Array;
};

export type SkillsRegistryInstallReport = {
  installs: number;
};

export type SkillsRegistryClient = {
  listCatalog(params?: {
    q?: string;
    category?: string | null;
    sort?: SkillsRegistrySortBy;
  }): Promise<SkillsRegistryCatalogResponse>;
  downloadArtifact(params: { slug: string; version?: string }): Promise<SkillsRegistryArtifact>;
  reportInstall(params: {
    slug: string;
    version?: string | null;
    source: "openclaw-registry" | "upload";
  }): Promise<SkillsRegistryInstallReport>;
};

type RemoteCatalogCategory = {
  id?: unknown;
  name?: unknown;
  icon?: unknown;
  bgColor?: unknown;
  textColor?: unknown;
};

type RemoteCatalogSkill = {
  slug?: unknown;
  displayName?: unknown;
  summary?: unknown;
  category?: unknown;
  tags?: unknown;
  version?: unknown;
  downloads?: unknown;
  installs?: unknown;
  stars?: unknown;
  updatedAt?: unknown;
  author?: unknown;
};

type RemoteCatalogPage = {
  baseUrl?: unknown;
  categories?: unknown;
  skills?: unknown;
  pagination?: {
    page?: unknown;
    limit?: unknown;
    total?: unknown;
    totalPages?: unknown;
  };
};

type RemoteInstallEventResponse = {
  installs?: unknown;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeCategory(raw: RemoteCatalogCategory): SkillsRegistryCategory | null {
  const id = toOptionalString(raw.id);
  const name = toOptionalString(raw.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    icon: toOptionalString(raw.icon) ?? undefined,
    bgColor: toOptionalString(raw.bgColor) ?? undefined,
    textColor: toOptionalString(raw.textColor) ?? undefined,
  };
}

function normalizeCatalogItem(raw: RemoteCatalogSkill): SkillsRegistryCatalogItemBase | null {
  const slug = toOptionalString(raw.slug);
  const displayName = toOptionalString(raw.displayName);
  if (!slug || !displayName) {
    return null;
  }
  return {
    slug,
    displayName,
    summary: toOptionalString(raw.summary) ?? "",
    category: toOptionalString(raw.category),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((tag) => toOptionalString(tag)).filter((tag): tag is string => Boolean(tag))
      : [],
    version: toOptionalString(raw.version),
    downloads: toNumber(raw.downloads, 0),
    installs: toNumber(raw.installs, 0),
    stars: toNumber(raw.stars, 0),
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    author: toOptionalString(raw.author),
  };
}

function buildCatalogUrl(
  baseUrl: string,
  params: {
    q?: string;
    category?: string | null;
    sort?: SkillsRegistrySortBy;
    page: number;
    limit: number;
  },
): string {
  const url = new URL("/api/ui/catalog", `${baseUrl}/`);
  if (params.q?.trim()) {
    url.searchParams.set("q", params.q.trim());
  }
  if (params.category?.trim()) {
    url.searchParams.set("category", params.category.trim());
  }
  if (params.sort) {
    url.searchParams.set("sort", params.sort);
  }
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("limit", String(params.limit));
  return url.toString();
}

async function requestJson<T>(params: {
  url: string;
  baseUrl: string;
  timeoutMs: number;
  auditContext: string;
  init?: RequestInit;
}): Promise<T> {
  const ssrfPolicy = buildRemoteBaseUrlPolicy(params.baseUrl);
  return await withRemoteHttpResponse({
    url: params.url,
    init: {
      ...params.init,
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(params.timeoutMs) }
        : {}),
    },
    ssrfPolicy,
    auditContext: params.auditContext,
    onResponse: async (response) => {
      if (!response.ok) {
        const body = (await response.text()).trim();
        throw new Error(body || `registry request failed (${response.status})`);
      }
      return (await response.json()) as T;
    },
  });
}

function parseFilenameFromDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function sanitizeDownloadedFilename(filename: string): string {
  const normalized = filename.trim().replace(/^['"]|['"]$/g, "");
  const segment = normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
  return segment.trim();
}

function inferVersionFromFilename(filename: string, slug: string): string | null {
  const normalized = sanitizeDownloadedFilename(filename);
  const prefix = `${slug}-`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".zip")) {
    return null;
  }
  const version = normalized.slice(prefix.length, -".zip".length).trim();
  return version.length > 0 ? version : null;
}

function resolveRegistryConfig(cfg: OpenClawConfig): { baseUrl: string; timeoutMs: number } | null {
  if (cfg.skills?.registry?.enabled === false) {
    return null;
  }
  const baseUrl = normalizeBaseUrl(cfg.skills?.registry?.baseUrl ?? "");
  if (!baseUrl) {
    return null;
  }
  return {
    baseUrl,
    timeoutMs:
      typeof cfg.skills?.registry?.timeoutMs === "number" &&
      Number.isFinite(cfg.skills.registry.timeoutMs)
        ? Math.max(1_000, Math.floor(cfg.skills.registry.timeoutMs))
        : 10_000,
  };
}

export function createSkillsRegistryClient(cfg: OpenClawConfig): SkillsRegistryClient | null {
  const resolved = resolveRegistryConfig(cfg);
  if (!resolved) {
    return null;
  }
  const { baseUrl, timeoutMs } = resolved;

  return {
    async listCatalog(params) {
      const limit = 100;
      let page = 1;
      let totalPages = 1;
      const categories: SkillsRegistryCategory[] = [];
      const items: SkillsRegistryCatalogItemBase[] = [];
      let responseBaseUrl = baseUrl;
      do {
        const payload = await requestJson<RemoteCatalogPage>({
          url: buildCatalogUrl(baseUrl, {
            q: params?.q,
            category: params?.category,
            sort: params?.sort,
            page,
            limit,
          }),
          baseUrl,
          timeoutMs,
          auditContext: "skills-registry-list",
        });
        const pageCategories = Array.isArray(payload.categories)
          ? payload.categories
              .map((entry) => normalizeCategory((entry ?? {}) as RemoteCatalogCategory))
              .filter((entry): entry is SkillsRegistryCategory => Boolean(entry))
          : [];
        if (page === 1 && pageCategories.length > 0) {
          categories.push(...pageCategories);
        }
        if (Array.isArray(payload.skills)) {
          items.push(
            ...payload.skills
              .map((entry) => normalizeCatalogItem((entry ?? {}) as RemoteCatalogSkill))
              .filter((entry): entry is SkillsRegistryCatalogItemBase => Boolean(entry)),
          );
        }
        responseBaseUrl = toOptionalString(payload.baseUrl) ?? responseBaseUrl;
        const nextTotalPages = toNumber(payload.pagination?.totalPages, 1);
        totalPages = Math.max(1, nextTotalPages);
        page += 1;
      } while (page <= totalPages);

      return {
        baseUrl: responseBaseUrl,
        categories,
        items,
      };
    },
    async downloadArtifact(params) {
      const url = new URL("/api/v1/download", `${baseUrl}/`);
      url.searchParams.set("slug", params.slug);
      if (params.version?.trim()) {
        url.searchParams.set("version", params.version.trim());
      }
      const ssrfPolicy = buildRemoteBaseUrlPolicy(baseUrl);
      return await withRemoteHttpResponse({
        url: url.toString(),
        init:
          typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? { signal: AbortSignal.timeout(timeoutMs) }
            : undefined,
        ssrfPolicy,
        auditContext: "skills-registry-download",
        onResponse: async (response) => {
          if (!response.ok) {
            const body = (await response.text()).trim();
            throw new Error(body || `registry download failed (${response.status})`);
          }
          const filename = sanitizeDownloadedFilename(
            parseFilenameFromDisposition(response.headers.get("content-disposition")) ??
              `${params.slug}-${params.version ?? "latest"}.zip`,
          );
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            filename,
            version: params.version ?? inferVersionFromFilename(filename, params.slug),
            contentType: response.headers.get("content-type") ?? "application/octet-stream",
            bytes,
          };
        },
      });
    },
    async reportInstall(params) {
      const payload = await requestJson<RemoteInstallEventResponse>({
        url: new URL(
          `/api/v1/skills/${encodeURIComponent(params.slug)}/install-event`,
          `${baseUrl}/`,
        ).toString(),
        baseUrl,
        timeoutMs,
        auditContext: "skills-registry-install-event",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            version: params.version?.trim() || null,
            source: params.source,
          }),
        },
      });
      return {
        installs: toNumber(payload?.installs, 0),
      };
    },
  };
}
