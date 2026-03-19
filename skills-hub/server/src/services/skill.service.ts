import fsp from "node:fs/promises";
import path from "node:path";
import { eq, and, sql, desc, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { skills, versions, reviews, users } from "../db/schema.js";
import { FILES_DIR, ADMIN_USERNAME } from "../config/env.js";
import { runValidationPipeline } from "../security/pipeline.js";
import type { PipelineResult } from "../security/pipeline.js";
import { safeJoin, sanitizeFileName, validExt } from "../utils/path.js";
import { normalizeSlug } from "../utils/slug.js";

// ---------------------------------------------------------------------------
// Upload from streamed temp file (multipart)
// ---------------------------------------------------------------------------

export interface UploadFromFileParams {
  version?: unknown;
  originalFileName?: unknown;
  tempFilePath: string;
  fileSize: number;
  fingerprint: string;
  mimeType?: string;
  uploadedBy?: number | null;
}

export async function uploadAndRegisterFromFile(p: UploadFromFileParams) {
  const version = String(p.version ?? "").trim();

  if (!version) {
    await fsp.unlink(p.tempFilePath).catch(() => {});
    throw new Error("version is required");
  }

  const mimeType = p.mimeType ?? "application/zip";

  let pipelineResult: PipelineResult;
  try {
    pipelineResult = await runValidationPipeline(p.tempFilePath, mimeType);
  } catch (err) {
    await fsp.unlink(p.tempFilePath).catch(() => {});
    throw err;
  }

  if (pipelineResult.extractDir) {
    await fsp.rm(pipelineResult.extractDir, { recursive: true, force: true }).catch(() => {});
  }

  const skillName = pipelineResult.skillName ?? "";
  const slug = normalizeSlug(skillName);
  const displayName = skillName || slug;

  if (pipelineResult.status === "rejected") {
    await fsp.unlink(p.tempFilePath).catch(() => {});
    return {
      slug: slug || null,
      version,
      file: null,
      fingerprint: p.fingerprint,
      size: p.fileSize,
      reviewStatus: "rejected" as const,
      skillName: pipelineResult.skillName,
      skillDescription: pipelineResult.skillDescription,
      checkResults: {
        allPassed: false,
        status: pipelineResult.status,
        stages: pipelineResult.stages,
        scanSummary: pipelineResult.scanSummary,
        networkObservations: pipelineResult.networkObservations,
        rejectionReason: pipelineResult.rejectionReason,
        reviewSummaryText: pipelineResult.reviewSummaryText,
        reviewReportMarkdown: pipelineResult.reviewReportMarkdown,
      },
    };
  }

  if (!slug) {
    await fsp.unlink(p.tempFilePath).catch(() => {});
    throw new Error("unable to derive slug: SKILL.md name field is missing or empty");
  }

  const reviewStatus = pipelineResult.status === "approved" ? "approved" : "pending";

  // Move temp file to permanent storage
  const safeName =
    sanitizeFileName(String(p.originalFileName ?? "").trim()) || `${slug}-${version}.zip`;
  const ext = validExt(path.extname(safeName).toLowerCase());
  const baseName = safeName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-");
  const storedName = `${slug}-${version}-${Date.now()}-${baseName}${ext}`;
  const safeStoredName = sanitizeFileName(storedName);
  const finalPath = safeJoin(FILES_DIR, safeStoredName);

  await fsp.mkdir(FILES_DIR, { recursive: true });

  try {
    await fsp.rename(p.tempFilePath, finalPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fsp.copyFile(p.tempFilePath, finalPath);
      await fsp.unlink(p.tempFilePath).catch(() => {});
    } else {
      await fsp.unlink(p.tempFilePath).catch(() => {});
      throw err;
    }
  }

  // Persist to database via Drizzle
  const now = Date.now();

  const existingSkill = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, slug))
    .limit(1);

  let skillId: number;
  if (existingSkill.length === 0) {
    const inserted = await db
      .insert(skills)
      .values({
        slug,
        displayName: pipelineResult.skillName ?? displayName,
        summary: pipelineResult.skillDescription ?? "",
        tags: JSON.stringify([]),
        ownerId: p.uploadedBy ?? null,
        visibility: "public",
        downloads: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: skills.id });
    skillId = inserted[0].id;
  } else {
    skillId = existingSkill[0].id;
    await db
      .update(skills)
      .set({
        displayName: pipelineResult.skillName ?? displayName,
        summary: pipelineResult.skillDescription ?? undefined,
        updatedAt: now,
      })
      .where(eq(skills.id, skillId));
  }

  // Check existing version
  const existingVersion = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.skillId, skillId), eq(versions.version, version)))
    .limit(1);

  if (existingVersion.length > 0) {
    throw new Error(`version already exists: ${slug}@${version}`);
  }

  const insertedVersion = await db
    .insert(versions)
    .values({
      skillId,
      version,
      changelog: "",
      file: safeStoredName,
      fingerprint: p.fingerprint,
      size: p.fileSize,
      downloads: 0,
      reviewStatus,
      uploadedBy: p.uploadedBy ?? null,
      createdAt: now,
    })
    .returning({ id: versions.id });

  const versionId = insertedVersion[0]?.id;

  // Record auto-review
  if (versionId) {
    let reviewerId: number | null = p.uploadedBy ?? null;
    if (!reviewerId) {
      const adminUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, ADMIN_USERNAME))
        .limit(1);
      reviewerId = adminUser[0]?.id ?? null;
    }
    if (reviewerId) {
      const reasonText = reviewStatus === "approved"
        ? "Auto-approved: all security checks passed."
        : reviewStatus === "pending"
          ? "Pending human review: warnings detected."
          : `Auto-rejected: ${pipelineResult.rejectionReason ?? "security checks failed."}`;

      await db.insert(reviews).values({
        versionId,
        reviewerId,
        action: "check",
        reason: reasonText,
        checkResults: JSON.stringify({
          status: pipelineResult.status,
          stages: pipelineResult.stages,
          scanSummary: pipelineResult.scanSummary,
          networkObservations: pipelineResult.networkObservations,
          reviewSummaryText: pipelineResult.reviewSummaryText,
          reviewReportMarkdown: pipelineResult.reviewReportMarkdown,
        }),
        createdAt: now,
      });
    }
  }

  return {
    slug,
    version,
    file: safeStoredName,
    fingerprint: p.fingerprint,
    size: p.fileSize,
    reviewStatus,
    skillName: pipelineResult.skillName,
    skillDescription: pipelineResult.skillDescription,
    checkResults: {
      allPassed: pipelineResult.status === "approved",
      status: pipelineResult.status,
      stages: pipelineResult.stages,
      scanSummary: pipelineResult.scanSummary,
      networkObservations: pipelineResult.networkObservations,
      rejectionReason: pipelineResult.rejectionReason,
      reviewSummaryText: pipelineResult.reviewSummaryText,
      reviewReportMarkdown: pipelineResult.reviewReportMarkdown,
    },
  };
}

// ---------------------------------------------------------------------------
// Download counter
// ---------------------------------------------------------------------------

export async function incrementDownload(slug: string, version: string): Promise<void> {
  const skill = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, slug))
    .limit(1);

  if (skill.length === 0) return;
  const skillId = skill[0].id;

  await db
    .update(skills)
    .set({ downloads: sql`${skills.downloads} + 1` })
    .where(eq(skills.id, skillId));

  const ver = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.skillId, skillId), eq(versions.version, version)))
    .limit(1);

  if (ver.length > 0) {
    await db
      .update(versions)
      .set({ downloads: sql`${versions.downloads} + 1` })
      .where(eq(versions.id, ver[0].id));
  }
}

// ---------------------------------------------------------------------------
// Query helpers used by routes
// ---------------------------------------------------------------------------

export async function findSkillBySlug(slug: string) {
  const result = await db.select().from(skills).where(eq(skills.slug, slug)).limit(1);
  return result[0] ?? null;
}

export async function listAllSkills(opts: {
  sort?: string;
  visibility?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const { sort = "updated", visibility, limit = 100, offset = 0 } = opts;

  let query = db.select().from(skills).$dynamic();

  if (visibility) {
    query = query.where(eq(skills.visibility, visibility));
  }

  if (sort === "downloads") {
    query = query.orderBy(desc(skills.downloads));
  } else if (sort === "name") {
    query = query.orderBy(skills.displayName);
  } else {
    query = query.orderBy(desc(skills.updatedAt));
  }

  return query.limit(limit).offset(offset);
}

export async function countAllSkills(opts: { q?: string; visibility?: string } = {}) {
  const { q, visibility } = opts;
  const like = q ? `%${q}%` : null;

  const whereClause = and(
    visibility ? eq(skills.visibility, visibility) : undefined,
    like
      ? or(ilike(skills.slug, like), ilike(skills.displayName, like), ilike(skills.summary, like))
      : undefined,
  );

  const result = whereClause
    ? await db.select({ count: sql<number>`count(*)` }).from(skills).where(whereClause)
    : await db.select({ count: sql<number>`count(*)` }).from(skills);

  return Number(result[0]?.count ?? 0);
}

export async function searchSkillsByQuery(
  searchQuery: string,
  visibility?: string,
  opts: { sort?: string; limit?: number; offset?: number } = {},
) {
  const { sort = "updated", limit = 100, offset = 0 } = opts;
  const q = `%${searchQuery}%`;

  const whereClause = visibility
    ? and(
        eq(skills.visibility, visibility),
        or(ilike(skills.slug, q), ilike(skills.displayName, q), ilike(skills.summary, q)),
      )
    : or(ilike(skills.slug, q), ilike(skills.displayName, q), ilike(skills.summary, q));

  let query = db.select().from(skills).where(whereClause).$dynamic();

  if (sort === "downloads") {
    query = query.orderBy(desc(skills.downloads));
  } else if (sort === "name") {
    query = query.orderBy(skills.displayName);
  } else {
    query = query.orderBy(desc(skills.updatedAt));
  }

  return query.limit(limit).offset(offset);
}

export async function listVersionsBySkillId(skillId: number) {
  return db
    .select()
    .from(versions)
    .where(eq(versions.skillId, skillId))
    .orderBy(desc(versions.createdAt));
}

export async function getLatestApprovedVersion(skillId: number) {
  const result = await db
    .select()
    .from(versions)
    .where(and(eq(versions.skillId, skillId), eq(versions.reviewStatus, "approved")))
    .orderBy(desc(versions.createdAt))
    .limit(1);
  return result[0] ?? null;
}

export async function findVersionBySkillAndVersion(skillId: number, ver: string) {
  const result = await db
    .select()
    .from(versions)
    .where(and(eq(versions.skillId, skillId), eq(versions.version, ver)))
    .limit(1);
  return result[0] ?? null;
}

export async function deleteSkillById(id: number) {
  await db.delete(skills).where(eq(skills.id, id));
}

export async function deleteVersionById(id: number) {
  await db.delete(versions).where(eq(versions.id, id));
}

export async function updateSkillTimestamp(id: number) {
  await db.update(skills).set({ updatedAt: Date.now() }).where(eq(skills.id, id));
}
