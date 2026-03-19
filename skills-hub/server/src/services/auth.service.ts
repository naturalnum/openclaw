import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../config/env.js";

const BCRYPT_ROUNDS = 10;

export async function register(
  username: string,
  password: string,
  role = "user",
): Promise<{ id: number; username: string; role: string }> {
  const trimmed = String(username ?? "").trim();
  if (!trimmed || !password) {
    throw new Error("username and password are required");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, trimmed))
    .limit(1);

  if (existing.length > 0) {
    const err = Object.assign(new Error(`username already exists: ${trimmed}`), { statusCode: 409 });
    throw err;
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const now = Date.now();

  const result = await db
    .insert(users)
    .values({
      username: trimmed,
      passwordHash,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id });

  return { id: result[0]?.id ?? 0, username: trimmed, role };
}

export async function login(
  username: string,
  password: string,
): Promise<{ id: number; username: string; role: string }> {
  const trimmed = String(username ?? "").trim();
  if (!trimmed || !password) {
    throw new Error("username and password are required");
  }

  const result = await db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.username, trimmed))
    .limit(1);

  const user = result[0];
  if (!user) {
    throw Object.assign(new Error("用户名或密码错误"), { statusCode: 401 });
  }

  if (user.status !== "active") {
    throw Object.assign(new Error("账户已被禁用"), { statusCode: 403 });
  }

  const valid = bcrypt.compareSync(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("用户名或密码错误"), { statusCode: 401 });
  }

  return { id: user.id, username: user.username, role: user.role };
}

export async function ensureInitialAdmin(): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, ADMIN_USERNAME))
    .limit(1);

  if (existing.length > 0) return;

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const now = Date.now();

  await db.insert(users).values({
    username: ADMIN_USERNAME,
    passwordHash,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`[auth] initial admin user created: ${ADMIN_USERNAME}`);
}
