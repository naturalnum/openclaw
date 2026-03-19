import path from "node:path";

export function safeJoin(baseDir: string, filename: string): string {
  const target = path.resolve(baseDir, filename);
  const normalizedBase = path.resolve(baseDir);
  if (!target.startsWith(`${normalizedBase}${path.sep}`) && target !== normalizedBase) {
    throw new Error("invalid path");
  }
  return target;
}

export function sanitizeArchivePath(input: unknown): string | null {
  const normalized = String(input ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

export function sanitizeFileName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

export function validExt(ext: string): string {
  if (ext === ".zip" || ext === ".tgz" || ext === ".tar" || ext === ".gz") return ext;
  return ".zip";
}
