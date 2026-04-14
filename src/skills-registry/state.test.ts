import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../infra/install-source-utils.js";
import {
  CLAWHUB_LEGACY_DIRNAME,
  CLAWHUB_LEGACY_ORIGIN_FILENAME,
  writeRegistryOrigin,
} from "./origin.js";
import {
  filterRegistryCatalogItems,
  mergeRegistryCatalogItems,
  paginateRegistryCatalogItems,
  readInstalledRegistrySkills,
} from "./state.js";

describe("readInstalledRegistrySkills", () => {
  it("reads openclaw and legacy origins and falls back to directory names", async () => {
    await withTempDir("openclaw-skills-registry-state-", async (managedDir) => {
      const openClawDir = path.join(managedDir, "slides");
      await fs.mkdir(openClawDir, { recursive: true });
      await writeRegistryOrigin(openClawDir, {
        version: 1,
        provider: "skillcenter",
        baseUrl: "https://skills.example.com",
        slug: "slides",
        installedVersion: "1.2.3",
        installedAt: 1000,
      });

      const legacyDir = path.join(managedDir, "legacy-dir");
      await fs.mkdir(path.join(legacyDir, CLAWHUB_LEGACY_DIRNAME), { recursive: true });
      await fs.writeFile(
        path.join(legacyDir, CLAWHUB_LEGACY_DIRNAME, CLAWHUB_LEGACY_ORIGIN_FILENAME),
        JSON.stringify({
          slug: "legacy-skill",
          version: "0.9.0",
          registry: "https://legacy.example.com",
          ts: 2000,
        }),
        "utf8",
      );

      const plainDir = path.join(managedDir, "local-only");
      await fs.mkdir(plainDir, { recursive: true });

      const installed = await readInstalledRegistrySkills({ managedSkillsDir: managedDir });
      expect([...installed.keys()].toSorted()).toEqual(["legacy-skill", "local-only", "slides"]);
      expect(installed.get("slides")).toMatchObject({
        slug: "slides",
        source: "openclaw-registry",
      });
      expect(installed.get("legacy-skill")).toMatchObject({
        slug: "legacy-skill",
        source: "clawhub-legacy",
      });
      expect(installed.get("local-only")).toMatchObject({
        slug: "local-only",
        source: "directory",
      });
    });
  });
});

describe("registry catalog state helpers", () => {
  it("marks uninstallability by install source and paginates filtered items", () => {
    const installed = new Map([
      [
        "slides",
        {
          slug: "slides",
          dir: "/tmp/slides",
          origin: {
            version: 1 as const,
            provider: "skillcenter" as const,
            baseUrl: "https://skills.example.com",
            slug: "slides",
            installedVersion: "1.0.0",
            installedAt: 1000,
          },
          source: "openclaw-registry" as const,
        },
      ],
      [
        "legacy-skill",
        {
          slug: "legacy-skill",
          dir: "/tmp/legacy-skill",
          origin: {
            version: 1 as const,
            provider: "skillcenter" as const,
            baseUrl: "https://legacy.example.com",
            slug: "legacy-skill",
            installedVersion: "0.9.0",
            installedAt: 2000,
          },
          source: "clawhub-legacy" as const,
        },
      ],
      [
        "local-only",
        {
          slug: "local-only",
          dir: "/tmp/local-only",
          origin: null,
          source: "directory" as const,
        },
      ],
    ]);

    const merged = mergeRegistryCatalogItems({
      installed,
      items: [
        {
          slug: "slides",
          displayName: "Slides",
          summary: "presentation helpers",
          category: "productivity",
          tags: ["slides"],
          version: "1.1.0",
          downloads: 50,
          installs: 12,
          stars: 3,
          updatedAt: 3000,
          author: "OpenClaw",
        },
        {
          slug: "legacy-skill",
          displayName: "Legacy",
          summary: "legacy install",
          category: "utility",
          tags: [],
          version: "0.9.0",
          downloads: 10,
          installs: 4,
          stars: 0,
          updatedAt: 2000,
          author: null,
        },
        {
          slug: "local-only",
          displayName: "Local Only",
          summary: "manual copy",
          category: "utility",
          tags: [],
          version: "0.1.0",
          downloads: 1,
          installs: 0,
          stars: 0,
          updatedAt: 1000,
          author: null,
        },
      ],
    });

    expect(merged.find((item) => item.slug === "slides")?.installState).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      latestVersion: "1.1.0",
      canUninstall: true,
      source: "openclaw-registry",
    });
    expect(merged.find((item) => item.slug === "legacy-skill")?.installState).toMatchObject({
      installed: true,
      canUninstall: true,
      source: "clawhub-legacy",
    });
    expect(merged.find((item) => item.slug === "local-only")?.installState).toMatchObject({
      installed: true,
      canUninstall: true,
      source: "directory",
    });

    const installedOnly = filterRegistryCatalogItems({
      items: merged,
      installFilter: "installed",
    });
    expect(installedOnly).toHaveLength(3);

    const paginated = paginateRegistryCatalogItems({
      baseUrl: "https://skills.example.com",
      categories: [],
      items: merged,
      page: 2,
      limit: 2,
    });
    expect(paginated.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(paginated.items.map((item) => item.slug)).toEqual(["local-only"]);
  });
});
