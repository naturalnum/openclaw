import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { FILES_DIR, TEMP_DIR, MAX_UPLOAD_BYTES, PUBLIC_BASE_URL } from "../config/env.js";
import { requireAuth } from "../middleware/admin.js";
import type { AuthUser } from "../middleware/auth.js";
import {
  findSkillBySlug,
  listAllSkills,
  searchSkillsByQuery,
  listVersionsBySkillId,
  getLatestApprovedVersion,
  findVersionBySkillAndVersion,
  incrementDownload,
  deleteVersionById,
  deleteSkillById,
  updateSkillTimestamp,
  uploadAndRegisterFromFile,
  countAllSkills,
} from "../services/skill.service.js";
import { parseMultipartUpload } from "../utils/multipart.js";
import { safeJoin } from "../utils/path.js";
import { semverCompareDesc } from "../utils/semver.js";
import { clampInt, normalizeSlug, scoreHit } from "../utils/slug.js";
import { safeParseTags } from "../utils/tags.js";

type Env = { Variables: { user: AuthUser | null } };

const skillRoutes = new Hono<Env>();

// GET /api/v1/search
skillRoutes.get("/api/v1/search", async (c) => {
  const q = String(c.req.query("q") ?? "")
    .trim()
    .toLowerCase();

  const allSkills = q
    ? await searchSkillsByQuery(q, "public")
    : await listAllSkills({ sort: "updated", visibility: "public" });

  const results = [];
  for (const skill of allSkills) {
    if (skill.visibility !== "public") continue;
    const latestVer = await getLatestApprovedVersion(skill.id);
    if (!latestVer) continue;
    results.push({
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary ?? null,
      version: latestVer.version,
      score: q
        ? scoreHit(
            { slug: skill.slug, displayName: skill.displayName, summary: skill.summary ?? "" },
            q,
          )
        : 1,
      updatedAt: skill.updatedAt,
    });
  }

  return c.json({ results });
});

// GET /api/v1/skills — 物理分页，支持 page/pageSize/sort/q
skillRoutes.get("/api/v1/skills", async (c) => {
  const page = Math.max(1, clampInt(c.req.query("page"), 1, 9999, 1));
  const pageSize = Math.min(100, Math.max(1, clampInt(c.req.query("pageSize"), 1, 100, 20)));
  const sort = String(c.req.query("sort") ?? "updated");
  const q = String(c.req.query("q") ?? "").trim();
  const offset = (page - 1) * pageSize;

  const [total, allSkills] = await Promise.all([
    countAllSkills({ q }),
    q
      ? searchSkillsByQuery(q, undefined, { sort, limit: pageSize, offset })
      : listAllSkills({ sort, limit: pageSize, offset }),
  ]);

  const items = [];
  for (const skill of allSkills) {
    const allVersions = await listVersionsBySkillId(skill.id);
    const tags = safeParseTags(skill.tags);
    const sorted = [...allVersions].sort((a, b) => semverCompareDesc(a.version, b.version));
    const lv = sorted[0] ?? null;
    items.push({
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary ?? null,
      tags,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      stats: { downloads: skill.downloads ?? 0 },
      latestVersion: lv
        ? {
            version: lv.version,
            createdAt: lv.createdAt,
            changelog: lv.changelog ?? "",
            file: lv.file,
            fingerprint: lv.fingerprint ?? null,
            size: lv.size ?? 0,
            downloads: Number(lv.downloads ?? 0),
            reviewStatus: lv.reviewStatus,
            downloadUrl: `/api/v1/download?slug=${encodeURIComponent(skill.slug)}&version=${encodeURIComponent(lv.version)}`,
          }
        : null,
    });
  }

  return c.json({
    ok: true,
    total,
    page,
    pageSize,
    items,
    baseUrl: PUBLIC_BASE_URL,
  });
});

// GET /api/v1/skills/:slug
skillRoutes.get("/api/v1/skills/:slug", async (c) => {
  const slug = c.req.param("slug");
  const skill = await findSkillBySlug(slug);

  if (!skill) return c.json({ skill: null, latestVersion: null, owner: null });

  const latestVer = await getLatestApprovedVersion(skill.id);
  if (!latestVer) return c.json({ skill: null, latestVersion: null, owner: null });

  return c.json({
    skill: {
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary ?? null,
      tags: safeParseTags(skill.tags),
      stats: { downloads: skill.downloads ?? 0 },
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    },
    latestVersion: {
      version: latestVer.version,
      createdAt: latestVer.createdAt,
      changelog: latestVer.changelog ?? "",
    },
    owner: null,
  });
});

// GET /api/v1/skills/:slug/versions
skillRoutes.get("/api/v1/skills/:slug/versions", async (c) => {
  const slug = c.req.param("slug");
  const skill = await findSkillBySlug(slug);

  if (!skill) return c.json({ items: [], nextCursor: null });

  const allVersions = await listVersionsBySkillId(skill.id);
  const approved = allVersions
    .filter((v) => v.reviewStatus === "approved")
    .sort((a, b) => semverCompareDesc(a.version, b.version));

  const items = approved.map((v) => ({
    version: v.version,
    createdAt: v.createdAt,
    changelog: v.changelog ?? "",
    changelogSource: "user",
  }));

  return c.json({ items, nextCursor: null });
});

// GET /api/v1/skills/:slug/versions/:version
skillRoutes.get("/api/v1/skills/:slug/versions/:version", async (c) => {
  const slug = c.req.param("slug");
  const targetVersion = c.req.param("version");
  const skill = await findSkillBySlug(slug);

  if (!skill) return c.json({ version: null, skill: null });

  const hit = await findVersionBySkillAndVersion(skill.id, targetVersion);
  if (!hit || hit.reviewStatus !== "approved") {
    return c.json({ version: null, skill: null });
  }

  const downloadUrl = `/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(hit.version)}`;

  return c.json({
    version: {
      version: hit.version,
      createdAt: hit.createdAt,
      changelog: hit.changelog ?? "",
      changelogSource: "user",
      downloadUrl,
      files: [{ path: hit.file, size: hit.size ?? 0 }],
    },
    skill: {
      slug: skill.slug,
      displayName: skill.displayName,
    },
  });
});

// GET /api/v1/resolve
skillRoutes.get("/api/v1/resolve", async (c) => {
  const slug = String(c.req.query("slug") ?? "");
  const hash = String(c.req.query("hash") ?? "");
  if (!slug) return c.json({ error: "slug is required" }, 400);

  const skill = await findSkillBySlug(slug);
  if (!skill) return c.json({ error: `Skill not found: ${slug}` }, 404);

  const allVersions = await listVersionsBySkillId(skill.id);
  const approved = allVersions.filter((v) => v.reviewStatus === "approved");
  const latest = approved.sort((a, b) => semverCompareDesc(a.version, b.version))[0] ?? null;
  const match = approved.find((v) => v.fingerprint && v.fingerprint === hash) ?? null;

  return c.json({
    match: match ? { version: match.version } : null,
    latestVersion: latest ? { version: latest.version } : null,
  });
});

// GET /api/v1/download
skillRoutes.get("/api/v1/download", async (c) => {
  const slug = String(c.req.query("slug") ?? "");
  const version = String(c.req.query("version") ?? "");
  if (!slug) return c.json({ error: "slug is required" }, 400);

  const skill = await findSkillBySlug(slug);
  if (!skill) return c.json({ error: `Skill not found: ${slug}` }, 404);

  const allVersions = await listVersionsBySkillId(skill.id);
  const approved = allVersions
    .filter((v) => v.reviewStatus === "approved")
    .sort((a, b) => semverCompareDesc(a.version, b.version));

  let chosen;
  if (version) {
    chosen = approved.find((v) => v.version === version) ?? null;
  } else {
    chosen = approved.length > 0 ? approved[0] : null;
  }

  if (!chosen) return c.json({ error: `Version not found: ${slug}@${version || "latest"}` }, 404);

  const filePath = safeJoin(FILES_DIR, chosen.file);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: `Artifact missing for ${slug}@${chosen.version}: ${chosen.file}` }, 404);
  }

  await incrementDownload(slug, chosen.version);

  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", `attachment; filename="${path.basename(chosen.file)}"`);

  return stream(c, async (s) => {
    const readable = fs.createReadStream(filePath);
    for await (const chunk of readable) {
      await s.write(chunk as Uint8Array);
    }
  });
});

// POST /api/v1/skills/upload — upload skill package (requires auth)
skillRoutes.post("/api/v1/skills/upload", async (c) => {
  const user = c.get("user");
  requireAuth(user);

  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "invalid content type 必须是 multipart/form-data" }, 400);
  }

  if (!c.req.raw.body) {
    return c.json({ error: "empty request body" }, 400);
  }

  const { fields, tempFilePath, fileSize, fingerprint, originalFileName, mimeType } =
    await parseMultipartUpload(c.req.raw, { tempDir: TEMP_DIR, maxFileBytes: MAX_UPLOAD_BYTES });

  const result = await uploadAndRegisterFromFile({
    version: fields.version,
    originalFileName,
    tempFilePath,
    fileSize,
    fingerprint,
    mimeType,
    uploadedBy: user.id,
  });

  if (result.reviewStatus === "rejected") {
    return c.json(
      {
        ok: false,
        error: "安全检查未通过",
        slug: result.slug,
        version: result.version,
        reviewStatus: result.reviewStatus,
        checkResults: result.checkResults,
      },
      422,
    );
  }

  return c.json({
    ok: true,
    slug: result.slug,
    version: result.version,
    file: result.file,
    fingerprint: result.fingerprint,
    size: result.size,
    reviewStatus: result.reviewStatus,
    skillName: result.skillName,
    skillDescription: result.skillDescription,
    checkResults: result.checkResults,
  });
});

// DELETE /api/v1/skills/:slug/versions/:version — delete a specific version (requires auth)
skillRoutes.delete("/api/v1/skills/:slug/versions/:version", async (c) => {
  const user = c.get("user");
  requireAuth(user);

  const slug = normalizeSlug(c.req.param("slug") ?? "");
  const version = c.req.param("version") ?? "";
  if (!slug || !version) return c.json({ error: "slug/version are required" }, 400);

  const skill = await findSkillBySlug(slug);
  if (!skill) return c.json({ error: `skill not found: ${slug}` }, 404);

  const allVersions = await listVersionsBySkillId(skill.id);
  const target = allVersions.find((v) => v.version === version);
  if (!target) return c.json({ error: `version not found: ${slug}@${version}` }, 404);

  await deleteVersionById(target.id);

  // Clean up artifact file
  if (target.file) {
    try {
      const artifactPath = path.join(FILES_DIR, target.file);
      const normalizedBase = path.resolve(FILES_DIR);
      const normalizedTarget = path.resolve(artifactPath);
      if (
        normalizedTarget.startsWith(`${normalizedBase}${path.sep}`) ||
        normalizedTarget === normalizedBase
      ) {
        await fsp.unlink(normalizedTarget).catch(() => {});
      }
    } catch {
      // File deletion failure does not affect version deletion
    }
  }

  const remaining = allVersions.filter((v) => v.version !== version);
  if (remaining.length === 0) {
    await deleteSkillById(skill.id);
  } else {
    await updateSkillTimestamp(skill.id);
  }

  return c.json({ ok: true, slug, version });
});

export default skillRoutes;
