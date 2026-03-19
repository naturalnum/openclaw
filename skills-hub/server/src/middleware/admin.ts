import type { AuthUser } from "./auth.js";

type HttpError = Error & { statusCode?: number };

function httpError(message: string, statusCode: number): HttpError {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  return err;
}

export function requireAuth(user: AuthUser | null): asserts user is AuthUser {
  if (!user) throw httpError("unauthorized", 401);
}

export function requireAdmin(user: AuthUser | null): asserts user is AuthUser & { role: "admin" } {
  if (!user) throw httpError("unauthorized", 401);
  if (user.role !== "admin") throw httpError("forbidden: admin access required", 403);
}
