#!/usr/bin/env node

import { createServer } from "node:http";

const port = parsePositiveInteger(process.env.SKILLS_MOCK_PORT, 3100);
const skillCenterBaseUrl = normalizeBaseUrl(
  process.env.SKILLCENTER_BASE_URL ?? "http://127.0.0.1:3000",
);
const skillCenterCatalogPath =
  process.env.SKILLCENTER_CATALOG_PATH?.trim() || "/api/open/v1/skillsList";
const installCounts = new Map();

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SKILLCENTER_BASE_URL must use http or https");
  }
  return url.toString().replace(/\/+$/, "");
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function proxyCatalog(request, response) {
  const incoming = new URL(request.url ?? "/api/open/v1/skillsList", "http://127.0.0.1");
  const upstreamUrl = new URL(skillCenterCatalogPath, `${skillCenterBaseUrl}/`);
  upstreamUrl.search = incoming.search;
  const upstreamResponse = await fetch(upstreamUrl, {
    headers: { accept: "application/json" },
  });
  if (!upstreamResponse.ok) {
    const message = (await upstreamResponse.text()).trim();
    sendJson(response, 502, {
      error: message || `SkillCenter returned ${upstreamResponse.status}`,
    });
    return;
  }
  const payload = await upstreamResponse.json();
  const skills = Array.isArray(payload.skills)
    ? payload.skills.map((skill) => {
        const slug = typeof skill?.slug === "string" ? skill.slug.trim() : "";
        const upstreamInstalls = Number.isFinite(skill?.installs) ? skill.installs : 0;
        if (slug && !installCounts.has(slug)) {
          installCounts.set(slug, upstreamInstalls);
        }
        return {
          ...skill,
          installs: slug ? (installCounts.get(slug) ?? upstreamInstalls) : upstreamInstalls,
        };
      })
    : [];
  sendJson(response, 200, { ...payload, skills });
}

function validateDownloadRequest(body) {
  if (typeof body.skillId !== "string" || !body.skillId.trim()) {
    throw new Error("skillId is required");
  }
  return body.skillId.trim();
}

async function mockDecryptDownload(request, response) {
  const body = await readJsonBody(request);
  const skillId = validateDownloadRequest(body);
  const upstreamUrl = new URL("/api/v1/download", `${skillCenterBaseUrl}/`);
  upstreamUrl.searchParams.set("slug", skillId);
  const upstreamResponse = await fetch(upstreamUrl, {
    headers: { accept: "application/octet-stream" },
  });
  if (!upstreamResponse.ok) {
    const message = (await upstreamResponse.text()).trim();
    sendJson(response, upstreamResponse.status, {
      error: message || `SkillCenter download returned ${upstreamResponse.status}`,
    });
    return;
  }
  const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(200, {
    "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition":
      upstreamResponse.headers.get("content-disposition") ??
      `attachment; filename="${skillId.replace(/["\\]/g, "-")}-latest.zip"`,
    "content-length": bytes.length,
    "x-skill-decryption": "mock-passthrough",
  });
  response.end(bytes);
}

async function mockInstallEvent(request, response, slug) {
  const body = await readJsonBody(request);
  if (body.action !== "install" && body.action !== "uninstall") {
    sendJson(response, 400, { error: "action must be install or uninstall" });
    return;
  }
  const current = installCounts.get(slug) ?? 0;
  const installs = body.action === "install" ? current + 1 : Math.max(0, current - 1);
  installCounts.set(slug, installs);
  sendJson(response, 200, {
    ok: true,
    slug,
    action: body.action,
    installs,
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, skillCenterBaseUrl });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/open/v1/skillsList") {
      await proxyCatalog(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/v1/download") {
      await mockDecryptDownload(request, response);
      return;
    }
    const installEventMatch = url.pathname.match(/^\/api\/v1\/skills\/([^/]+)\/install-event$/);
    if (request.method === "POST" && installEventMatch?.[1]) {
      await mockInstallEvent(request, response, decodeURIComponent(installEventMatch[1]));
      return;
    }
    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[skills-mock] listening on http://127.0.0.1:${port}`);
  console.log(`[skills-mock] catalog upstream: ${skillCenterBaseUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
