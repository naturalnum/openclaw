import path from "node:path";

export const PORT = Number(process.env.PORT || 8081);
export const DATA_DIR = process.env.DATA_DIR || "/data";
export const FILES_DIR = path.join(DATA_DIR, "files");
export const TEMP_DIR = path.join(DATA_DIR, ".tmp");
export const INDEX_PATH = path.join(DATA_DIR, "index.json");
export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/clawhub";
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`;
export const PUBLIC_BASE_PATH = String(process.env.PUBLIC_BASE_PATH || "").trim();
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
export const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "admin").trim();
export const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "admin123");
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 60 * 1024 * 1024);
export const JSON_LIMIT_BYTES = Number(process.env.JSON_LIMIT_BYTES || 120 * 1024 * 1024);
export const SESSION_COOKIE_NAME = "private_clawhub_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
