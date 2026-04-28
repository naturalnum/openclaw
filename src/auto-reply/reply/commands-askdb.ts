import {
  listOwnedConnectorInstances,
  invokeConnectorActionForAccount,
} from "../../connectors/runtime.js";
import type { ConnectorInstance } from "../../connectors/types.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { resolveChannelAccountId } from "./channel-context.js";
import { rejectUnauthorizedCommand } from "./command-gates.js";
import type { CommandHandler } from "./commands-types.js";

type AskDbSubcommand =
  | { kind: "summary" }
  | { kind: "schema" }
  | { kind: "count"; table: string }
  | { kind: "query"; prompt: string };

function parseAskDbSubcommand(commandBodyNormalized: string): AskDbSubcommand {
  const argText = commandBodyNormalized.replace(/^\/askdb\b/i, "").trim();
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

function pickActivePostgresInstance(instances: ConnectorInstance[]): ConnectorInstance | null {
  return instances.find((item) => item.providerId === "postgres" && item.enabled) ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function runSchemaList(params: {
  ownerAccountId: string;
  instanceId: string;
}): Promise<Array<{ table_schema?: string; table_name?: string }>> {
  const result = await invokeConnectorActionForAccount({
    ownerAccountId: params.ownerAccountId,
    instanceId: params.instanceId,
    action: "db.schema.list",
  });
  if (!result.ok) {
    throw new Error(result.error ?? "schema list failed");
  }
  return Array.isArray(result.data)
    ? (result.data as Array<{ table_schema?: string; table_name?: string }>)
    : [];
}

async function runTableCount(params: {
  ownerAccountId: string;
  instanceId: string;
  schema: string;
  table: string;
}): Promise<number> {
  const sql = `select count(*)::bigint as total from ${quoteIdentifier(params.schema)}.${quoteIdentifier(params.table)}`;
  const result = await invokeConnectorActionForAccount({
    ownerAccountId: params.ownerAccountId,
    instanceId: params.instanceId,
    action: "db.query.read",
    args: { sql },
  });
  if (!result.ok) {
    throw new Error(result.error ?? "count query failed");
  }
  const rows =
    (result.data as { rows?: Array<{ total?: number | string }> } | undefined)?.rows ?? [];
  const raw = rows[0]?.total;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runReadQuery(params: {
  ownerAccountId: string;
  instanceId: string;
  sql: string;
}): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
  const result = await invokeConnectorActionForAccount({
    ownerAccountId: params.ownerAccountId,
    instanceId: params.instanceId,
    action: "db.query.read",
    args: { sql: params.sql },
  });
  if (!result.ok) {
    throw new Error(result.error ?? "read query failed");
  }
  const data = result.data as
    | { rowCount?: number; rows?: Array<Record<string, unknown>> }
    | undefined;
  return {
    rowCount: Number.isFinite(data?.rowCount) ? Number(data?.rowCount) : 0,
    rows: Array.isArray(data?.rows) ? data.rows : [],
  };
}

function renderQueryResultRows(rows: Array<Record<string, unknown>>, maxRows = 12): string[] {
  if (rows.length === 0) {
    return ["(no rows)"];
  }
  const lines: string[] = [];
  const sliced = rows.slice(0, maxRows);
  for (const row of sliced) {
    const fields = Object.entries(row).map(([key, value]) => `${key}=${String(value)}`);
    lines.push(`- ${fields.join(", ")}`);
  }
  if (rows.length > maxRows) {
    lines.push(`...and ${rows.length - maxRows} more row(s).`);
  }
  return lines;
}

export const handleAskDbCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const commandBodyNormalized = params.command.commandBodyNormalized.trim();
  if (!commandBodyNormalized.startsWith("/askdb")) {
    return null;
  }
  const unauthorized = rejectUnauthorizedCommand(params, "/askdb");
  if (unauthorized) {
    return unauthorized;
  }

  const accountId = resolveChannelAccountId({
    cfg: params.cfg,
    ctx: params.ctx,
    command: params.command,
  });
  const instances = await listOwnedConnectorInstances(accountId);
  const postgres = pickActivePostgresInstance(instances);
  if (!postgres) {
    return {
      shouldContinue: false,
      reply: {
        text: "No enabled PostgreSQL connector found. Enable one in Connectors first, then run /askdb.",
      },
    };
  }

  try {
    const subcommand = parseAskDbSubcommand(commandBodyNormalized);
    if (subcommand.kind === "schema") {
      const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
      if (tables.length === 0) {
        return { shouldContinue: false, reply: { text: "Schema is empty." } };
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
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    if (subcommand.kind === "count") {
      const qualified = parseQualifiedTableName(subcommand.table);
      if (!qualified || !qualified.table) {
        return {
          shouldContinue: false,
          reply: { text: "Usage: /askdb count <table> or /askdb count <schema.table>" },
        };
      }
      const total = await runTableCount({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        schema: qualified.schema,
        table: qualified.table,
      });
      return {
        shouldContinue: false,
        reply: { text: `${qualified.schema}.${qualified.table}: ${total} rows` },
      };
    }

    if (subcommand.kind === "query") {
      const sql = buildReadOnlySqlFromPrompt(subcommand.prompt);
      if (!sql) {
        return {
          shouldContinue: false,
          reply: {
            text:
              "I couldn't map that request to a safe read-only query yet.\n" +
              "Try examples:\n" +
              "- /askdb 近7天完成任务数\n" +
              "- /askdb 近7天任务趋势\n" +
              "- /askdb 项目任务排行\n" +
              "- /askdb count users",
          },
        };
      }
      const result = await runReadQuery({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        sql,
      });
      const lines = [`AskDB query result (${result.rowCount} row(s)):`];
      lines.push(...renderQueryResultRows(result.rows));
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
    if (tables.length === 0) {
      return { shouldContinue: false, reply: { text: "Connected, but no user tables found." } };
    }

    const lines = [
      `Connected to ${postgres.displayName} (${postgres.providerId})`,
      `Found ${tables.length} table(s).`,
      "",
      "Table row counts:",
    ];
    for (const item of tables.slice(0, 8)) {
      const schema = normalizeOptionalString(item.table_schema) ?? "public";
      const table = normalizeOptionalString(item.table_name) ?? "<unknown>";
      try {
        const total = await runTableCount({
          ownerAccountId: accountId,
          instanceId: postgres.id,
          schema,
          table,
        });
        lines.push(`- ${schema}.${table}: ${total}`);
      } catch (error) {
        lines.push(`- ${schema}.${table}: failed (${toErrorMessage(error)})`);
      }
    }
    if (tables.length > 8) {
      lines.push(`...and ${tables.length - 8} more tables.`);
    }
    lines.push("", "Try: /askdb schema", "Try: /askdb count users");
    return {
      shouldContinue: false,
      reply: { text: lines.join("\n") },
    };
  } catch (error) {
    return {
      shouldContinue: false,
      reply: { text: `AskDB failed: ${toErrorMessage(error)}` },
    };
  }
};
