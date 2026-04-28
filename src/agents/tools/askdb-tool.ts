import { Type } from "@sinclair/typebox";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const AskDbToolSchema = Type.Object({
  command: Type.Optional(Type.String()),
  commandName: Type.Optional(Type.String()),
  skillName: Type.Optional(Type.String()),
});

type AskDbSubcommand =
  | { kind: "summary" }
  | { kind: "schema" }
  | { kind: "count"; table: string }
  | { kind: "query"; prompt: string };

type ConnectorInstanceSummary = {
  id: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
};

function parseAskDbSubcommand(raw: string): AskDbSubcommand {
  const argText = raw.trim();
  if (!argText) {
    return { kind: "summary" };
  }
  if (argText === "schema") {
    return { kind: "schema" };
  }
  if (argText.startsWith("count ")) {
    const table = argText.slice("count ".length).trim();
    if (table) {
      return { kind: "count", table };
    }
  }
  return { kind: "query", prompt: argText };
}

function pickActivePostgresInstance(
  instances: ConnectorInstanceSummary[],
): ConnectorInstanceSummary | null {
  return instances.find((item) => item.providerId === "postgres" && item.enabled) ?? null;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseQualifiedTableName(tableInput: string): { schema: string; table: string } | null {
  const trimmed = tableInput.trim();
  if (!trimmed) {
    return null;
  }
  const [left, right] = trimmed.split(".", 2);
  if (right) {
    return {
      schema: left.trim() || "public",
      table: right.trim(),
    };
  }
  return { schema: "public", table: left.trim() };
}

function normalizeNaturalPrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function buildReadOnlySqlFromPrompt(prompt: string): string | null {
  const text = normalizeNaturalPrompt(prompt);
  const mentionsTask = text.includes("task") || text.includes("任务");
  const asksDone =
    text.includes("done") ||
    text.includes("完成") ||
    text.includes("已完成") ||
    text.includes("completed");
  const asksToday = text.includes("今天") || text.includes("today");
  const asksLast7Days =
    text.includes("近7天") ||
    text.includes("最近7天") ||
    text.includes("last 7 days") ||
    text.includes("7天");
  const asksTrend =
    text.includes("趋势") ||
    text.includes("按天") ||
    text.includes("daily") ||
    text.includes("每一天");
  const asksTopProjects =
    text.includes("project") ||
    text.includes("项目") ||
    text.includes("top") ||
    text.includes("排行");

  if (mentionsTask && asksDone && asksToday) {
    return "select count(*)::bigint as total_done_today from tasks where done = true and created_at::date = current_date";
  }
  if (mentionsTask && asksDone && asksLast7Days && asksTrend) {
    return "select created_at::date as day, count(*)::bigint as total_done from tasks where done = true and created_at >= now() - interval '7 day' group by day order by day";
  }
  if (mentionsTask && asksDone && asksLast7Days) {
    return "select count(*)::bigint as total_done_last_7_days from tasks where done = true and created_at >= now() - interval '7 day'";
  }
  if (mentionsTask && asksLast7Days && asksTrend) {
    return "select created_at::date as day, count(*)::bigint as total_tasks from tasks where created_at >= now() - interval '7 day' group by day order by day";
  }
  if (mentionsTask && asksLast7Days) {
    return "select count(*)::bigint as total_tasks_last_7_days from tasks where created_at >= now() - interval '7 day'";
  }
  if (mentionsTask && asksDone) {
    return "select count(*)::bigint as total_done from tasks where done = true";
  }
  if (mentionsTask) {
    return "select count(*)::bigint as total_tasks from tasks";
  }
  if (asksTopProjects) {
    return "select p.name as project, count(t.id)::bigint as task_count from projects p left join tasks t on t.project_id = p.id group by p.id, p.name order by task_count desc, p.name asc limit 10";
  }
  return null;
}

function renderQueryResultRows(rows: Array<Record<string, unknown>>, maxRows = 12): string[] {
  if (rows.length === 0) {
    return ["(no rows)"];
  }
  const lines: string[] = [];
  for (const row of rows.slice(0, maxRows)) {
    const fields = Object.entries(row).map(([key, value]) => `${key}=${String(value)}`);
    lines.push(`- ${fields.join(", ")}`);
  }
  if (rows.length > maxRows) {
    lines.push(`...and ${rows.length - maxRows} more row(s).`);
  }
  return lines;
}

async function runConnectorAction(params: {
  instanceId: string;
  action: string;
  args?: Record<string, unknown>;
}) {
  return await callGatewayTool<{ ok: boolean; data?: unknown; error?: string }>(
    "connectors.invoke",
    {},
    {
      instanceId: params.instanceId,
      action: params.action,
      args: params.args,
    },
  );
}

export function createAskDbTool(): AnyAgentTool {
  return {
    label: "AskDB Query",
    name: "askdb_query",
    description:
      "Run safe read-only database analytics through the enabled PostgreSQL connector. Command examples: schema, count users, 近7天完成任务数.",
    parameters: AskDbToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const rawCommand = normalizeOptionalString(params.command) ?? "";
      const subcommand = parseAskDbSubcommand(rawCommand);

      const instancesRes = (await callGatewayTool("connectors.instances.list", {}, {})) as {
        instances?: ConnectorInstanceSummary[];
      };
      const instances = Array.isArray(instancesRes.instances) ? instancesRes.instances : [];
      const postgres = pickActivePostgresInstance(instances);
      if (!postgres) {
        return textResult(
          "No enabled PostgreSQL connector found. Enable one in Connectors first, then run the command again.",
          { ok: false },
        );
      }

      if (subcommand.kind === "schema" || subcommand.kind === "summary") {
        const schemaResult = await runConnectorAction({
          instanceId: postgres.id,
          action: "db.schema.list",
        });
        if (!schemaResult.ok) {
          return textResult(`AskDB failed: ${schemaResult.error ?? "schema list failed"}`, {
            ok: false,
          });
        }
        const tables = Array.isArray(schemaResult.data)
          ? (schemaResult.data as Array<{ table_schema?: string; table_name?: string }>)
          : [];
        if (subcommand.kind === "schema") {
          if (tables.length === 0) {
            return textResult("Schema is empty.", { ok: true });
          }
          const lines = ["Database tables:"];
          for (const item of tables.slice(0, 50)) {
            const schema = normalizeOptionalString(item.table_schema) ?? "public";
            const table = normalizeOptionalString(item.table_name) ?? "<unknown>";
            lines.push(`- ${schema}.${table}`);
          }
          if (tables.length > 50) {
            lines.push(`...and ${tables.length - 50} more.`);
          }
          return textResult(lines.join("\n"), { ok: true });
        }
      }

      if (subcommand.kind === "count") {
        const qualified = parseQualifiedTableName(subcommand.table);
        if (!qualified || !qualified.table) {
          return textResult("Usage: count <table> or count <schema.table>", { ok: false });
        }
        const sql = `select count(*)::bigint as total from ${quoteIdentifier(qualified.schema)}.${quoteIdentifier(qualified.table)}`;
        const countResult = await runConnectorAction({
          instanceId: postgres.id,
          action: "db.query.read",
          args: { sql },
        });
        if (!countResult.ok) {
          return textResult(`AskDB failed: ${countResult.error ?? "count query failed"}`, {
            ok: false,
          });
        }
        const rows =
          (countResult.data as { rows?: Array<{ total?: number | string }> } | undefined)?.rows ??
          [];
        const raw = rows[0]?.total;
        const parsed = typeof raw === "number" ? raw : Number.parseInt(raw ?? "0", 10);
        const total = Number.isFinite(parsed) ? parsed : 0;
        return textResult(`${qualified.schema}.${qualified.table}: ${total} rows`, { ok: true });
      }

      if (subcommand.kind === "query") {
        const sql = buildReadOnlySqlFromPrompt(subcommand.prompt);
        if (!sql) {
          return textResult(
            "I couldn't map that request to a safe read-only query yet.\nTry: 近7天完成任务数 / 近7天任务趋势 / 项目任务排行 / count users",
            { ok: false },
          );
        }
        const queryResult = await runConnectorAction({
          instanceId: postgres.id,
          action: "db.query.read",
          args: { sql },
        });
        if (!queryResult.ok) {
          return textResult(`AskDB failed: ${queryResult.error ?? "read query failed"}`, {
            ok: false,
          });
        }
        const data = queryResult.data as
          | { rowCount?: number; rows?: Array<Record<string, unknown>> }
          | undefined;
        const rowCount = Number.isFinite(data?.rowCount) ? Number(data?.rowCount) : 0;
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const lines = [`AskDB query result (${rowCount} row(s)):`];
        lines.push(...renderQueryResultRows(rows));
        return textResult(lines.join("\n"), { ok: true });
      }

      return textResult("Unsupported AskDB command.", { ok: false });
    },
  };
}
