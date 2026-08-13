import { beforeEach, describe, expect, it, vi } from "vitest";

const remoteHttp = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; init?: RequestInit; auditContext: string }>,
  responder: async (_url: string, _init?: RequestInit): Promise<Response> =>
    new Response(null, { status: 500 }),
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
    return await params.onResponse(await remoteHttp.responder(params.url, params.init));
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

function readRequestHeader(
  request: { init?: RequestInit } | undefined,
  name: string,
): string | null {
  return new Headers(request?.init?.headers).get(name);
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

  it("authenticates catalog requests with a cached OAuth2 access token", async () => {
    remoteHttp.responder = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/system/oauth2/token") {
        return Response.json({
          code: 200,
          data: {
            access_token: "test-access-token", // pragma: allowlist secret
            token_type: "bearer",
            expires_in: 3_600,
            scope: "read write",
          },
          success: true,
        });
      }
      if (parsed.pathname === "/api/v1/download") {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/zip" },
        });
      }
      const page = Number(parsed.searchParams.get("page"));
      return Response.json({
        categories: [],
        skills: [],
        pagination: { page, limit: 100, total: 0, totalPages: 2 },
      });
    };
    const client = createSkillsRegistryClient({
      skills: {
        registry: {
          enabled: true,
          baseUrl: "http://skills.example.com",
          boxBaseUrl: "http://box.example.com",
          oauth: {
            clientId: "agent-test",
            clientSecret: "test-client-secret", // pragma: allowlist secret
            scope: "read write",
          },
        },
      },
    });

    await expect(client?.listCatalog()).resolves.toEqual({ categories: [], items: [] });
    await expect(client?.downloadArtifact({ slug: "slides" })).resolves.toMatchObject({
      filename: "slides-latest.zip",
    });

    expect(remoteHttp.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/system/oauth2/token",
      "/api/open/v1/skillsList",
      "/api/open/v1/skillsList",
      "/api/v1/download",
    ]);
    expect(remoteHttp.requests[0]?.init?.method).toBe("POST");
    expect(parseRequestBody(remoteHttp.requests[0])).toEqual({
      grantType: "client_credentials",
      clientId: "agent-test",
      clientSecret: "test-client-secret", // pragma: allowlist secret
      scope: "read write",
    });
    expect(readRequestHeader(remoteHttp.requests[0], "authorization")).toBeNull();
    expect(readRequestHeader(remoteHttp.requests[1], "authorization")).toBe(
      "Bearer test-access-token", // pragma: allowlist secret
    );
    expect(readRequestHeader(remoteHttp.requests[2], "authorization")).toBe(
      "Bearer test-access-token", // pragma: allowlist secret
    );
    expect(readRequestHeader(remoteHttp.requests[3], "authorization")).toBeNull();
  });

  it("downloads by slug and reports install and uninstall state changes", async () => {
    remoteHttp.responder = async (url) => {
      const parsed = new URL(url);
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
      skills: {
        registry: {
          enabled: true,
          baseUrl: "http://skills.example.com",
          boxBaseUrl: "http://box.example.com/",
        },
      },
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
      "/api/v1/download",
      "/api/v1/skills/slides/install-event",
      "/api/v1/skills/slides/install-event",
    ]);
    expect(remoteHttp.requests.map((request) => new URL(request.url).origin)).toEqual([
      "http://box.example.com",
      "http://box.example.com",
      "http://box.example.com",
    ]);
    expect(remoteHttp.requests[0]?.init?.method).toBe("POST");
    expect(parseRequestBody(remoteHttp.requests[0])).toEqual({ skillId: "slides" });
    expect(new URL(remoteHttp.requests[1]?.url ?? "").pathname).toBe(
      "/api/v1/skills/slides/install-event",
    );
    expect(parseRequestBody(remoteHttp.requests[1])).toMatchObject({
      action: "install",
    });
    expect(parseRequestBody(remoteHttp.requests[2])).toMatchObject({
      action: "uninstall",
    });
  });

  it("allows at least 60 seconds for box-side download and decryption", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    remoteHttp.responder = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/zip" },
      });
    const client = createSkillsRegistryClient({
      skills: {
        registry: {
          enabled: true,
          baseUrl: "http://skills.example.com",
          boxBaseUrl: "http://box.example.com",
          timeoutMs: 10_000,
        },
      },
    });

    await expect(client?.downloadArtifact({ slug: "slides" })).resolves.toBeDefined();
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    timeoutSpy.mockRestore();
  });

  it("falls back to the catalog URL for older configs without a box URL", async () => {
    remoteHttp.responder = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/zip" },
      });
    const client = createSkillsRegistryClient({
      skills: { registry: { enabled: true, baseUrl: "http://skills.example.com" } },
    });

    await expect(
      client?.downloadArtifact({ slug: "slides", version: "1.0.0" }),
    ).resolves.toMatchObject({
      filename: "slides-1.0.0.zip",
      version: "1.0.0",
    });
    expect(remoteHttp.requests).toHaveLength(1);
    expect(new URL(remoteHttp.requests[0]?.url ?? "").origin).toBe("http://skills.example.com");
    expect(parseRequestBody(remoteHttp.requests[0])).toEqual({ skillId: "slides" });
  });
});
