import { beforeEach, describe, expect, it, vi } from "vitest";

let currentConfig: Record<string, unknown> = {
  skills: {
    registry: {
      enabled: true,
      baseUrl: "https://skills.example.com",
    },
  },
};

const createSkillsRegistryClientMock = vi.fn();
const readInstalledRegistrySkillsMock = vi.fn();
const mergeRegistryCatalogItemsMock = vi.fn();
const filterRegistryCatalogItemsMock = vi.fn();
const paginateRegistryCatalogItemsMock = vi.fn();
const installRegistrySkillMock = vi.fn();
const installSkillArchiveMock = vi.fn();
const uninstallRegistrySkillMock = vi.fn();
const buildSkillsRegistryInstallStateMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => currentConfig,
}));

vi.mock("../../skills-registry/client.js", () => ({
  createSkillsRegistryClient: (...args: unknown[]) => createSkillsRegistryClientMock(...args),
}));

vi.mock("../../skills-registry/state.js", () => ({
  readInstalledRegistrySkills: (...args: unknown[]) => readInstalledRegistrySkillsMock(...args),
  mergeRegistryCatalogItems: (...args: unknown[]) => mergeRegistryCatalogItemsMock(...args),
  filterRegistryCatalogItems: (...args: unknown[]) => filterRegistryCatalogItemsMock(...args),
  paginateRegistryCatalogItems: (...args: unknown[]) => paginateRegistryCatalogItemsMock(...args),
  buildSkillsRegistryInstallState: (...args: unknown[]) =>
    buildSkillsRegistryInstallStateMock(...args),
}));

vi.mock("../../skills-registry/install.js", () => ({
  installRegistrySkill: (...args: unknown[]) => installRegistrySkillMock(...args),
  installSkillArchive: (...args: unknown[]) => installSkillArchiveMock(...args),
  uninstallRegistrySkill: (...args: unknown[]) => uninstallRegistrySkillMock(...args),
}));

const { skillsRegistryHandlers } = await import("./skills-registry.js");

function createRespondCapture() {
  const payload: {
    ok?: boolean;
    body?: unknown;
    error?: unknown;
  } = {};
  return {
    payload,
    respond: (ok: boolean, body?: unknown, error?: unknown) => {
      payload.ok = ok;
      payload.body = body;
      payload.error = error;
    },
  };
}

describe("skills.registry handlers", () => {
  beforeEach(() => {
    currentConfig = {
      skills: {
        registry: {
          enabled: true,
          baseUrl: "https://skills.example.com",
        },
      },
    };
    createSkillsRegistryClientMock.mockReset();
    readInstalledRegistrySkillsMock.mockReset();
    mergeRegistryCatalogItemsMock.mockReset();
    filterRegistryCatalogItemsMock.mockReset();
    paginateRegistryCatalogItemsMock.mockReset();
    installRegistrySkillMock.mockReset();
    installSkillArchiveMock.mockReset();
    uninstallRegistrySkillMock.mockReset();
    buildSkillsRegistryInstallStateMock.mockReset();
  });

  it("rejects invalid list params", async () => {
    const { payload, respond } = createRespondCapture();

    await skillsRegistryHandlers["skills.registry.list"]({
      params: { page: 0 },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond,
    });

    expect(payload.ok).toBe(false);
    expect(payload.error).toMatchObject({
      message: expect.stringContaining("invalid skills.registry.list params"),
    });
  });

  it("returns unavailable when registry config is missing", async () => {
    createSkillsRegistryClientMock.mockReturnValue(null);
    const { payload, respond } = createRespondCapture();

    await skillsRegistryHandlers["skills.registry.list"]({
      params: {},
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond,
    });

    expect(payload.ok).toBe(false);
    expect(payload.error).toMatchObject({
      message: expect.stringContaining("skills registry is not configured"),
    });
  });

  it("lists registry skills through the adapter pipeline", async () => {
    createSkillsRegistryClientMock.mockReturnValue({
      listCatalog: vi.fn().mockResolvedValue({
        baseUrl: "https://skills.example.com",
        categories: [{ id: "productivity", name: "Productivity" }],
        items: [
          {
            slug: "slides",
            displayName: "Slides",
            summary: "presentation helpers",
            category: "productivity",
            tags: [],
            version: "1.0.0",
            downloads: 10,
            installs: 3,
            stars: 1,
            updatedAt: 1000,
            author: null,
          },
        ],
      }),
    });
    readInstalledRegistrySkillsMock.mockResolvedValue(new Map());
    mergeRegistryCatalogItemsMock.mockReturnValue([
      {
        slug: "slides",
        displayName: "Slides",
        summary: "presentation helpers",
        category: "productivity",
        tags: [],
        version: "1.0.0",
        downloads: 10,
        installs: 3,
        stars: 1,
        updatedAt: 1000,
        author: null,
        installState: {
          installed: false,
          installedVersion: null,
          latestVersion: "1.0.0",
          managed: false,
          canUninstall: false,
          source: null,
        },
      },
    ]);
    filterRegistryCatalogItemsMock.mockImplementation(({ items }) => items);
    paginateRegistryCatalogItemsMock.mockImplementation((value) => ({
      baseUrl: value.baseUrl,
      categories: value.categories,
      items: value.items,
      pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
    }));

    const { payload, respond } = createRespondCapture();

    await skillsRegistryHandlers["skills.registry.list"]({
      params: { q: "slides", installFilter: "all" },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond,
    });

    expect(payload.ok).toBe(true);
    expect(payload.body).toMatchObject({
      items: [{ slug: "slides" }],
      pagination: { total: 1 },
    });
    expect(readInstalledRegistrySkillsMock).toHaveBeenCalledTimes(1);
    expect(mergeRegistryCatalogItemsMock).toHaveBeenCalledTimes(1);
    expect(filterRegistryCatalogItemsMock).toHaveBeenCalledTimes(1);
    expect(paginateRegistryCatalogItemsMock).toHaveBeenCalledTimes(1);
  });

  it("installs a registry skill and returns install state", async () => {
    createSkillsRegistryClientMock.mockReturnValue({ downloadArtifact: vi.fn() });
    installRegistrySkillMock.mockResolvedValue({
      slug: "slides",
      version: "1.0.0",
      targetDir: "/tmp/slides",
      message: "Installed",
    });
    const { payload, respond } = createRespondCapture();

    await skillsRegistryHandlers["skills.registry.install"]({
      params: { slug: "slides", version: "1.0.0" },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond,
    });

    expect(payload.ok).toBe(true);
    expect(payload.body).toMatchObject({
      ok: true,
      slug: "slides",
      version: "1.0.0",
      installState: {
        installed: true,
        canUninstall: true,
        source: "openclaw-registry",
      },
    });
  });

  it("installs an uploaded skill archive and returns local install state", async () => {
    installSkillArchiveMock.mockResolvedValue({
      slug: "slides",
      version: null,
      targetDir: "/tmp/slides",
      message: "Installed",
    });
    const { payload, respond } = createRespondCapture();

    await skillsRegistryHandlers["skills.registry.installArchive"]({
      params: {
        fileName: "slides.zip",
        archiveBase64: Buffer.from("zip-bytes").toString("base64"),
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond,
    });

    expect(payload.ok).toBe(true);
    expect(payload.body).toMatchObject({
      ok: true,
      slug: "slides",
      version: null,
      installState: {
        installed: true,
        managed: false,
        canUninstall: true,
        source: "directory",
      },
    });
  });
});
