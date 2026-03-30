import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeGatewayBearerRequestOrReply: vi.fn(async () => true),
}));

vi.mock("../http-auth-helpers.js", () => ({
  authorizeGatewayBearerRequestOrReply: mocks.authorizeGatewayBearerRequestOrReply,
}));

const { handleWorkspaceUploadHttpRequest, WORKSPACE_UPLOAD_HTTP_PATH } =
  await import("./workspace.js");

function createResponse() {
  const headers = new Map<string, string | string[] | number>();
  let body = "";
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | string[] | number) {
      headers.set(name, value);
    },
    getHeader(name: string) {
      return headers.get(name);
    },
    end(chunk?: string | Buffer) {
      body = chunk ? String(chunk) : "";
    },
  };
  return { res, headers, readBody: () => body };
}

function createRequest(params: {
  method: string;
  url: string;
  origin?: string;
  accessControlRequestHeaders?: string;
  body?: Buffer | string;
}) {
  const stream = Readable.from(params.body ? [params.body] : []);
  return Object.assign(stream, {
    method: params.method,
    url: params.url,
    headers: {
      host: "127.0.0.1:8080",
      ...(params.origin ? { origin: params.origin } : {}),
      ...(params.accessControlRequestHeaders
        ? { "access-control-request-headers": params.accessControlRequestHeaders }
        : {}),
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  });
}

describe("handleWorkspaceUploadHttpRequest", () => {
  const originalWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.OPENCLAW_WORKSPACE_ROOT;
    } else {
      process.env.OPENCLAW_WORKSPACE_ROOT = originalWorkspaceRoot;
    }
    mocks.authorizeGatewayBearerRequestOrReply.mockClear();
  });

  it("answers CORS preflight requests for workspace upload", async () => {
    const req = createRequest({
      method: "OPTIONS",
      url: `${WORKSPACE_UPLOAD_HTTP_PATH}?path=&name=test.txt`,
      origin: "http://localhost:3000",
      accessControlRequestHeaders: "authorization, content-type",
    });
    const { res, headers } = createResponse();

    const handled = await handleWorkspaceUploadHttpRequest(req as never, res as never, {
      pathname: WORKSPACE_UPLOAD_HTTP_PATH,
      auth: { mode: "none" } as never,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type");
    expect(mocks.authorizeGatewayBearerRequestOrReply).not.toHaveBeenCalled();
  });

  it("returns CORS headers on successful POST uploads", async () => {
    const workspaceRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-upload-"));
    const workspaceRoot = await fs.realpath(workspaceRootRaw);
    process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
    try {
      const req = createRequest({
        method: "POST",
        url: `${WORKSPACE_UPLOAD_HTTP_PATH}?path=&name=hello.txt`,
        origin: "http://localhost:3000",
        body: "hello world",
      });
      const { res, headers, readBody } = createResponse();

      const handled = await handleWorkspaceUploadHttpRequest(req as never, res as never, {
        pathname: WORKSPACE_UPLOAD_HTTP_PATH,
        auth: { mode: "none" } as never,
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(readBody()).toBe(JSON.stringify({ ok: true }));
      expect(await fs.readFile(path.join(workspaceRoot, "hello.txt"), "utf8")).toBe("hello world");
    } finally {
      await fs.rm(workspaceRootRaw, { recursive: true, force: true });
    }
  });
});
