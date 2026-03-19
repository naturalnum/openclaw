import fs from "node:fs";
import fsp from "node:fs/promises";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { versions, reviews, skills, users } from "../db/schema.js";
import { FILES_DIR } from "../config/env.js";
import { runValidationPipeline } from "../security/pipeline.js";
import type { PipelineResult } from "../security/pipeline.js";
import { safeJoin } from "../utils/path.js";

// ---------------------------------------------------------------------------
// Trigger a security check without changing version status
// ---------------------------------------------------------------------------

export async function triggerSecurityCheck(versionId: number): Promise<PipelineResult> {
  const versionResult = await db
    .select()
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  const version = versionResult[0];
  if (!version) throw new Error(`版本不存在: ${versionId}`);

  const skillResult = await db
    .select()
    .from(skills)
    .where(eq(skills.id, version.skillId))
    .limit(1);
  if (skillResult.length === 0) throw new Error(`技能不存在: ${version.skillId}`);

  const filePath = safeJoin(FILES_DIR, version.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`技能包文件不存在: ${version.file}`);
  }

  const result = await runValidationPipeline(filePath, "application/zip");

  if (result.extractDir) {
    await fsp.rm(result.extractDir, { recursive: true, force: true }).catch(() => {});
  }

  return result;
}

// ---------------------------------------------------------------------------
// Approve a version
// ---------------------------------------------------------------------------

export async function approveVersion(
  versionId: number,
  reviewerId: number,
  reason = "",
): Promise<{ versionId: number; status: string; checkResult: PipelineResult }> {
  const versionResult = await db
    .select()
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  const version = versionResult[0];
  if (!version) throw new Error(`版本不存在: ${versionId}`);
  if (version.reviewStatus === "approved") throw new Error("该版本已审核通过");

  const checkResult = await triggerSecurityCheck(versionId);

  const now = Date.now();
  await db.insert(reviews).values({
    versionId,
    reviewerId,
    action: "approve",
    reason,
    checkResults: JSON.stringify(checkResult),
    createdAt: now,
  });

  await db
    .update(versions)
    .set({ reviewStatus: "approved" })
    .where(eq(versions.id, versionId));

  return { versionId, status: "approved", checkResult };
}

// ---------------------------------------------------------------------------
// Reject a version
// ---------------------------------------------------------------------------

export async function rejectVersion(
  versionId: number,
  reviewerId: number,
  reason: string,
): Promise<{ versionId: number; status: string; reason: string; checkResult: PipelineResult | null }> {
  if (!reason?.trim()) throw new Error("拒绝必须填写原因");

  const versionResult = await db
    .select()
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  if (versionResult.length === 0) throw new Error(`版本不存在: ${versionId}`);

  let checkResult: PipelineResult | null = null;
  try {
    checkResult = await triggerSecurityCheck(versionId);
  } catch {
    // Security check failure does not block reject
  }

  const now = Date.now();
  await db.insert(reviews).values({
    versionId,
    reviewerId,
    action: "reject",
    reason: reason.trim(),
    checkResults: JSON.stringify(checkResult),
    createdAt: now,
  });

  await db
    .update(versions)
    .set({ reviewStatus: "rejected" })
    .where(eq(versions.id, versionId));

  return { versionId, status: "rejected", reason: reason.trim(), checkResult };
}

// ---------------------------------------------------------------------------
// Review detail queries
// ---------------------------------------------------------------------------

export async function listPendingVersions() {
  return db
    .select({
      id: versions.id,
      skillId: versions.skillId,
      slug: skills.slug,
      displayName: skills.displayName,
      version: versions.version,
      changelog: versions.changelog,
      file: versions.file,
      fingerprint: versions.fingerprint,
      size: versions.size,
      reviewStatus: versions.reviewStatus,
      uploadedBy: versions.uploadedBy,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .innerJoin(skills, eq(versions.skillId, skills.id))
    .where(eq(versions.reviewStatus, "pending"))
    .orderBy(versions.createdAt);
}

export async function listReviewsByVersionId(versionId: number) {
  return db
    .select({
      id: reviews.id,
      action: reviews.action,
      reason: reviews.reason,
      reviewerName: users.username,
      checkResults: reviews.checkResults,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.reviewerId, users.id))
    .where(eq(reviews.versionId, versionId))
    .orderBy(desc(reviews.createdAt));
}
