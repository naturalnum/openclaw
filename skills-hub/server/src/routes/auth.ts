import { Hono } from "hono";
import type { AuthUser } from "../middleware/auth.js";
import {
  createAuthSession,
  destroyAuthSession,
  authPayload,
  setSessionCookie,
  clearSessionCookie,
} from "../middleware/auth.js";
import { login, register } from "../services/auth.service.js";

type Env = { Variables: { user: AuthUser | null } };

const authRoutes = new Hono<Env>();

// GET /auth/session — return current auth state
authRoutes.get("/auth/session", (c) => {
  const user = c.get("user");
  return c.json(authPayload(user));
});

// POST /auth/login — authenticate and create session
authRoutes.post("/auth/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return c.json({ error: "username/password are required" }, 400);
  }

  try {
    const user = await login(username, password);
    const sessionId = await createAuthSession(user.id);
    setSessionCookie(c, sessionId);
    return c.json({ ok: true, auth: authPayload({ ...user, sessionId }) });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, statusCode as 400);
  }
});

// POST /auth/logout — destroy session
authRoutes.post("/auth/logout", async (c) => {
  const user = c.get("user");
  await destroyAuthSession(user?.sessionId ?? null);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// POST /auth/register — register a new user
authRoutes.post("/auth/register", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return c.json({ error: "username/password are required" }, 400);
  }

  try {
    const user = await register(username, password);
    const sessionId = await createAuthSession(user.id);
    setSessionCookie(c, sessionId);
    return c.json({ ok: true, auth: authPayload({ ...user, sessionId }) });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, statusCode as 400);
  }
});

export default authRoutes;
