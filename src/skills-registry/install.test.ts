import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempDir } from "../infra/install-source-utils.js";

async function createSkillArchiveBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("package/SKILL.md", "# Slides\n\nPresentation helper.");
  zip.file("package/manifest.json", JSON.stringify({ name: "slides" }, null, 2));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("skills registry install flow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("installs a downloaded skill archive into the managed skills dir", async () => {
    await withTempDir("openclaw-skills-registry-install-", async (stateDir) => {
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
      vi.stubEnv("OPENCLAW_TEST_FAST", "1");
      vi.resetModules();

      const bytes = await createSkillArchiveBytes();
      const { installRegistrySkill } = await import("./install.js");
      const { readInstalledRegistrySkills } = await import("./state.js");
      const reportInstall = vi.fn().mockResolvedValue({ installs: 1 });

      const result = await installRegistrySkill({
        slug: "slides",
        cfg: {
          skills: {
            registry: {
              enabled: true,
              baseUrl: "https://skills.example.com",
            },
          },
        },
        client: {
          listCatalog: async () => {
            throw new Error("not used in install test");
          },
          downloadArtifact: async () => ({
            filename: "slides-1.0.0.zip",
            version: "1.0.0",
            contentType: "application/zip",
            bytes,
          }),
          reportInstall,
        },
      });

      expect(result).toMatchObject({
        slug: "slides",
        version: "1.0.0",
        targetDir: path.join(stateDir, "skills", "slides"),
      });
      await expect(fs.readFile(path.join(result.targetDir, "SKILL.md"), "utf8")).resolves.toContain(
        "# Slides",
      );
      await expect(
        fs.readFile(path.join(result.targetDir, ".openclaw-registry", "origin.json"), "utf8"),
      ).resolves.toContain('"slug": "slides"');

      const installed = await readInstalledRegistrySkills({
        managedSkillsDir: path.join(stateDir, "skills"),
      });
      expect(installed.get("slides")).toMatchObject({
        slug: "slides",
        source: "openclaw-registry",
      });
      expect(reportInstall).toHaveBeenCalledWith({
        slug: "slides",
        version: "1.0.0",
        source: "openclaw-registry",
      });
    });
  });

  it("does not fail local install when install-event reporting fails", async () => {
    await withTempDir("openclaw-skills-registry-install-report-", async (stateDir) => {
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
      vi.stubEnv("OPENCLAW_TEST_FAST", "1");
      vi.resetModules();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const bytes = await createSkillArchiveBytes();
      const { installRegistrySkill } = await import("./install.js");

      const result = await installRegistrySkill({
        slug: "slides",
        cfg: {
          skills: {
            registry: {
              enabled: true,
              baseUrl: "https://skills.example.com",
            },
          },
        },
        client: {
          listCatalog: async () => {
            throw new Error("not used in install test");
          },
          downloadArtifact: async () => ({
            filename: "slides-1.0.0.zip",
            version: "1.0.0",
            contentType: "application/zip",
            bytes,
          }),
          reportInstall: async () => {
            throw new Error("report failed");
          },
        },
      });

      expect(result.slug).toBe("slides");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[skills-registry] install event report failed for slides:"),
      );
      warnSpy.mockRestore();
    });
  });

  it("uninstalls a registry-managed skill", async () => {
    await withTempDir("openclaw-skills-registry-uninstall-", async (stateDir) => {
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
      vi.stubEnv("OPENCLAW_TEST_FAST", "1");
      vi.resetModules();

      const managedDir = path.join(stateDir, "skills", "slides");
      await fs.mkdir(managedDir, { recursive: true });

      const { writeRegistryOrigin } = await import("./origin.js");
      const { uninstallRegistrySkill } = await import("./install.js");

      await writeRegistryOrigin(managedDir, {
        version: 1,
        provider: "skillcenter",
        baseUrl: "https://skills.example.com",
        slug: "slides",
        installedVersion: "1.0.0",
        installedAt: 1234,
      });

      const result = await uninstallRegistrySkill({
        slug: "slides",
        cfg: {},
      });

      expect(result).toMatchObject({
        slug: "slides",
        removed: true,
      });
      await expect(fs.stat(managedDir)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("installs an uploaded skill archive as a local managed skill", async () => {
    await withTempDir("openclaw-skills-archive-install-", async (stateDir) => {
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
      vi.stubEnv("OPENCLAW_TEST_FAST", "1");
      vi.resetModules();

      const bytes = await createSkillArchiveBytes();
      const { installSkillArchive } = await import("./install.js");
      const { readInstalledRegistrySkills } = await import("./state.js");

      const result = await installSkillArchive({
        fileName: "slides.zip",
        archiveBytes: bytes,
        cfg: {},
      });

      expect(result).toMatchObject({
        slug: "slides",
        version: null,
        targetDir: path.join(stateDir, "skills", "slides"),
      });
      await expect(fs.readFile(path.join(result.targetDir, "SKILL.md"), "utf8")).resolves.toContain(
        "# Slides",
      );
      await expect(
        fs.stat(path.join(result.targetDir, ".openclaw-registry", "origin.json")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });

      const installed = await readInstalledRegistrySkills({
        managedSkillsDir: path.join(stateDir, "skills"),
      });
      expect(installed.get("slides")).toMatchObject({
        slug: "slides",
        source: "directory",
      });
    });
  });

  it("uninstalls a local skill directory inside the managed skills dir", async () => {
    await withTempDir("openclaw-skills-registry-guard-", async (stateDir) => {
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
      vi.stubEnv("OPENCLAW_TEST_FAST", "1");
      vi.resetModules();

      const localDir = path.join(stateDir, "skills", "local-only");
      await fs.mkdir(localDir, { recursive: true });
      await fs.writeFile(path.join(localDir, "SKILL.md"), "# Local\n", "utf8");

      const { uninstallRegistrySkill } = await import("./install.js");

      const result = await uninstallRegistrySkill({
        slug: "local-only",
        cfg: {},
      });

      expect(result).toMatchObject({
        slug: "local-only",
        removed: true,
        targetDir: localDir,
      });
      await expect(fs.stat(localDir)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
