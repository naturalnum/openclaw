import { Type } from "@sinclair/typebox";
import { Client } from "pg";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { ConnectorProviderRuntime } from "../types.js";

function readRequiredString(value: unknown) {
  return normalizeOptionalString(value) ?? "";
}

function readPort(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const normalized = normalizeOptionalString(value) ?? "";
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = (normalizeOptionalString(value) ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
}

function buildClientConfig(config: Record<string, unknown>, secrets: Record<string, string>) {
  return {
    host: readRequiredString(config.host),
    port: readPort(config.port, 5432),
    database: readRequiredString(config.database),
    user: readRequiredString(config.user),
    password: secrets.password ?? "",
    ssl: readBoolean(config.ssl, false) ? { rejectUnauthorized: false } : undefined,
  };
}

async function withClient<T>(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  run: (client: Client) => Promise<T>,
) {
  const client = new Client(buildClientConfig(config, secrets));
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const READ_QUERY_RE = /^(select|with|explain)\b/i;

export const postgresConnectorProvider: ConnectorProviderRuntime = {
  definition: {
    id: "postgres",
    displayName: "PostgreSQL",
    description: "Connect to a PostgreSQL database for schema inspection and SQL execution.",
    category: "database",
    authType: "basic",
    configFields: [
      { key: "host", label: "Host", kind: "text", required: true, placeholder: "db.example.com" },
      { key: "port", label: "Port", kind: "number", required: true, placeholder: "5432" },
      { key: "database", label: "Database", kind: "text", required: true, placeholder: "app" },
      { key: "user", label: "User", kind: "text", required: true, placeholder: "readonly_user" },
      {
        key: "ssl",
        label: "Use SSL",
        kind: "boolean",
        description: "Enable TLS for the database connection.",
      },
    ],
    secretFields: [
      {
        key: "password",
        label: "Password or SecretRef",
        kind: "text",
        required: true,
        placeholder: "${POSTGRES_PASSWORD}",
      },
    ],
    actions: [
      {
        name: "db.schema.list",
        displayName: "List Schemas",
        description: "List non-system schemas and tables.",
        access: "read",
        riskLevel: "low",
        defaultPolicy: "allow",
        inputSchema: Type.Object({}, { additionalProperties: false }),
      },
      {
        name: "db.table.describe",
        displayName: "Describe Table",
        description: "Describe columns for a specific table.",
        access: "read",
        riskLevel: "low",
        defaultPolicy: "allow",
        inputSchema: Type.Object(
          {
            table: Type.String({ minLength: 1 }),
            schema: Type.Optional(Type.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      },
      {
        name: "db.query.read",
        displayName: "Run Read Query",
        description: "Execute a read-only SQL query.",
        access: "read",
        riskLevel: "medium",
        defaultPolicy: "allow",
        inputSchema: Type.Object(
          {
            sql: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      },
      {
        name: "db.query.write",
        displayName: "Run Write Query",
        description: "Execute a write SQL statement against the database.",
        access: "write",
        riskLevel: "critical",
        defaultPolicy: "approval",
        inputSchema: Type.Object(
          {
            sql: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      },
    ],
  },
  async validate(params) {
    const errors: string[] = [];
    for (const key of ["host", "database", "user"]) {
      if (!readRequiredString(params.config[key])) {
        errors.push(`${key} is required`);
      }
    }
    if (!normalizeOptionalString(params.secretInputs.password)) {
      errors.push("password is required");
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  async testConnection(params) {
    try {
      await withClient(params.config, params.secrets, async () => undefined);
      return { ok: true, message: "PostgreSQL connection succeeded." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
  async invoke(params) {
    try {
      const data = await withClient(params.config, params.secrets, async (client) => {
        if (params.action === "db.schema.list") {
          const result = await client.query(`
            select table_schema, table_name
            from information_schema.tables
            where table_schema not in ('pg_catalog', 'information_schema')
            order by table_schema, table_name
          `);
          return result.rows;
        }
        if (params.action === "db.table.describe") {
          const schema = normalizeOptionalString(params.args.schema) ?? "public";
          const table = normalizeOptionalString(params.args.table) ?? "";
          if (!table) {
            throw new Error("table is required");
          }
          const result = await client.query(
            `
              select column_name, data_type, is_nullable, column_default
              from information_schema.columns
              where table_schema = $1 and table_name = $2
              order by ordinal_position
            `,
            [schema, table],
          );
          return result.rows;
        }
        const sql = normalizeOptionalString(params.args.sql) ?? "";
        if (!sql) {
          throw new Error("sql is required");
        }
        if (params.action === "db.query.read") {
          if (!READ_QUERY_RE.test(sql)) {
            throw new Error("read queries must start with SELECT, WITH, or EXPLAIN");
          }
          const result = await client.query(sql);
          return {
            rowCount: result.rowCount ?? 0,
            rows: result.rows,
          };
        }
        if (params.action === "db.query.write") {
          const result = await client.query(sql);
          return {
            rowCount: result.rowCount ?? 0,
            command: result.command,
          };
        }
        throw new Error(`unsupported action: ${params.action}`);
      });
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
