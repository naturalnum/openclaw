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
    const cfg = loadConfig();
    const client = createSkillsRegistryClient(cfg);
    if (!client) {
      respond(false, undefined, buildRegistryUnavailableError());
      return;
    }
    try {
      const p = params as {
        q?: string;
        category?: string;
        sort?: "comprehensive" | "downloads" | "updated";
        page?: number;
        limit?: number;
        installFilter?: SkillsRegistryInstallFilter;
      };
      const remote = await client.listCatalog({
        q: p.q,
        category: p.category,
        sort: p.sort,
      });
      const installed = await readInstalledRegistrySkills();
      const merged = mergeRegistryCatalogItems({
        items: remote.items,
        installed,
      });
      const filtered = filterRegistryCatalogItems({
        items: merged,
        installFilter: p.installFilter,
      });
      respond(
        true,
        paginateRegistryCatalogItems({
          baseUrl: remote.baseUrl,
          categories: remote.categories,
          items: filtered,
          page: p.page,
          limit: p.limit,
        }),
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, getErrorMessage(err)));
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
      const p = params as { fileName: string; archiveBase64: string; overwrite?: boolean };
      const bytes = Buffer.from(p.archiveBase64, "base64");
      const result = await installRegistrySkillArchive({
        fileName: p.fileName,
        archiveBytes: new Uint8Array(bytes),
        cfg,
        overwrite: p.overwrite,
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
    try {
      const p = params as { slug: string };
      const result = await uninstallRegistrySkill({
        slug: p.slug,
        cfg,
      });
      const installed = await readInstalledRegistrySkills();
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
