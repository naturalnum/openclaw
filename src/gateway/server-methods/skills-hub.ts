/**
 * skills-hub server-side handlers
 *
 * Independent namespace (skillsHub.*) for the Skills Hub UI panel.
 * Delegates to the same underlying agent/skill logic as skills.*, but
 * lives under its own method names so the hub can be extended
 * independently (bulk ops, favorites, global cross-agent views, etc.)
 * without touching the original skills.* surface.
 *
 * Methods exposed:
 *   skillsHub.status   – full skill-status report (all agents or a specific one)
 *   skillsHub.bins     – union of all required/install bins across workspaces
 *   skillsHub.install  – install a skill by name + installId
 *   skillsHub.update   – enable/disable a skill or save its API key / env vars
 *   skillsHub.catalog  – merged catalog of installed (local) + available (repo) skills
 *   skillsHub.installFromRepo – download + install a skill from the remote repository
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { extractArchive } from "../../agents/skills-install-extract.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import type { SkillStatusEntry, SkillStatusReport } from "../../agents/skills-status.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { listAgentWorkspaceDirs } from "../../agents/workspace-dirs.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { assertCanonicalPathWithinBase } from "../../infra/install-safe-path.js";
import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { CONFIG_DIR, ensureDir } from "../../utils.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsHubCatalogParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

// ─── Catalog types ────────────────────────────────────────────────────────────

/**
 * A single entry in the skills-hub catalog.
 * Installed skills come from the local skills directory and carry full
 * SkillStatusEntry data.  Available (not-yet-installed) skills come from
 * the remote repository and carry only the metadata needed for the
 * install / preview UI.
 */
export type SkillHubItem = SkillStatusEntry & {
  /** True when the skill exists in the local skills directory. */
  installed: boolean;
  // ── Remote repository fields (optional, only set for repo-sourced items) ──
  /** Unique identifier in the skills-hub repository. */
  slug?: string;
  /** Human-friendly display name from the repository. */
  displayName?: string;
  /** Short summary from the repository. */
  summary?: string | null;
  /** Tags / categories from the repository. */
  tags?: string[];
  /** Cumulative download count from the repository. */
  downloads?: number;
  /** Repository-side updated-at timestamp (ms). */
  repoUpdatedAt?: number;
  /** Repository-side created-at timestamp (ms). */
  repoCreatedAt?: number;
  /** Latest published version metadata from the repository. */
  latestVersion?: {
    version: string;
    changelog: string;
    size: number;
    /** Relative download path – must be joined with the hub baseUrl. */
    downloadUrl: string;
    reviewStatus: string;
  } | null;
};

export type SkillHubPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

export type SkillHubCatalog = {
  /** Skills discovered locally (installed). */
  installed: SkillHubItem[];
  /** Skills available from the remote repository (not yet installed). */
  available: SkillHubItem[];
  /** All items merged (installed first, then available). */
  all: SkillHubItem[];
  /** Pagination metadata for the remote repository results. */
  pagination?: SkillHubPagination;
};

// ─── Remote repository helpers ────────────────────────────────────────────────

/**
 * Resolves the skills-hub API base URL (used for catalog/install RPC calls).
 * Priority: env var CLAWHUB_REGISTRY > config file skills.hub.registry > undefined.
 */
function resolveHubBaseUrl(cfg: OpenClawConfig): string | undefined {
  const envUrl = process.env.CLAWHUB_REGISTRY?.trim();
  if (envUrl) {
    return envUrl;
  }
  return cfg.skills?.hub?.registry?.trim() || undefined;
}

type FetchRepoResult = { items: SkillHubItem[]; total: number };

/**
 * Fetches the list of skills available from the remote skills-hub service.
 * Returns an empty result when no hub URL is configured or if the request fails.
 */
async function fetchRepoSkills(
  cfg: OpenClawConfig,
  page: number,
  pageSize: number,
  keyword?: string,
): Promise<FetchRepoResult> {
  const empty: FetchRepoResult = { items: [], total: 0 };
  const baseUrl = resolveHubBaseUrl(cfg);
  if (!baseUrl) {
    return empty;
  }

  const timeoutMs = cfg.skills?.hub?.timeoutMs ?? 15_000;
  const kw = keyword?.trim();
  const kwParam = kw ? `&keyword=${encodeURIComponent(kw)}` : "";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/skills?page=${page}&pageSize=${pageSize}&sort=updated${kwParam}`;

  // Allow the operator-configured hub hostname (including localhost for local dev).
  let hubHostname: string | undefined;
  try {
    hubHostname = new URL(baseUrl).hostname;
  } catch {
    // ignore malformed baseUrl
  }
  const policy = hubHostname ? { allowedHostnames: [hubHostname] } : undefined;

  let response: Response | undefined;
  let release: (() => Promise<void>) | undefined;
  try {
    const result = await fetchWithSsrFGuard({
      url,
      mode: "trusted_env_proxy",
      timeoutMs,
      auditContext: "skills-hub-catalog",
      policy,
    });
    response = result.response;
    release = result.release;

    if (!response.ok) {
      return empty;
    }

    const json = (await response.json()) as {
      ok?: boolean;
      total?: number;
      page?: number;
      pageSize?: number;
      baseUrl?: string;
      items?: Array<{
        slug?: string;
        displayName?: string;
        summary?: string | null;
        tags?: string[];
        createdAt?: string;
        updatedAt?: string;
        stats?: { downloads?: number };
        latestVersion?: {
          version?: string;
          createdAt?: string;
          changelog?: string;
          file?: string;
          fingerprint?: string | null;
          size?: number;
          downloads?: number;
          reviewStatus?: string;
          downloadUrl?: string;
        } | null;
      }>;
    };

    const items: SkillHubItem[] = (json.items ?? []).map((s) => ({
      // Required SkillStatusEntry fields – fill with sensible defaults for
      // remote skills that are not yet installed locally.
      name: s.slug ?? s.displayName ?? "unknown-skill",
      description: s.summary ?? "",
      source: "repo",
      filePath: "",
      baseDir: "",
      skillKey: s.slug ?? "",
      bundled: false,
      always: false,
      disabled: false,
      blockedByAllowlist: false,
      eligible: true,
      requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
      missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
      configChecks: [],
      install: [],
      installed: false,
      // Repo-specific metadata
      slug: s.slug,
      displayName: s.displayName,
      summary: s.summary,
      tags: s.tags,
      downloads: s.stats?.downloads ?? 0,
      repoUpdatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : undefined,
      repoCreatedAt: s.createdAt ? new Date(s.createdAt).getTime() : undefined,
      latestVersion: s.latestVersion
        ? {
            version: s.latestVersion.version ?? "0.0.0",
            changelog: s.latestVersion.changelog ?? "",
            size: s.latestVersion.size ?? 0,
            downloadUrl: s.latestVersion.downloadUrl ?? "",
            reviewStatus: s.latestVersion.reviewStatus ?? "unknown",
          }
        : null,
    }));

    const total = typeof json.total === "number" ? json.total : items.length;
    return { items, total };
  } catch {
    // Non-fatal: silently return empty when hub is unreachable
    return empty;
  } finally {
    await release?.();
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

// ─── Handler map ──────────────────────────────────────────────────────────────

export const skillsHubHandlers: GatewayRequestHandlers = {
  /**
   * skillsHub.status
   *
   * Returns the full SkillStatusReport for the given agent (or the default
   * agent when agentId is omitted).  Semantically identical to skills.status
   * but scoped to the hub namespace so UI state is isolated.
   */
  "skillsHub.status": ({ params, respond }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillsHub.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
    if (agentIdRaw) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${agentIdRaw}"`),
        );
        return;
      }
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    respond(true, report, undefined);
  },

  /**
   * skillsHub.bins
   *
   * Returns the union of all binary dependencies required/recommended by
   * skills across every agent workspace.  Used by the hub to surface
   * "missing dependency" information globally.
   */
  "skillsHub.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillsHub.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listAgentWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },

  /**
   * skillsHub.install
   *
   * Installs a skill by name and installId into the default agent workspace.
   * Delegates directly to the shared installSkill helper; the hub namespace
   * allows the frontend to track install state independently of skills panel.
   */
  "skillsHub.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillsHub.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },

  /**
   * skillsHub.update
   *
   * Updates per-skill configuration (enabled flag, API key, env vars) in the
   * global config file.  Uses the same config path as skills.update so changes
   * are immediately reflected regardless of which panel the user views.
   */
  "skillsHub.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillsHub.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = normalizeSecretInput(p.apiKey);
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: OpenClawConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },

  /**
   * skillsHub.catalog
   *
   * Returns a merged catalog that combines:
   *   1. All locally installed skills (from the bundled/managed/workspace
   *      skills directories – i.e. what lives under the `skills/` folder).
   *   2. Skills available from the remote repository that are NOT already
   *      installed locally (stub – returns empty until the repo API is ready).
   *
   * Each item carries an `installed` flag so the UI can split the list
   * into "Installed" and "Available" tabs without extra filtering logic.
   */
  "skillsHub.catalog": async ({ params, respond }) => {
    if (!validateSkillsHubCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillsHub.catalog params: ${formatValidationErrors(validateSkillsHubCatalogParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);

    if (agentIdRaw) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${agentIdRaw}"`),
        );
        return;
      }
    }

    const page = typeof params?.page === "number" ? params.page : 1;
    const pageSize =
      typeof params?.pageSize === "number" ? params.pageSize : (cfg.skills?.hub?.pageSize ?? 50);
    const keyword = typeof params?.keyword === "string" ? params.keyword : undefined;

    // 1. Locally installed skills (full status report)
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    let localReport: SkillStatusReport;
    try {
      localReport = buildWorkspaceSkillStatus(workspaceDir, {
        config: cfg,
        eligibility: { remote: getRemoteSkillEligibility() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to load local skills: ${message}`),
      );
      return;
    }

    const localNames = new Set(localReport.skills.map((s) => s.name));
    const installedItems: SkillHubItem[] = localReport.skills.map((s) => ({
      ...s,
      installed: true,
    }));

    // 2. Remote repository skills (paginated) – filtered to exclude already-installed
    let repoResult: FetchRepoResult = { items: [], total: 0 };
    try {
      repoResult = await fetchRepoSkills(cfg, page, pageSize, keyword);
    } catch {
      // Non-fatal: if repo fetch fails, just show local skills
    }
    const availableItems: SkillHubItem[] = repoResult.items.filter(
      (s) => !localNames.has(s.name) && !localNames.has(s.slug ?? ""),
    );

    const totalPages = pageSize > 0 ? Math.ceil(repoResult.total / pageSize) : 1;
    const catalog = {
      installed: installedItems,
      available: availableItems,
      all: [...installedItems, ...availableItems],
      pagination: {
        page,
        pageSize,
        total: repoResult.total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
    respond(true, catalog, undefined);
  },

  /**
   * skillsHub.installFromRepo
   *
   * Downloads a skill archive from the remote skills-hub repository and
   * extracts it into the managed skills directory (~/.openclaw/skills/<slug>/).
   * After extraction the catalog is automatically refreshed so the frontend
   * sees the newly installed skill immediately.
   *
   * Params:
   *   slug         – skill identifier in the repo (used as local folder name)
   *   downloadUrl  – relative download path (joined with hub baseUrl)
   *   version      – version label (informational, included in the response)
   */
  "skillsHub.installFromRepo": async ({ params, respond }) => {
    const slug = typeof params?.slug === "string" ? params.slug.trim() : "";
    const downloadUrl = typeof params?.downloadUrl === "string" ? params.downloadUrl.trim() : "";
    const version = typeof params?.version === "string" ? params.version.trim() : "";
    if (!slug || !downloadUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required params: slug, downloadUrl"),
      );
      return;
    }

    const cfg = loadConfig();
    const baseUrl = resolveHubBaseUrl(cfg);
    if (!baseUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "skills-hub base URL is not configured"),
      );
      return;
    }

    const fullUrl = downloadUrl.startsWith("http")
      ? downloadUrl
      : `${baseUrl.replace(/\/+$/, "")}/${downloadUrl.replace(/^\/+/, "")}`;

    // Allow the operator-configured hub hostname (including localhost for local dev).
    let hubHostname: string | undefined;
    try {
      hubHostname = new URL(baseUrl).hostname;
    } catch {
      // ignore malformed baseUrl
    }
    const installPolicy = hubHostname ? { allowedHostnames: [hubHostname] } : undefined;

    const managedSkillsDir = path.join(CONFIG_DIR, "skills");
    await ensureDir(managedSkillsDir);

    // Sanitize slug to prevent path traversal
    const safeName = slug.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!safeName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid skill slug"));
      return;
    }
    const skillDir = path.join(managedSkillsDir, safeName);
    await assertCanonicalPathWithinBase({
      baseDir: managedSkillsDir,
      candidatePath: skillDir,
      boundaryLabel: "managed skills directory",
    });

    const timeoutMs = cfg.skills?.hub?.timeoutMs ?? 60_000;
    const stagingDir = path.join(managedSkillsDir, `.staging-${randomUUID()}`);

    // Detect archive format from a filename string (URL path or Content-Disposition filename).
    function resolveArchiveType(name: string): { archiveType: string; ext: string } | null {
      const lower = name.split("?")[0]?.toLowerCase() ?? "";
      if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
        return { archiveType: "tar.gz", ext: ".tar.gz" };
      }
      if (lower.endsWith(".zip")) {
        return { archiveType: "zip", ext: ".zip" };
      }
      if (lower.endsWith(".tar")) {
        return { archiveType: "tar", ext: ".tar" };
      }
      if (lower.endsWith(".tar.bz2")) {
        return { archiveType: "tar.bz2", ext: ".tar.bz2" };
      }
      return null;
    }

    let response: Response | undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      await ensureDir(stagingDir);

      // Download archive
      const result = await fetchWithSsrFGuard({
        url: fullUrl,
        mode: "trusted_env_proxy",
        timeoutMs,
        auditContext: "skills-hub-install",
        policy: installPolicy,
      });
      response = result.response;
      release = result.release;

      if (!response.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `download failed: ${response.status} ${response.statusText}`,
          ),
        );
        return;
      }

      // Refine format detection: prefer Content-Disposition filename > URL > default tar.gz.
      // The server sets Content-Disposition: attachment; filename="slug-1.0.0.zip" with the
      // real extension, which is more reliable than the URL path which has no extension.
      let detected = resolveArchiveType(fullUrl);
      const contentDisposition = response.headers.get("content-disposition") ?? "";
      const cdMatch = /filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i.exec(contentDisposition);
      if (cdMatch?.[1]) {
        const fromCd = resolveArchiveType(cdMatch[1].trim());
        if (fromCd) {
          detected = fromCd;
        }
      }
      // Also try Content-Type as a last hint before magic-byte fallback.
      if (!detected) {
        const ct = (response.headers.get("content-type") ?? "").toLowerCase();
        if (ct.includes("zip")) {
          detected = { archiveType: "zip", ext: ".zip" };
        } else if (ct.includes("gzip") || ct.includes("x-gzip")) {
          detected = { archiveType: "tar.gz", ext: ".tar.gz" };
        } else if (ct.includes("x-tar")) {
          detected = { archiveType: "tar", ext: ".tar" };
        } else if (ct.includes("bzip2")) {
          detected = { archiveType: "tar.bz2", ext: ".tar.bz2" };
        }
      }
      // Final fallback when no hint is available.
      const resolvedDetected = detected ?? { archiveType: "tar.gz", ext: ".tar.gz" };

      const archiveName = `${safeName}${resolvedDetected.ext}`;
      const archivePath = path.join(stagingDir, archiveName);

      // Stream the archive to disk
      if (!response.body) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "empty response body"));
        return;
      }
      const body = response.body as unknown;
      const readable =
        typeof (body as NodeJS.ReadableStream).pipe === "function"
          ? (body as NodeJS.ReadableStream)
          : Readable.fromWeb(body as NodeReadableStream);
      await pipeline(readable, fs.createWriteStream(archivePath));

      // Sanity-check: read the first 4 bytes to detect the actual archive format.
      // Magic bytes are the ground truth – override header-based detection when they disagree.
      const magicBuf = Buffer.alloc(4);
      const fdCheck = await fs.promises.open(archivePath, "r");
      try {
        await fdCheck.read(magicBuf, 0, 4, 0);
      } finally {
        await fdCheck.close();
      }
      // gzip: 1f 8b  |  zip: 50 4b
      const isGzip = magicBuf[0] === 0x1f && magicBuf[1] === 0x8b;
      const isZip = magicBuf[0] === 0x50 && magicBuf[1] === 0x4b;

      // Auto-correct archiveType based on magic bytes when header detection was wrong/missing.
      let actualArchiveType = resolvedDetected.archiveType;
      if (isGzip && resolvedDetected.archiveType !== "tar.gz") {
        actualArchiveType = "tar.gz";
      } else if (isZip && resolvedDetected.archiveType !== "zip") {
        actualArchiveType = "zip";
      } else if (!isGzip && !isZip && resolvedDetected.archiveType === "tar.gz") {
        // Neither gzip nor zip – likely an error page; surface the content.
        const previewBuf = Buffer.alloc(512);
        const fdPreview = await fs.promises.open(archivePath, "r");
        let previewLen = 0;
        try {
          const { bytesRead } = await fdPreview.read(previewBuf, 0, 512, 0);
          previewLen = bytesRead;
        } finally {
          await fdPreview.close();
        }
        const preview = previewBuf
          .subarray(0, previewLen)
          .toString("utf8")
          .replace(/\s+/g, " ")
          .trim();
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `download returned unexpected content (not a recognized archive): ${preview.slice(0, 200)}`,
          ),
        );
        return;
      }

      // Extract into skill directory
      await ensureDir(skillDir);
      const extractResult = await extractArchive({
        archivePath,
        archiveType: actualArchiveType,
        targetDir: skillDir,
        stripComponents: 1,
        timeoutMs,
      });
      if (extractResult.code !== 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `extraction failed: ${extractResult.stderr || "unknown error"}`,
          ),
        );
        return;
      }

      respond(
        true,
        {
          ok: true,
          slug: safeName,
          version,
          message: `Installed ${safeName}${version ? ` v${version}` : ""} into ${skillDir}`,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    } finally {
      await release?.();
      // Clean up staging directory
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  /**
   * skillsHub.uninstall
   *
   * Removes a managed skill from the local skills directory
   * (~/.openclaw/skills/<slug>/). Only managed skills (source = "openclaw-managed")
   * can be uninstalled; bundled/workspace skills are rejected.
   *
   * Params:
   *   skillKey – the skill's skillKey (used as the directory name under managedSkillsDir)
   */
  "skillsHub.uninstall": async ({ params, respond }) => {
    const skillKey = typeof params?.skillKey === "string" ? params.skillKey.trim() : "";
    if (!skillKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required param: skillKey"),
      );
      return;
    }

    // Sanitize to prevent path traversal
    const safeName = skillKey.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!safeName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid skillKey"));
      return;
    }

    const managedSkillsDir = path.join(CONFIG_DIR, "skills");
    const skillDir = path.join(managedSkillsDir, safeName);

    // Ensure we're not escaping the managed dir
    try {
      await assertCanonicalPathWithinBase({
        baseDir: managedSkillsDir,
        candidatePath: skillDir,
        boundaryLabel: "managed skills directory",
      });
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid skill path"));
      return;
    }

    try {
      await fs.promises.access(skillDir);
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `skill not found: ${skillKey}`));
      return;
    }

    try {
      await fs.promises.rm(skillDir, { recursive: true, force: true });
      respond(
        true,
        { ok: true, skillKey: safeName, message: `Uninstalled ${safeName}` },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `uninstall failed: ${message}`));
    }
  },
};
