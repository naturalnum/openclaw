import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { DATABASE_URL } from "../config/env.js";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
    pool.on("error", (err: Error) => {
      console.error("[db] unexpected pool error:", err);
    });
  }
  return pool;
}

export const db = drizzle(getPool(), { schema: { ...schema, ...relations } });

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
