import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SKILLS_INSTALL_FILTER,
  DEFAULT_SKILLS_REGISTRY_PAGINATION,
  DEFAULT_SKILLS_SORT_BY,
  createScopedSkillsMarketClient,
  loadSkillsMarket,
  setSkillsCategory,
  showAllSkills,
  toggleRegistrySkillInstall,
  type SkillsMarketClient,
  type SkillsMarketState,
} from "./skills-market-controller";
import type { SkillsRegistryCatalogItem, SkillsRegistryListResult } from "./types";

function emptyListResult(): SkillsRegistryListResult {
  return {
    baseUrl: "https://skills.example.com",
    categories: [],
    items: [],
    pagination: { page: 1, limit: 12, total: 0, totalPages: 1 },
  };
}

function createState(request: ReturnType<typeof vi.fn>): SkillsMarketState {
  return {
    client: {
      request: request as unknown as SkillsMarketClient["request"],
    },
    connected: true,
    skillsLoading: false,
    skillsReport: null,
    skillsError: null,
    skillsBusyKey: null,
    skillsArchiveBusy: false,
    skillMessages: {},
    skillsNotice: null,
    skillsFilter: "",
    skillsCatalog: [],
    skillsCategories: [],
    skillsRegistryBaseUrl: null,
    skillsPagination: { ...DEFAULT_SKILLS_REGISTRY_PAGINATION },
    skillsCategory: null,
    skillsSortBy: DEFAULT_SKILLS_SORT_BY,
    skillsInstallFilter: DEFAULT_SKILLS_INSTALL_FILTER,
  };
}

describe("skills market controller", () => {
  it("adds the local-user session only to registry requests", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = createScopedSkillsMarketClient(
      { request: request as unknown as SkillsMarketClient["request"] },
      "alice-session",
    );

    await client?.request("skills.registry.list", { q: "slides" });
    await client?.request("other.method", { value: 1 });

    expect(request).toHaveBeenNthCalledWith(1, "skills.registry.list", {
      q: "slides",
      userSessionToken: "alice-session",
    });
    expect(request).toHaveBeenNthCalledWith(2, "other.method", { value: 1 });
  });

  it("loads only the user-scoped registry endpoint", async () => {
    const response: SkillsRegistryListResult = {
      ...emptyListResult(),
      categories: [{ id: "ai", name: "AI" }],
    };
    const request = vi.fn().mockResolvedValue(response);
    const state = createState(request);

    await loadSkillsMarket(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "skills.registry.list",
      expect.objectContaining({ installFilter: "all" }),
    );
    expect(state.skillsCategories).toEqual([{ id: "ai", name: "AI" }]);
    expect(state.skillsError).toBeNull();
  });

  it("clears both category and install filters when showing all skills", async () => {
    const request = vi.fn().mockResolvedValue(emptyListResult());
    const state = createState(request);
    state.skillsCategory = "ai";
    state.skillsInstallFilter = "installed";
    state.skillsPagination.page = 4;

    await showAllSkills(state);

    expect(state.skillsCategory).toBeNull();
    expect(state.skillsInstallFilter).toBe("all");
    expect(state.skillsPagination.page).toBe(1);
    expect(request).toHaveBeenCalledWith(
      "skills.registry.list",
      expect.objectContaining({ category: undefined, installFilter: "all", page: 1 }),
    );
  });

  it("clears only the category when selecting all categories", async () => {
    const request = vi.fn().mockResolvedValue(emptyListResult());
    const state = createState(request);
    state.skillsCategory = "content";
    state.skillsInstallFilter = "installed";
    state.skillsPagination.page = 3;

    await setSkillsCategory(state, null);

    expect(state.skillsCategory).toBeNull();
    expect(state.skillsInstallFilter).toBe("installed");
    expect(state.skillsPagination.page).toBe(1);
    expect(request).toHaveBeenCalledWith(
      "skills.registry.list",
      expect.objectContaining({ category: undefined, installFilter: "installed", page: 1 }),
    );
  });

  it("installs and refreshes a remote skill", async () => {
    const skill: SkillsRegistryCatalogItem = {
      slug: "slides",
      displayName: "Slides",
      summary: "Presentations",
      category: "content",
      tags: [],
      version: "1.0.0",
      downloads: 1,
      installs: 1,
      stars: 0,
      updatedAt: 1,
      author: null,
      installState: {
        installed: false,
        installedVersion: null,
        latestVersion: "1.0.0",
        managed: false,
        canUninstall: false,
        source: null,
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "skills.registry.install") {
        return {
          ok: true,
          slug: "slides",
          version: "1.0.0",
          targetDir: "/tmp/slides",
          message: "Installed",
          installState: { ...skill.installState, installed: true },
        };
      }
      return emptyListResult();
    });
    const state = createState(request);

    await toggleRegistrySkillInstall(state, skill);

    expect(request).toHaveBeenNthCalledWith(1, "skills.registry.install", {
      slug: "slides",
      version: "1.0.0",
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "skills.registry.list",
      expect.objectContaining({ installFilter: "all" }),
    );
    expect(state.skillMessages.slides).toEqual({ kind: "success", message: "Installed" });
    expect(state.skillsBusyKey).toBeNull();
  });
});
