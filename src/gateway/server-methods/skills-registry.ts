import { loadConfig } from "../../config/config.js";
import {
  createSkillsRegistryClient,
  type SkillsRegistryInstallFilter,
} from "../../skills-registry/client.js";
import {
  installRegistrySkill,
  installSkillArchive as installRegistrySkillArchive,
  uninstallRegistrySkill,
} from "../../skills-registry/install.js";
import {
  buildSkillsRegistryInstallState,
  filterRegistryCatalogItems,
  mergeRegistryCatalogItems,
  paginateRegistryCatalogItems,
  readInstalledRegistrySkills,
} from "../../skills-registry/state.js";
import { resolveLocalUserSession, resolveLocalUserSkillsDir } from "../../users/local-users.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsRegistryInstallArchiveParams,
  validateSkillsRegistryInstallParams,
  validateSkillsRegistryListParams,
  validateSkillsRegistryUninstallParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function buildRegistryUnavailableError() {
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    "skills registry is not configured; set skills.registry.baseUrl and enable skills.registry",
  );
}

async function resolveUserSkillsDir(params: unknown): Promise<string> {
  const token =
    params &&
    typeof params === "object" &&
    typeof (params as { userSessionToken?: unknown }).userSessionToken === "string"
      ? (params as { userSessionToken: string }).userSessionToken.trim()
      : "";
  const session = token ? await resolveLocalUserSession({ token }) : null;
  if (!session) {
    throw new Error("local user session is required");
  }
  return resolveLocalUserSkillsDir(session.user.id);
}

export const skillsRegistryHandlers: GatewayRequestHandlers = {
  "skills.registry.list": async ({ params, respond }) => {
    if (!validateSkillsRegistryListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.registry.list params: ${formatValidationErrors(validateSkillsRegistryListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      q?: string;
      category?: string;
      sort?: "comprehensive" | "downloads" | "updated";
      page?: number;
      limit?: number;
      installFilter?: SkillsRegistryInstallFilter;
    };
    let managedSkillsDir: string;
    try {
      managedSkillsDir = await resolveUserSkillsDir(params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
      return;
    }
    const cfg = loadConfig();
    const client = createSkillsRegistryClient(cfg);
    // The remote catalog no longer returns baseUrl. Keep the configured URL in
    // the Gateway response so the UI can still open the skills center.
    const configBaseUrl = cfg.skills?.registry?.baseUrl?.trim() ?? "";
    if (!client) {
      const installed = await readInstalledRegistrySkills({ managedSkillsDir });
      const localItems = mergeRegistryCatalogItems({ items: [], installed });
      respond(
        true,
        paginateRegistryCatalogItems({
          baseUrl: "",
          categories: localItems.length > 0 ? [{ id: "local", name: "本地技能" }] : [],
          items: filterRegistryCatalogItems({
            items: localItems,
            q: p.q,
            category: p.category,
            installFilter: p.installFilter,
          }),
          page: p.page,
          limit: p.limit,
        }),
        undefined,
      );
      return;
    }
    try {
      const remote = await client.listCatalog({
        q: p.q,
        category: p.category,
        sort: p.sort,
      });
      const installed = await readInstalledRegistrySkills({ managedSkillsDir });
      const merged = mergeRegistryCatalogItems({
        items: remote.items,
        installed,
      });
      const filtered = filterRegistryCatalogItems({
        items: merged,
        q: p.q,
        category: p.category,
        installFilter: p.installFilter,
      });
      const categories =
        merged.some((item) => item.category?.trim().toLowerCase() === "local") &&
        !remote.categories.some((category) => category.id.trim().toLowerCase() === "local")
          ? [...remote.categories, { id: "local", name: "本地技能" }]
          : remote.categories;
      respond(
        true,
        paginateRegistryCatalogItems({
          baseUrl: configBaseUrl,
          categories,
          items: filtered,
          page: p.page,
          limit: p.limit,
        }),
        undefined,
      );
    } catch (err) {
      const installed = await readInstalledRegistrySkills({ managedSkillsDir });
      const localItems = mergeRegistryCatalogItems({ items: [], installed });
      respond(
        true,
        paginateRegistryCatalogItems({
          baseUrl: configBaseUrl,
          categories: localItems.length > 0 ? [{ id: "local", name: "本地技能" }] : [],
          items: filterRegistryCatalogItems({
            items: localItems,
            q: p.q,
            category: p.category,
            installFilter: p.installFilter,
          }),
          page: p.page,
          limit: p.limit,
        }),
        errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)),
      );
    }
  },
  "skills.registry.install": async ({ params, respond }) => {
    if (!validateSkillsRegistryInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.registry.install params: ${formatValidationErrors(validateSkillsRegistryInstallParams.errors)}`,
        ),
      );
      return;
    }
    let managedSkillsDir: string;
    try {
      managedSkillsDir = await resolveUserSkillsDir(params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
      return;
    }
    const cfg = loadConfig();
    const client = createSkillsRegistryClient(cfg);
    if (!client) {
      respond(false, undefined, buildRegistryUnavailableError());
      return;
    }
    try {
      const p = params as { slug: string; version?: string };
      const result = await installRegistrySkill({
        slug: p.slug,
        version: p.version,
        cfg,
        client,
        managedSkillsDir,
      });
      respond(
        true,
        {
          ok: true,
          ...result,
          installState: {
            installed: true,
            installedVersion: result.version,
            latestVersion: result.version,
            managed: true,
            canUninstall: true,
            source: "openclaw-registry",
          },
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
  "skills.registry.installArchive": async ({ params, respond }) => {
    if (!validateSkillsRegistryInstallArchiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.registry.installArchive params: ${formatValidationErrors(validateSkillsRegistryInstallArchiveParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    try {
      const managedSkillsDir = await resolveUserSkillsDir(params);
      const p = params as { fileName: string; archiveBase64: string; overwrite?: boolean };
      const bytes = Buffer.from(p.archiveBase64, "base64");
      const result = await installRegistrySkillArchive({
        fileName: p.fileName,
        archiveBytes: new Uint8Array(bytes),
        cfg,
        overwrite: p.overwrite,
        managedSkillsDir,
      });
      respond(
        true,
        {
          ok: true,
          ...result,
          installState: {
            installed: true,
            installedVersion: result.version,
            latestVersion: result.version,
            managed: false,
            canUninstall: true,
            source: "directory",
          },
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
  "skills.registry.uninstall": async ({ params, respond }) => {
    if (!validateSkillsRegistryUninstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.registry.uninstall params: ${formatValidationErrors(validateSkillsRegistryUninstallParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const client = createSkillsRegistryClient(cfg);
    try {
      const managedSkillsDir = await resolveUserSkillsDir(params);
      const p = params as { slug: string };
      const result = await uninstallRegistrySkill({
        slug: p.slug,
        cfg,
        client,
        managedSkillsDir,
      });
      const installed = await readInstalledRegistrySkills({ managedSkillsDir });
      const installState = buildSkillsRegistryInstallState({
        item: {
          slug: p.slug,
          displayName: p.slug,
          summary: "",
          category: null,
          tags: [],
          version: null,
          downloads: 0,
          installs: 0,
          stars: 0,
          updatedAt: null,
          author: null,
        },
        installed,
      });
      respond(
        true,
        {
          ok: true,
          ...result,
          installState,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
    }
  },
};
