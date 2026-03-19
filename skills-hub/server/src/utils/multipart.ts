import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";

export interface MultipartResult {
  fields: Record<string, string>;
  tempFilePath: string;
  fileSize: number;
  fingerprint: string;
  originalFileName: string;
  mimeType: string;
}

/**
 * Extract plain headers object from a Web API Request or plain object.
 */
function extractHeaders(req: Request | Record<string, unknown>): Record<string, string> {
  if (req instanceof Request) {
    const out: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  return (req as { headers: Record<string, string> }).headers;
}

/**
 * Get a Node.js Readable from a Web API Request or a Node-style object.
 */
function toNodeStream(req: Request | Record<string, unknown>): Readable {
  if (req instanceof Request) {
    if (!req.body) throw new Error("empty request body");
    return Readable.fromWeb(req.body as import("node:stream/web").ReadableStream);
  }
  // Already a Node.js stream-like object
  return req as unknown as Readable;
}

/**
 * Parse a multipart/form-data upload request.
 * Accepts a Web API Request (Hono) or a Node.js IncomingMessage.
 * Streams the file directly to a temp file on disk while computing SHA256.
 */
export function parseMultipartUpload(
  req: Request | Record<string, unknown>,
  opts: { tempDir: string; maxFileBytes: number },
): Promise<MultipartResult> {
  const { tempDir, maxFileBytes } = opts;
  return new Promise((resolve, reject) => {
    let finished = false;
    let tempFilePath: string | null = null;
    let writeStream: fs.WriteStream | null = null;

    function cleanup(): void {
      if (tempFilePath) {
        fsp.unlink(tempFilePath).catch(() => {});
        tempFilePath = null;
      }
    }

    function fail(err: Error): void {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    }

    const fields: Record<string, string> = {};
    let fileReceived = false;
    let fileSize = 0;
    let fingerprint = "";
    let originalFileName = "";
    let fileMimeType = "application/octet-stream";

    let headers: Record<string, string>;
    try {
      headers = extractHeaders(req);
    } catch {
      return reject(new Error("cannot extract headers from request"));
    }

    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers,
        limits: {
          files: 1,
          fileSize: maxFileBytes,
          fieldSize: 1024 * 64,
        },
      });
    } catch (err) {
      return reject(new Error(`invalid multipart request: ${(err as Error).message}`));
    }

    busboy.on("field", (name: string, value: string) => {
      fields[name] = value;
    });

    busboy.on(
      "file",
      (
        _name: string,
        stream: NodeJS.ReadableStream,
        info: { filename?: string; mimeType?: string },
      ) => {
        if (fileReceived) {
          (stream as NodeJS.ReadableStream & { resume(): void }).resume();
          return;
        }
        fileReceived = true;
        originalFileName = info.filename ?? "";
        fileMimeType = info.mimeType ?? "application/octet-stream";

        const tmpName = `.tmp-upload-${crypto.randomBytes(8).toString("hex")}`;
        tempFilePath = path.join(tempDir, tmpName);
        writeStream = fs.createWriteStream(tempFilePath);
        const hash = crypto.createHash("sha256");

        stream.on("data", (chunk: Buffer) => {
          fileSize += chunk.length;
          hash.update(chunk);
        });

        stream.on("end", () => {
          fingerprint = hash.digest("hex");
        });

        (
          stream as NodeJS.ReadableStream & { on(event: "limit", cb: () => void): void }
        ).on("limit", () => {
          (stream as NodeJS.ReadableStream & { destroy(): void }).destroy();
          writeStream?.destroy();
          fail(new Error(`upload too large: exceeds ${maxFileBytes} bytes limit`));
        });

        stream.on("error", (err: Error) => fail(err));
        writeStream.on("error", (err: Error) => fail(err));

        (stream as NodeJS.ReadableStream & { pipe(dest: fs.WriteStream): void }).pipe(
          writeStream,
        );
      },
    );

    busboy.on("close", () => {
      if (finished) return;

      if (!fileReceived || !tempFilePath) {
        finished = true;
        cleanup();
        return reject(new Error("no file field in multipart request"));
      }

      const done = (): void => {
        if (finished) return;
        finished = true;
        resolve({
          fields,
          tempFilePath: tempFilePath!,
          fileSize,
          fingerprint,
          originalFileName,
          mimeType: fileMimeType,
        });
      };

      if (writeStream && !writeStream.writableFinished) {
        writeStream.on("close", done);
      } else {
        done();
      }
    });

    busboy.on("error", (err: Error) => fail(err));

    let nodeStream: Readable;
    try {
      nodeStream = toNodeStream(req);
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)));
    }

    nodeStream.on("error", (err: Error) => fail(err));
    nodeStream.pipe(busboy);
  });
}
