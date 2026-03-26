import fs from "node:fs/promises";
import path from "node:path";

export const OPENCLAW_REGISTRY_DIRNAME = ".openclaw-registry";
export const OPENCLAW_REGISTRY_ORIGIN_FILENAME = "origin.json";
export const CLAWHUB_LEGACY_DIRNAME = ".clawhub";
export const CLAWHUB_LEGACY_ORIGIN_FILENAME = "origin.json";

export type RegistryInstallSource = "openclaw-registry" | "clawhub-legacy" | "directory";

export type RegistryOrigin = {
  version: 1;
  provider: "skillcenter";
  baseUrl: string;
  slug: string;
  installedVersion: string | null;
  installedAt: number | null;
};

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOriginRecord(raw: unknown): RegistryOrigin | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const slug = toOptionalString(record.slug);
  if (!slug) {
    return null;
  }
  const provider = toOptionalString(record.provider) ?? "skillcenter";
  if (provider !== "skillcenter") {
    return null;
  }
  const baseUrl = toOptionalString(record.baseUrl) ?? toOptionalString(record.registry) ?? "";
  return {
    version: 1,
    provider: "skillcenter",
    baseUrl,
    slug,
    installedVersion:
      toOptionalString(record.installedVersion) ?? toOptionalString(record.version) ?? null,
    installedAt: toOptionalNumber(record.installedAt) ?? toOptionalNumber(record.ts) ?? null,
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function readRegistryOrigin(skillDir: string): Promise<{
  origin: RegistryOrigin | null;
  source: RegistryInstallSource | null;
}> {
  const openClawOriginPath = path.join(
    skillDir,
    OPENCLAW_REGISTRY_DIRNAME,
    OPENCLAW_REGISTRY_ORIGIN_FILENAME,
  );
  try {
    const origin = normalizeOriginRecord(await readJsonFile(openClawOriginPath));
    if (origin) {
      return { origin, source: "openclaw-registry" };
    }
  } catch {
    // ignore
  }

  const legacyOriginPath = path.join(
    skillDir,
    CLAWHUB_LEGACY_DIRNAME,
    CLAWHUB_LEGACY_ORIGIN_FILENAME,
  );
  try {
    const origin = normalizeOriginRecord(await readJsonFile(legacyOriginPath));
    if (origin) {
      return { origin, source: "clawhub-legacy" };
    }
  } catch {
    // ignore
  }

  return { origin: null, source: null };
}

export async function writeRegistryOrigin(skillDir: string, origin: RegistryOrigin): Promise<void> {
  const originDir = path.join(skillDir, OPENCLAW_REGISTRY_DIRNAME);
  await fs.mkdir(originDir, { recursive: true });
  await fs.writeFile(
    path.join(originDir, OPENCLAW_REGISTRY_ORIGIN_FILENAME),
    JSON.stringify(origin, null, 2),
    "utf8",
  );
}
