import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { db } from "../db/index.js";
import { versions, skills } from "../db/schema.js";
import {
  triggerSecurityCheck,
  approveVersion,
  rejectVersion,
  listPendingVersions,
  listReviewsByVersionId,
} from "../services/review.service.js";

type Env = { Variables: { user: AuthUser | null } };

const reviewRoutes = new Hono<Env>();

function safeParseJson(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  return {};
}

// GET /api/v1/admin/reviews — list pending versions (admin only)
reviewRoutes.get("/api/v1/admin/reviews", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const pending = await listPendingVersions();
  const items = pending.map((v) => ({
    id: v.id,
    skillId: v.skillId,
    slug: v.slug,
    displayName: v.displayName,
    version: v.version,
    changelog: v.changelog ?? "",
    file: v.file,
    fingerprint: v.fingerprint ?? null,
    size: v.size ?? 0,
    reviewStatus: v.reviewStatus,
    uploadedBy: v.uploadedBy,
    createdAt: v.createdAt,
  }));

  return c.json({ ok: true, reviews: items });
});

// GET /api/v1/admin/reviews/:versionId — review detail + check results (admin only)
reviewRoutes.get("/api/v1/admin/reviews/:versionId", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const versionId = Number(c.req.param("versionId"));
  if (!versionId) return c.json({ error: "invalid versionId" }, 400);

  const versionResult = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
  const version = versionResult[0];
  if (!version) return c.json({ error: "version not found" }, 404);

  const skillResult = await db.select().from(skills).where(eq(skills.id, version.skillId)).limit(1);
  const skill = skillResult[0] ?? null;

  const reviewList = await listReviewsByVersionId(versionId);

  return c.json({
    ok: true,
    version: {
      id: version.id,
      skillId: version.skillId,
      slug: skill?.slug ?? null,
      displayName: skill?.displayName ?? null,
      version: version.version,
      changelog: version.changelog ?? "",
      file: version.file,
      fingerprint: version.fingerprint ?? null,
      size: version.size ?? 0,
      reviewStatus: version.reviewStatus,
      uploadedBy: version.uploadedBy,
      createdAt: version.createdAt,
    },
    reviews: reviewList.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason ?? "",
      reviewerName: r.reviewerName,
      checkResults: safeParseJson(r.checkResults),
      createdAt: r.createdAt,
    })),
  });
});

// POST /api/v1/admin/reviews/:versionId/check — trigger safety check only (admin only)
reviewRoutes.post("/api/v1/admin/reviews/:versionId/check", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const versionId = Number(c.req.param("versionId"));
  if (!versionId) return c.json({ error: "invalid versionId" }, 400);

  try {
    const checkResult = await triggerSecurityCheck(versionId);
    return c.json({ ok: true, checkResults: checkResult });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// POST /api/v1/admin/reviews/:versionId/approve — approve version (admin only)
reviewRoutes.post("/api/v1/admin/reviews/:versionId/approve", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const versionId = Number(c.req.param("versionId"));
  if (!versionId) return c.json({ error: "invalid versionId" }, 400);

  let body: { reason?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }
  const reason = String(body.reason ?? "").trim();

  try {
    const result = await approveVersion(versionId, user!.id, reason);
    return c.json({
      ok: true,
      versionId,
      reviewStatus: "approved",
      checkResults: result.checkResult,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// POST /api/v1/admin/reviews/:versionId/reject — reject version (admin only, reason required)
reviewRoutes.post("/api/v1/admin/reviews/:versionId/reject", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const versionId = Number(c.req.param("versionId"));
  if (!versionId) return c.json({ error: "invalid versionId" }, 400);

  const body = await c.req.json<{ reason?: string }>();
  const reason = String(body.reason ?? "").trim();
  if (!reason) return c.json({ error: "reason is required for rejection" }, 400);

  try {
    const result = await rejectVersion(versionId, user!.id, reason);
    return c.json({ ok: true, versionId, reviewStatus: "rejected", reason: result.reason });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

export default reviewRoutes;
