/**
 * skills-hub-download-http.ts
 *
 * HTTP stage handler for proxying skill archive downloads from the remote
 * skills-hub repository to the browser client.
 *
 * Route: GET /api/skills-hub/download?slug=<slug>
 *
 * The gateway fetches the archive from the configured hub baseUrl and streams
 * it directly to the response, so the browser can save the .tar.gz file to
 * disk without being subject to CORS restrictions.
 *
 * Auth: requires a valid gateway bearer token (same as other protected endpoints).
 */

import { log } from "node:console";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { loadConfig } from "../config/config.js";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";

const DOWNLOAD_PATH = "/api/skills-hub/download";
const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

function resolveHubBaseUrl(cfg: ReturnType<typeof loadConfig>): string | undefined {
  const envUrl = process.env.CLAWHUB_REGISTRY?.trim();
  if (envUrl) {
    return envUrl;
  }
  return cfg.skills?.hub?.registry?.trim() || undefined;
}

export async function handleSkillsHubDownloadRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== DOWNLOAD_PATH) {
    return false;
  }

  // Only GET is supported
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  // Validate slug param
  const slug = url.searchParams.get("slug")?.trim() ?? "";
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "invalid or missing slug parameter" }));
    return true;
  }

  const cfg = loadConfig();
  const baseUrl = resolveHubBaseUrl(cfg);
  if (!baseUrl) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "skills-hub base URL is not configured" }));
    return true;
  }

  const timeoutMs = cfg.skills?.hub?.timeoutMs ?? 60_000;

  // If the client already knows the downloadUrl (passed as query param), skip the catalog lookup.
  const queryDownloadUrl = url.searchParams.get("downloadUrl")?.trim() ?? "";

  // Fetch archive list to resolve the download URL for the given slug
  const catalogUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1/skills/${encodeURIComponent(slug)}`;

  // Allow the operator-configured hub hostname (including localhost for local dev).
  let hubHostname: string | undefined;
  try {
    hubHostname = new URL(baseUrl).hostname;
  } catch {
    // ignore malformed baseUrl
  }
  const hubPolicy = hubHostname ? { allowedHostnames: [hubHostname] } : undefined;

  // If downloadUrl query param is provided, skip catalog lookup and download directly.
  if (queryDownloadUrl) {
    const fullUrl = queryDownloadUrl.startsWith("http")
      ? queryDownloadUrl
      : `${baseUrl.replace(/\/+$/, "")}/${queryDownloadUrl.replace(/^\/+/, "")}`;

    let release: (() => Promise<void>) | undefined;
    try {
      const downloadResult = await fetchWithSsrFGuard({
        url: fullUrl,
        mode: "trusted_env_proxy",
        timeoutMs,
        auditContext: "skills-hub-download-stream",
        policy: hubPolicy,
      });
      release = downloadResult.release;
      if (!downloadResult.response.ok) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            error: `download failed: ${downloadResult.response.status}`,
          }),
        );
        return true;
      }

      // Derive filename: prefer upstream Content-Disposition > infer from URL > fallback slug.tar.gz
      const upstreamCd = downloadResult.response.headers.get("content-disposition") ?? "";
      const cdFilenameMatch = /filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i.exec(upstreamCd);
      const upstreamFilename = cdFilenameMatch?.[1]?.trim();
      let inferredExt = ".tar.gz";
      const urlBasename = queryDownloadUrl.split("?")[0]?.split("/").pop() ?? "";
      if (urlBasename.toLowerCase().endsWith(".zip")) {
        inferredExt = ".zip";
      } else if (urlBasename.toLowerCase().endsWith(".tar.bz2")) {
        inferredExt = ".tar.bz2";
      } else if (urlBasename.toLowerCase().endsWith(".tar")) {
        inferredExt = ".tar";
      }
      const filename = upstreamFilename || urlBasename || `${slug}${inferredExt}`;
      res.statusCode = 200;
      res.setHeader(
        "Content-Type",
        downloadResult.response.headers.get("content-type") || "application/gzip",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      const body = downloadResult.response.body as unknown;
      if (!body) {
        res.statusCode = 502;
        res.end("empty response body");
        return true;
      }
      const readable =
        typeof (body as NodeJS.ReadableStream).pipe === "function"
          ? (body as NodeJS.ReadableStream as InstanceType<typeof Readable>)
          : Readable.fromWeb(body as NodeReadableStream);
      await new Promise<void>((resolve, reject) => {
        readable.pipe(res);
        readable.on("error", reject);
        res.on("error", reject);
        res.on("finish", resolve);
      });
      return true;
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : "internal error",
          }),
        );
      }
      return true;
    } finally {
      await release?.();
    }
  }

  let release: (() => Promise<void>) | undefined;
  try {
    // Step 1: resolve the downloadUrl from the catalog entry
    const catalogResult = await fetchWithSsrFGuard({
      url: catalogUrl,
      mode: "trusted_env_proxy",
      timeoutMs,
      auditContext: "skills-hub-download-resolve",
      policy: hubPolicy,
    });
    release = catalogResult.release;

    if (!catalogResult.response.ok) {
      res.statusCode = catalogResult.response.status === 404 ? 404 : 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: `skill not found in repository: ${slug}`,
        }),
      );
      return true;
    }

    const entry = (await catalogResult.response.json()) as {
      latestVersion?: { downloadUrl?: string; version?: string } | null;
    };
    await release();
    release = undefined;

    const relativeUrl = entry?.latestVersion?.downloadUrl?.trim();
    const version = entry?.latestVersion?.version?.trim() ?? "";
    if (!relativeUrl) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "no downloadable version available" }));
      return true;
    }

    const fullUrl = relativeUrl.startsWith("http")
      ? relativeUrl
      : `${baseUrl.replace(/\/+$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    // Step 2: stream the archive to the client
    const downloadResult = await fetchWithSsrFGuard({
      url: fullUrl,
      mode: "trusted_env_proxy",
      timeoutMs,
      auditContext: "skills-hub-download-stream",
      policy: hubPolicy,
    });
    release = downloadResult.release;

    if (!downloadResult.response.ok) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: `download failed: ${downloadResult.response.status}`,
        }),
      );
      return true;
    }

    const filename = `${slug}${version ? `-${version}` : ""}.tar.gz`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    const body = downloadResult.response.body as unknown;
    if (!body) {
      res.statusCode = 502;
      res.end("empty response body");
      return true;
    }

    // Pipe stream to response
    const readable =
      typeof (body as NodeJS.ReadableStream).pipe === "function"
        ? (body as NodeJS.ReadableStream as InstanceType<typeof Readable>)
        : Readable.fromWeb(body as NodeReadableStream);

    await new Promise<void>((resolve, reject) => {
      readable.pipe(res);
      readable.on("error", reject);
      res.on("error", reject);
      res.on("finish", resolve);
    });

    return true;
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : "internal error",
        }),
      );
    }
    return true;
  } finally {
    await release?.();
  }
}
