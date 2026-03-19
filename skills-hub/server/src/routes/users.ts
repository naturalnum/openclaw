import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { db } from "../db/index.js";
import { users, sessions } from "../db/schema.js";

type Env = { Variables: { user: AuthUser | null } };

const userRoutes = new Hono<Env>();

// GET /api/v1/admin/users — list all users (admin only)
userRoutes.get("/api/v1/admin/users", async (c) => {
  const user = c.get("user");
  requireAdmin(user);

  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return c.json({ ok: true, users: allUsers });
});

// POST /api/v1/admin/users/:id/disable — disable a user (admin only)
userRoutes.post("/api/v1/admin/users/:id/disable", async (c) => {
  const currentUser = c.get("user");
  requireAdmin(currentUser);

  const userId = Number(c.req.param("id"));
  if (!userId) return c.json({ error: "invalid user id" }, 400);

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (result.length === 0) return c.json({ error: "user not found" }, 404);

  if (currentUser && currentUser.id === userId) {
    return c.json({ error: "cannot disable yourself" }, 400);
  }

  await db
    .update(users)
    .set({ status: "disabled", updatedAt: Date.now() })
    .where(eq(users.id, userId));

  await db.delete(sessions).where(eq(sessions.userId, userId));

  return c.json({ ok: true, userId, status: "disabled" });
});

// POST /api/v1/admin/users/:id/enable — enable a user (admin only)
userRoutes.post("/api/v1/admin/users/:id/enable", async (c) => {
  const currentUser = c.get("user");
  requireAdmin(currentUser);

  const userId = Number(c.req.param("id"));
  if (!userId) return c.json({ error: "invalid user id" }, 400);

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (result.length === 0) return c.json({ error: "user not found" }, 404);

  await db
    .update(users)
    .set({ status: "active", updatedAt: Date.now() })
    .where(eq(users.id, userId));

  return c.json({ ok: true, userId, status: "active" });
});

// DELETE /api/v1/admin/users/:id — delete a user (admin only)
userRoutes.delete("/api/v1/admin/users/:id", async (c) => {
  const currentUser = c.get("user");
  requireAdmin(currentUser);

  const userId = Number(c.req.param("id"));
  if (!userId) return c.json({ error: "invalid user id" }, 400);

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (result.length === 0) return c.json({ error: "user not found" }, 404);

  if (currentUser && currentUser.id === userId) {
    return c.json({ error: "cannot delete yourself" }, 400);
  }

  // Delete sessions first, then user
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  return c.json({ ok: true, userId, deleted: true });
});

export default userRoutes;
