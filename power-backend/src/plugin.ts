import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { listAgentIds, resolveAgentWorkspaceDir } from "../../src/agents/agent-scope.js";
import { loadConfig, readConfigFileSnapshot } from "../../src/config/config.js";
import { resolveGatewayAuth } from "../../src/gateway/auth.js";
import { ErrorCodes, errorShape } from "../../src/gateway/protocol/index.js";
import type { GatewayRequestHandlerOptions } from "../../src/gateway/server-methods/shared-types.js";
import { parseFrontmatterBlock } from "../../src/markdown/frontmatter.js";
import { normalizeAgentId } from "../../src/routing/session-key.js";
import {
  createSkillsRegistryClient,
  type SkillsRegistryCatalogItemBase,
  type SkillsRegistryCategory,
  type SkillsRegistryInstallFilter,
  type SkillsRegistrySortBy,
} from "../../src/skills-registry/client.js";
import {
  readRegistryOrigin,
  type RegistryInstallSource,
} from "../../src/skills-registry/origin.js";
import {
  buildSkillsRegistryInstallState,
  filterRegistryCatalogItems,
  paginateRegistryCatalogItems,
  resolveManagedSkillsDir,
  type InstalledRegistrySkill,
} from "../../src/skills-registry/state.js";
import { PowerFsService } from "./fs-service.js";
import {
  createPowerFsHttpHandler,
  POWER_FS_DOWNLOAD_HTTP_PATH,
  POWER_FS_UPLOAD_HTTP_PATH,
} from "./http-routes.js";

type PowerBackendPluginConfig = {
  roots: string[];
};

type PowerInstalledSkill = InstalledRegistrySkill & {
  displayName: string;
  summary: string;
  category: string | null;
  tags: string[];
  author: string | null;
  version: string | null;
};

function parsePluginConfig(api: OpenClawPluginApi): PowerBackendPluginConfig {
  const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};

  const roots = Array.isArray(raw.roots)
    ? raw.roots
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => api.resolvePath(entry))
    : [];

  return { roots };
}

function sendError(respond: GatewayRequestHandlerOptions["respond"], error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

async function resolveWorkspaceForAgent(agentIdRaw: unknown) {
  const rawAgentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  if (!rawAgentId) {
    throw new Error("agentId required");
  }
  const cfg = (await readConfigFileSnapshot()).config;
  const agentId = normalizeAgentId(rawAgentId);
  const knownAgentIds = new Set(listAgentIds(cfg));
  if (!knownAgentIds.has(agentId)) {
    throw new Error(`Unknown agent: ${rawAgentId}`);
  }
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspace?.trim()) {
    throw new Error(`No workspace configured for agent: ${agentId}`);
  }
  return {
    agentId,
    workspace,
  };
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFrontmatterJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseFrontmatterStringArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => toOptionalString(item))
        .filter((item): item is string => Boolean(item));
    }
  } catch {
    // ignore and fall back to line splitting
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readLocalSkillMetadata(skillDir: string, slug: string) {
  const defaults = {
    displayName: slug,
    summary: "",
    category: null,
    tags: [],
    author: null,
    version: null,
  };
  try {
    const raw = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatterBlock(raw);
    const metadata = parseFrontmatterJson(toOptionalString(frontmatter.metadata));
    return {
      displayName: toOptionalString(frontmatter.name) ?? defaults.displayName,
      summary: toOptionalString(frontmatter.description) ?? defaults.summary,
      category:
        toOptionalString(metadata?.category) ??
        toOptionalString(frontmatter["metadata.category"]) ??
        defaults.category,
      tags: parseFrontmatterStringArray(toOptionalString(frontmatter.triggers)),
      author:
        toOptionalString(metadata?.author) ??
        toOptionalString(frontmatter["metadata.author"]) ??
        defaults.author,
      version:
        toOptionalString(metadata?.version) ??
        toOptionalString(frontmatter["metadata.version"]) ??
        toOptionalString(frontmatter.version) ??
        defaults.version,
    };
  } catch {
    return defaults;
  }
}

async function readPowerInstalledSkills(): Promise<Map<string, PowerInstalledSkill>> {
  const managedSkillsDir = resolveManagedSkillsDir();
  const map = new Map<string, PowerInstalledSkill>();
  const entries = await fs.readdir(managedSkillsDir, { withFileTypes: true }).catch(() => []);
  const sourcePriority: Record<RegistryInstallSource, number> = {
    "openclaw-registry": 3,
    "clawhub-legacy": 2,
    directory: 1,
  };
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(managedSkillsDir, entry.name);
    const { origin, source } = await readRegistryOrigin(dir);
    const slug = origin?.slug?.trim() || entry.name.trim();
    if (!slug) {
      continue;
    }
    const resolvedSource = source ?? "directory";
    const current = map.get(slug);
    if (current && sourcePriority[current.source] >= sourcePriority[resolvedSource]) {
      continue;
    }
    const metadata = await readLocalSkillMetadata(dir, slug);
    map.set(slug, {
      slug,
      dir,
      origin,
      source: resolvedSource,
      displayName: metadata.displayName,
      summary: metadata.summary,
      category: metadata.category,
      tags: metadata.tags,
      author: metadata.author,
      version: metadata.version,
    });
  }
  return map;
}

function buildPowerCatalogItem(skill: PowerInstalledSkill): SkillsRegistryCatalogItemBase {
  return {
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary,
    category: skill.category,
    tags: skill.tags,
    version: skill.origin?.installedVersion ?? skill.version,
    downloads: 0,
    installs: 0,
    stars: 0,
    updatedAt: skill.origin?.installedAt ?? null,
    author: skill.author,
  };
}

function mergePowerCatalogItems(params: {
  remoteItems: SkillsRegistryCatalogItemBase[];
  installed: Map<string, PowerInstalledSkill>;
}) {
  const merged = params.remoteItems.map((item) => ({
    ...item,
    installState: buildSkillsRegistryInstallState({
      item,
      installed: params.installed,
    }),
  }));
  const knownSlugs = new Set(merged.map((item) => item.slug));
  for (const skill of params.installed.values()) {
    if (knownSlugs.has(skill.slug)) {
      continue;
    }
    const item = buildPowerCatalogItem(skill);
    merged.push({
      ...item,
      installState: buildSkillsRegistryInstallState({
        item,
        installed: params.installed,
      }),
    });
  }
  return merged;
}

function mergeCategories(
  remoteCategories: SkillsRegistryCategory[],
  items: Array<{ category: string | null }>,
): SkillsRegistryCategory[] {
  const categories = [...remoteCategories];
  const known = new Set(categories.map((category) => category.id));
  for (const item of items) {
    const id = item.category?.trim();
    if (!id || known.has(id)) {
      continue;
    }
    categories.push({ id, name: id });
    known.add(id);
  }
  return categories;
}

export default function register(api: OpenClawPluginApi) {
  const config = parsePluginConfig(api);
  const fsService = new PowerFsService(config);
  const gatewayAuth = resolveGatewayAuth({ authConfig: loadConfig().gateway?.auth });
  const powerFsHttpHandler = createPowerFsHttpHandler({
    auth: gatewayAuth,
    fsService,
  });

  api.registerHttpRoute({
    path: POWER_FS_UPLOAD_HTTP_PATH,
    auth: "plugin",
    handler: powerFsHttpHandler,
  });

  api.registerHttpRoute({
    path: POWER_FS_DOWNLOAD_HTTP_PATH,
    auth: "plugin",
    handler: powerFsHttpHandler,
  });

  api.registerGatewayMethod("power.fs.roots", async ({ respond }: GatewayRequestHandlerOptions) => {
    try {
      respond(true, fsService.listRoots());
    } catch (error) {
      sendError(respond, error);
    }
  });

  api.registerGatewayMethod(
    "power.fs.listDirs",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, fsService.listDirs(requestedPath || null));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.validateWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        respond(true, fsService.validateWorkspace(requestedPath));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createDir",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        respond(true, {
          ok: true,
          entry: fsService.createDirectory(requestedPath, name),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.skills.catalog.list",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const cfg = loadConfig();
        const client = createSkillsRegistryClient(cfg);
        const configBaseUrl = cfg.skills?.registry?.baseUrl?.trim() ?? "";
        const p = (params ?? {}) as {
          q?: string;
          category?: string;
          sort?: SkillsRegistrySortBy;
          page?: number;
          limit?: number;
          installFilter?: SkillsRegistryInstallFilter;
        };
        const installed = await readPowerInstalledSkills();
        let remoteItems: SkillsRegistryCatalogItemBase[] = [];
        let remoteCategories: SkillsRegistryCategory[] = [];
        if (client) {
          try {
            const remote = await client.listCatalog({
              q: p.q,
              category: p.category,
              sort: p.sort,
            });
            remoteItems = remote.items;
            remoteCategories = remote.categories;
          } catch {
            // fall back to local catalog only
          }
        }
        const merged = mergePowerCatalogItems({ remoteItems, installed });
        const filtered = filterRegistryCatalogItems({
          items: merged,
          installFilter: p.installFilter,
        });
        const q = p.q?.trim().toLowerCase();
        const queryFiltered = q
          ? filtered.filter((item) =>
              [item.slug, item.displayName, item.summary, item.author, item.category, ...item.tags]
                .filter((value): value is string => Boolean(value))
                .some((value) => value.toLowerCase().includes(q)),
            )
          : filtered;
        const categories = mergeCategories(remoteCategories, queryFiltered);
        respond(
          true,
          paginateRegistryCatalogItems({
            baseUrl: configBaseUrl,
            categories,
            items: queryFiltered,
            page: p.page,
            limit: p.limit,
          }),
        );
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.listWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = await resolveWorkspaceForAgent(params?.agentId);
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, {
          agentId,
          workspace,
          ...fsService.listWorkspaceEntries(workspace, requestedPath || null),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createFolder",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = await resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        const entry = fsService.createWorkspaceDirectory(workspace, currentPath || null, name);
        respond(true, { ok: true, agentId, workspace, entry });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.uploadFiles",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = await resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const files = Array.isArray(params?.files) ? params.files : [];
        if (files.length === 0) {
          respond(false, { error: "files required" });
          return;
        }
        const entries = files.map((file: unknown) => {
          const fileRecord =
            file && typeof file === "object" ? (file as Record<string, unknown>) : {};
          const name = typeof fileRecord.name === "string" ? fileRecord.name.trim() : "";
          const contentBase64 =
            typeof fileRecord.contentBase64 === "string" ? fileRecord.contentBase64.trim() : "";
          if (!name || !contentBase64) {
            throw new Error("Each upload file requires name and contentBase64.");
          }
          return fsService.writeWorkspaceFile(workspace, currentPath || null, name, contentBase64);
        });
        respond(true, { ok: true, agentId, workspace, entries });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.downloadFile",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = await resolveWorkspaceForAgent(params?.agentId);
        const filePath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!filePath) {
          respond(false, { error: "path required" });
          return;
        }
        const file = fsService.readWorkspaceFile(workspace, filePath);
        respond(true, { agentId, workspace, file });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.deleteEntry",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = await resolveWorkspaceForAgent(params?.agentId);
        const targetPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!targetPath) {
          respond(false, { error: "path required" });
          return;
        }
        const result = fsService.deleteWorkspaceEntry(workspace, targetPath);
        respond(true, { agentId, workspace, ...result });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.logger.info(
    `[power-backend] registered power.fs methods with ${fsService.listRoots().roots.length} allowed roots`,
  );
}
