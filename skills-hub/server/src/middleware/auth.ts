import crypto from "node:crypto";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie as honoCookie, deleteCookie } from "hono/cookie";
import { eq, and, gt, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, ADMIN_TOKEN } from "../config/env.js";

export type AuthUser = {
  id: number;
  username: string;
  role: string;
  sessionId: string | null;
};

// Session cleanup throttle
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = 0;

async function maybeCleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  try {
    await db.delete(sessions).where(
      lt(sessions.expiresAt, Date.now())
    ).execute().catch(() => {});
    // Simpler approach: raw delete
  } catch {
    // Cleanup failure does not affect requests
  }
}

export const authMiddleware = createMiddleware<{
  Variables: { user: AuthUser | null };
}>(async (c, next) => {
  await maybeCleanupExpiredSessions();

  // Check session cookie
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    const result = await db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        username: users.username,
        role: users.role,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);

    const row = result[0];
    if (row && row.expiresAt > Date.now() && row.status === "active") {
      c.set("user", {
        id: row.userId,
        username: row.username,
        role: row.role,
        sessionId: row.sessionId,
      });
      await next();
      return;
    }
  }

  // Fallback: admin token
  const tokenHeader = c.req.header("x-admin-token");
  if (ADMIN_TOKEN && tokenHeader && tokenHeader.trim() === ADMIN_TOKEN) {
    c.set("user", {
      id: 0,
      username: "token-admin",
      role: "admin",
      sessionId: null,
    });
    await next();
    return;
  }

  c.set("user", null);
  await next();
});

// Session management
export async function createAuthSession(userId: number): Promise<string> {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.insert(sessions).values({ id: sessionId, userId, expiresAt, createdAt: now });
  return sessionId;
}

export async function destroyAuthSession(sessionId: string | null): Promise<void> {
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
}

// Auth payload helper
export function authPayload(user: AuthUser | null): {
  isAuthenticated: boolean;
  user: { id: number; username: string; role: string } | null;
} {
  if (!user) return { isAuthenticated: false, user: null };
  return {
    isAuthenticated: true,
    user: { id: user.id, username: user.username, role: user.role },
  };
}

// Cookie helpers
export function setSessionCookie(c: Parameters<typeof honoCookie>[0], sessionId: string): void {
  honoCookie(c, SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}
