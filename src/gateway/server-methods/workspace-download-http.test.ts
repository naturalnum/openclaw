import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const { handleWorkspaceDownloadHttpRequest, WORKSPACE_DOWNLOAD_HTTP_PATH } =
  await import("./workspace.js");

function createRequest(params: {
  method: string;
  url: string;
  body?: string;
  authorization?: string;
}) {
  const body = params.body ?? "";
  const stream = Readable.from(body ? [body] : []);
  return Object.assign(stream, {
    method: params.method,
    url: params.url,
    headers: {
      host: "127.0.0.1:8080",
      ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}),
      ...(params.authorization ? { authorization: params.authorization } : {}),
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  });
}

function createResponse() {
  const headers = new Map<string, string | number | string[]>();
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & {
    statusCode: number;
    headersSent?: boolean;
    setHeader: (name: string, value: string | number | string[]) => void;
    getHeader: (name: string) => string | number | string[] | undefined;
  };
  writable.statusCode = 200;
  writable.setHeader = (name, value) => {
    headers.set(name, value);
  };
  writable.getHeader = (name) => headers.get(name);
  const originalWrite = writable.write.bind(writable);
  writable.write = ((
    chunk: Buffer | string,
    encoding?: BufferEncoding,
    cb?: (error?: Error | null) => void,
  ) => {
    writable.headersSent = true;
    return originalWrite(chunk, encoding as never, cb as never);
  }) as typeof writable.write;
  const originalEnd = writable.end.bind(writable);
  writable.end = ((chunk?: Buffer | string, encoding?: BufferEncoding, cb?: () => void) => {
    if (chunk != null) {
      writable.headersSent = true;
    }
    return originalEnd(chunk as never, encoding as never, cb as never);
  }) as typeof writable.end;
  return {
    res: writable,
    headers,
    readBody: () => Buffer.concat(chunks).toString("utf8"),
  };
}

describe("handleWorkspaceDownloadHttpRequest", () => {
  const originalWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.OPENCLAW_WORKSPACE_ROOT;
    } else {
      process.env.OPENCLAW_WORKSPACE_ROOT = originalWorkspaceRoot;
    }
  });

  it("streams a workspace file over HTTP form POST", async () => {
    const workspaceRootRaw = await fs.mkdtemp(
      path.join(os.tmpdir(), "openclaw-workspace-download-"),
    );
    const workspaceRoot = await fs.realpath(workspaceRootRaw);
    process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
    try {
      const fileName = "水北G207线单线图 (1).svg";
      const fileContent = "<svg>ok</svg>\n";
      await fs.writeFile(path.join(workspaceRoot, fileName), fileContent, "utf8");

      const body = new URLSearchParams({ path: fileName }).toString();
      const req = createRequest({
        method: "POST",
        url: WORKSPACE_DOWNLOAD_HTTP_PATH,
        body,
      });
      const { res, headers, readBody } = createResponse();

      const handled = await handleWorkspaceDownloadHttpRequest(req as never, res as never, {
        pathname: WORKSPACE_DOWNLOAD_HTTP_PATH,
        auth: { mode: "none" } as never,
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(typeof headers.get("Content-Type")).toBe("string");
      expect(headers.get("Content-Length")).toBe(String(Buffer.byteLength(fileContent)));
      expect(String(headers.get("Content-Disposition"))).toContain("attachment;");
      expect(String(headers.get("Content-Disposition"))).toContain("filename*=");
      expect(readBody()).toBe(fileContent);
    } finally {
      await fs.rm(workspaceRootRaw, { recursive: true, force: true });
    }
  });
});
