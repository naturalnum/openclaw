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
 */

import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import type { SkillStatusEntry, SkillStatusReport } from "../../agents/skills-status.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { listAgentWorkspaceDirs } from "../../agents/workspace-dirs.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
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
};

export type SkillHubCatalog = {
  /** Skills discovered locally (installed). */
  installed: SkillHubItem[];
  /** Skills available from the remote repository (not yet installed). */
  available: SkillHubItem[];
  /** All items merged (installed first, then available). */
  all: SkillHubItem[];
};

// ─── Remote repository stub ───────────────────────────────────────────────────

/**
 * Fetches the list of skills available in the remote repository.
 *
 * This is intentionally a stub – the real implementation will be a
 * web-service call (or cached local manifest) provided by the
 * openclaw.ai skills marketplace.  For now it returns an empty list
 * so the catalog only shows locally-installed skills until the
 * repository backend is wired up.
 *
 * Replace the body of this function (or inject a real implementation)
 * when the repository API is ready.
 */
async function fetchRepoSkills(): Promise<SkillStatusEntry[]> {
  // TODO: replace with real repository API call, e.g.:
  //   const res = await fetch("https://api.openclaw.ai/skills/catalog");
  //   const json = await res.json();
  //   return json.skills as SkillStatusEntry[];
  return [];
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
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `failed to load local skills: ${message}`));
      return;
    }

    const localNames = new Set(localReport.skills.map((s) => s.name));
    const installedItems: SkillHubItem[] = localReport.skills.map((s) => ({
      ...s,
      installed: true,
    }));

    // 2. Remote repository skills (stub – filtered to exclude already-installed)
    let repoSkills: SkillStatusEntry[] = [];
    try {
      repoSkills = await fetchRepoSkills();
    } catch {
      // Non-fatal: if repo fetch fails, just show local skills
      repoSkills = [];
    }
    const availableItems: SkillHubItem[] = repoSkills
      .filter((s) => !localNames.has(s.name))
      .map((s) => ({ ...s, installed: false }));

    const catalog: SkillHubCatalog = {
      installed: installedItems,
      available: availableItems,
      all: [...installedItems, ...availableItems],
    };
    respond(true, catalog, undefined);
  },
};
