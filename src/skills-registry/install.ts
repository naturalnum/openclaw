import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { bumpSkillsSnapshotVersion } from "../agents/skills/refresh.js";
import type { OpenClawConfig } from "../config/config.js";
import { withExtractedArchiveRoot } from "../infra/install-flow.js";
import { withTempDir } from "../infra/install-source-utils.js";
import { isPathInside } from "../infra/path-guards.js";
import { scanDirectoryWithSummary } from "../security/skill-scanner.js";
import type { SkillsRegistryClient } from "./client.js";
import { writeRegistryOrigin } from "./origin.js";
import { readInstalledRegistrySkills, resolveManagedSkillsDir } from "./state.js";

const REGISTRY_SKILL_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

export type InstallRegistrySkillResult = {
  slug: string;
  version: string | null;
  targetDir: string;
  message: string;
};

export type UninstallRegistrySkillResult = {
  slug: string;
  removed: boolean;
  targetDir: string;
  message: string;
};

type InstalledRegistrySkillRecord =
  Awaited<ReturnType<typeof readInstalledRegistrySkills>> extends Map<string, infer TValue>
    ? TValue
    : never;

function assertSafeRegistrySlug(slug: string): string {
  const normalized = slug.trim();
  if (!REGISTRY_SKILL_SLUG_RE.test(normalized)) {
    throw new Error(`invalid skill slug: ${slug}`);
  }
  return normalized;
}

function sanitizeSlugCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFileSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9._-]+/gi, "-");
  return normalized.length > 0 ? normalized : "artifact";
}

async function ensureSkillArchiveContainsSkill(rootDir: string): Promise<void> {
  const skillFile = path.join(rootDir, "SKILL.md");
  try {
    const stat = await fs.stat(skillFile);
    if (!stat.isFile()) {
      throw new Error("downloaded archive does not contain a valid SKILL.md");
    }
  } catch {
    throw new Error("downloaded archive does not contain SKILL.md");
  }
}

function summarizeScanWarnings(
  summary: Awaited<ReturnType<typeof scanDirectoryWithSummary>>,
): string {
  if (summary.critical > 0) {
    return `Installed with ${summary.critical} critical warning${summary.critical === 1 ? "" : "s"}`;
  }
  if (summary.warn > 0) {
    return `Installed with ${summary.warn} warning${summary.warn === 1 ? "" : "s"}`;
  }
  return "Installed";
}

function assertZipArchiveFilename(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized || !normalized.toLowerCase().endsWith(".zip")) {
    throw new Error("only .zip skill archives are supported");
  }
  return normalized;
}

function inferArchiveInstallSlug(params: { rootDir: string; fileName: string }): string {
  const rootName = path.basename(params.rootDir).trim();
  if (rootName && rootName.toLowerCase() !== "package") {
    return assertSafeRegistrySlug(rootName);
  }
  const parsed = path.parse(params.fileName);
  const fallback = sanitizeSlugCandidate(parsed.name);
  if (!fallback) {
    throw new Error(`unable to infer skill slug from archive name: ${params.fileName}`);
  }
  return assertSafeRegistrySlug(fallback);
}

async function installExtractedSkillRoot(params: {
  rootDir: string;
  managedSkillsDir: string;
  slug: string;
  existing: InstalledRegistrySkillRecord | null;
  installedVersion: string | null;
  registryBaseUrl?: string | null;
  writeOrigin: boolean;
}): Promise<{
  ok: true;
  slug: string;
  version: string | null;
  targetDir: string;
  message: string;
}> {
  await ensureSkillArchiveContainsSkill(params.rootDir);
  let message = "Installed";
  try {
    const scanSummary = await scanDirectoryWithSummary(params.rootDir);
    message = summarizeScanWarnings(scanSummary);
  } catch {
    // Scanner failures should not block a registry install.
  }

  const targetDir = path.join(params.managedSkillsDir, params.slug);
  const targetParent = path.dirname(targetDir);
  const stageDir = path.join(targetParent, `.registry-skill-${params.slug}-${randomUUID()}`);
  await fs.cp(params.rootDir, stageDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  if (params.writeOrigin) {
    await writeRegistryOrigin(stageDir, {
      version: 1,
      provider: "skillcenter",
      baseUrl: params.registryBaseUrl?.trim() ?? "",
      slug: params.slug,
      installedVersion: params.installedVersion,
      installedAt: Date.now(),
    });
  }
  if (params.existing) {
    await fs.rm(params.existing.dir, { recursive: true, force: true });
  }
  await fs.rename(stageDir, targetDir);
  return {
    ok: true,
    slug: params.slug,
    version: params.installedVersion,
    targetDir,
    message,
  };
}

export async function installRegistrySkill(params: {
  slug: string;
  version?: string;
  cfg: OpenClawConfig;
  client: SkillsRegistryClient;
}): Promise<InstallRegistrySkillResult> {
  const slug = assertSafeRegistrySlug(params.slug);
  const managedSkillsDir = resolveManagedSkillsDir();
  await fs.mkdir(managedSkillsDir, { recursive: true });
  const installed = await readInstalledRegistrySkills({ managedSkillsDir });
  const existing = installed.get(slug) ?? null;
  if (existing && existing.source === "directory") {
    throw new Error(`skill directory already exists and is not registry-managed: ${existing.dir}`);
  }

  const artifact = await params.client.downloadArtifact({
    slug,
    version: params.version,
  });

  return await withTempDir("openclaw-skills-registry-", async (tmpDir) => {
    const archivePath = path.join(
      tmpDir,
      `${sanitizeFileSegment(slug)}-${sanitizeFileSegment(artifact.version ?? "latest")}.zip`,
    );
    await fs.writeFile(archivePath, artifact.bytes);

    const extracted = await withExtractedArchiveRoot({
      archivePath,
      tempDirPrefix: "openclaw-skills-registry-extract-",
      timeoutMs: 120_000,
      onExtracted: async (rootDir) => {
        return await installExtractedSkillRoot({
          rootDir,
          managedSkillsDir,
          slug,
          existing,
          installedVersion: artifact.version ?? null,
          registryBaseUrl: params.cfg.skills?.registry?.baseUrl?.trim() ?? "",
          writeOrigin: true,
        });
      },
    });

    if (!extracted.ok) {
      throw new Error(extracted.error);
    }
    bumpSkillsSnapshotVersion({
      reason: "manual",
      changedPath: extracted.targetDir,
    });
    try {
      await params.client.reportInstall({
        slug,
        version: extracted.version,
        source: "openclaw-registry",
      });
    } catch (error) {
      console.warn(`[skills-registry] install event report failed for ${slug}: ${String(error)}`);
    }
    return {
      slug: extracted.slug,
      version: extracted.version,
      targetDir: extracted.targetDir,
      message: extracted.message,
    };
  });
}

export async function installSkillArchive(params: {
  fileName: string;
  archiveBytes: Uint8Array;
  cfg: OpenClawConfig;
  overwrite?: boolean;
}): Promise<InstallRegistrySkillResult> {
  const fileName = assertZipArchiveFilename(params.fileName);
  const managedSkillsDir = resolveManagedSkillsDir();
  await fs.mkdir(managedSkillsDir, { recursive: true });

  return await withTempDir("openclaw-skills-archive-", async (tmpDir) => {
    const archivePath = path.join(tmpDir, sanitizeFileSegment(fileName));
    await fs.writeFile(archivePath, params.archiveBytes);

    const extracted = await withExtractedArchiveRoot({
      archivePath,
      tempDirPrefix: "openclaw-skills-archive-extract-",
      timeoutMs: 120_000,
      onExtracted: async (rootDir) => {
        const slug = inferArchiveInstallSlug({ rootDir, fileName });
        const installed = await readInstalledRegistrySkills({ managedSkillsDir });
        const existing = installed.get(slug) ?? null;
        if (existing && params.overwrite !== true) {
          throw new Error(`skill already exists: ${slug}`);
        }
        return await installExtractedSkillRoot({
          rootDir,
          managedSkillsDir,
          slug,
          existing,
          installedVersion: null,
          writeOrigin: false,
        });
      },
    });

    if (!extracted.ok) {
      throw new Error(extracted.error);
    }
    bumpSkillsSnapshotVersion({
      reason: "manual",
      changedPath: extracted.targetDir,
    });
    return {
      slug: extracted.slug,
      version: extracted.version,
      targetDir: extracted.targetDir,
      message: extracted.message,
    };
  });
}

export async function uninstallRegistrySkill(params: {
  slug: string;
  cfg: OpenClawConfig;
}): Promise<UninstallRegistrySkillResult> {
  const slug = assertSafeRegistrySlug(params.slug);
  const managedSkillsDir = resolveManagedSkillsDir();
  const installed = await readInstalledRegistrySkills({ managedSkillsDir });
  const hit = installed.get(slug) ?? null;
  const targetDir = path.join(managedSkillsDir, slug);
  if (!hit) {
    return {
      slug,
      removed: false,
      targetDir,
      message: "Skill is not installed",
    };
  }
  const resolvedTarget = path.resolve(hit.dir);
  const resolvedManagedRoot = path.resolve(managedSkillsDir);
  if (
    resolvedTarget === resolvedManagedRoot ||
    !isPathInside(resolvedManagedRoot, resolvedTarget)
  ) {
    throw new Error(`refusing to remove path outside managed skills dir: ${resolvedTarget}`);
  }
  await fs.rm(resolvedTarget, { recursive: true, force: true });
  bumpSkillsSnapshotVersion({
    reason: "manual",
    changedPath: resolvedTarget,
  });
  return {
    slug,
    removed: true,
    targetDir: resolvedTarget,
    message: "Uninstalled",
  };
}
