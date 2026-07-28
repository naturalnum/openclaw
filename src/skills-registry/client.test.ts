import { beforeEach, describe, expect, it, vi } from "vitest";

const remoteHttp = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; init?: RequestInit; auditContext: string }>,
  responder: async (_url: string): Promise<Response> => new Response(null, { status: 500 }),
}));

vi.mock("../memory-host-sdk/host/remote-http.js", () => ({
  buildRemoteBaseUrlPolicy: (baseUrl: string) => ({ baseUrl }),
  withRemoteHttpResponse: async <T>(params: {
    url: string;
    init?: RequestInit;
    auditContext: string;
    onResponse: (response: Response) => Promise<T>;
  }) => {
    remoteHttp.requests.push({
      url: params.url,
      init: params.init,
      auditContext: params.auditContext,
    });
    return await params.onResponse(await remoteHttp.responder(params.url));
  },
}));

import { createSkillsRegistryClient } from "./client.js";

function parseRequestBody(request: { init?: RequestInit } | undefined): unknown {
  const body = request?.init?.body;
  if (typeof body !== "string") {
    throw new TypeError("expected request body to be a JSON string");
  }
  return JSON.parse(body) as unknown;
}

describe("skills registry client", () => {
  beforeEach(() => {
    remoteHttp.requests = [];
  });

  it("does not fall back to a public registry when SkillCenter is unconfigured", () => {
    expect(createSkillsRegistryClient({})).toBeNull();
    expect(createSkillsRegistryClient({ skills: { registry: { enabled: false } } })).toBeNull();
  });

  it("reads every SkillCenter catalog page using the open API contract", async () => {
    remoteHttp.responder = async (url) => {
      const page = new URL(url).searchParams.get("page");
      return Response.json({
        categories:
          page === "1"
            ? [
                {
                  id: "content",
                  name: "Content",
                  icon: " ",
                  bgColor: "",
                  textColor: " ",
                },
                {
                  id: "development",
                  name: "Development",
                  icon: "</>",
                  bgColor: " #faf5ff ",
                  textColor: null,
                },
                {
                  id: "empty",
                  name: "Empty",
                  icon: null,
                  bgColor: null,
                  textColor: "#2563eb",
                },
              ]
            : [],
        skills: [
          {
            slug: `slides-${page}`,
            displayName: `Slides ${page}`,
            summary: "Presentation helper",
            category: "content",
            tags: ["slides"],
            version: "1.0.0",
            downloads: 2,
            installs: 1,
            stars: 0,
            updatedAt: 1234,
            author: "SkillCenter",
          },
        ],
        pagination: { page: Number(page), limit: 100, total: 2, totalPages: 2 },
      });
    };
    const client = createSkillsRegistryClient({
      skills: { registry: { enabled: true, baseUrl: "http://skills.example.com/" } },
    });

    await expect(client?.listCatalog({ q: "slide", sort: "downloads" })).resolves.toMatchObject({
      categories: [
        { id: "content", name: "Content" },
        { id: "development", name: "Development", icon: "</>", bgColor: "#faf5ff" },
        { id: "empty", name: "Empty", textColor: "#2563eb" },
      ],
      items: [{ slug: "slides-1" }, { slug: "slides-2" }],
    });
    expect(remoteHttp.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/open/v1/skillsList",
      "/api/open/v1/skillsList",
    ]);
    expect(new URL(remoteHttp.requests[0]?.url ?? "").searchParams.get("q")).toBe("slide");
  });

  it("resolves download fields, downloads the decrypted package, and reports state changes", async () => {
    remoteHttp.responder = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/open/v1/skillsList") {
        return Response.json({
          skills: [
            {
              slug: "slides",
              displayName: "Slides",
              version: "1.0.0",
              filePath: "http://files.example.com/slides-1.0.0.zip.encrypted",
              fileSize: 123,
              fileName: "slides-1.0.0.zip",
              sign: "mock-signature",
              md5: "46cd9ba5b5d8b49908c1e6271e093006",
            },
          ],
          pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
        });
      }
      if (parsed.pathname === "/api/v1/download") {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="slides-1.0.0.zip"',
          },
        });
      }
      return Response.json({ installs: 9 });
    };
    const client = createSkillsRegistryClient({
      skills: { registry: { enabled: true, baseUrl: "http://skills.example.com" } },
    });

    await expect(
      client?.downloadArtifact({ slug: "slides", version: "1.0.0" }),
    ).resolves.toMatchObject({
      filename: "slides-1.0.0.zip",
      version: "1.0.0",
      contentType: "application/zip",
      bytes: new Uint8Array([1, 2, 3]),
    });
    await expect(
      client?.reportInstall({
        slug: "slides",
        action: "install",
        version: "1.0.0",
        source: "openclaw-registry",
      }),
    ).resolves.toEqual({ installs: 9 });
    await expect(
      client?.reportInstall({
        slug: "slides",
        action: "uninstall",
        version: "1.0.0",
        source: "openclaw-registry",
      }),
    ).resolves.toEqual({ installs: 9 });

    expect(remoteHttp.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/open/v1/skillsList",
      "/api/v1/download",
      "/api/v1/skills/slides/install-event",
      "/api/v1/skills/slides/install-event",
    ]);
    expect(remoteHttp.requests[1]?.init?.method).toBe("POST");
    expect(parseRequestBody(remoteHttp.requests[1])).toEqual({
      filePath: "http://files.example.com/slides-1.0.0.zip.encrypted",
      fileSize: 123,
      fileName: "slides-1.0.0.zip",
      sign: "mock-signature",
      md5: "46cd9ba5b5d8b49908c1e6271e093006",
    });
    expect(new URL(remoteHttp.requests[2]?.url ?? "").pathname).toBe(
      "/api/v1/skills/slides/install-event",
    );
    expect(parseRequestBody(remoteHttp.requests[2])).toMatchObject({
      action: "install",
    });
    expect(parseRequestBody(remoteHttp.requests[3])).toMatchObject({
      action: "uninstall",
    });
  });

  it("fails clearly when the catalog has not been adapted with download fields", async () => {
    remoteHttp.responder = async () =>
      Response.json({
        skills: [{ slug: "slides", displayName: "Slides", version: "1.0.0" }],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    const client = createSkillsRegistryClient({
      skills: { registry: { enabled: true, baseUrl: "http://skills.example.com" } },
    });

    await expect(client?.downloadArtifact({ slug: "slides", version: "1.0.0" })).rejects.toThrow(
      "expected filePath, fileSize, fileName, sign, and md5",
    );
    expect(remoteHttp.requests).toHaveLength(1);
  });
});
