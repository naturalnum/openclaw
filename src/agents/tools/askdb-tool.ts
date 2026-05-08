import { Type } from "@sinclair/typebox";
import {
  ASKDB_DATE_ANCHOR_SQL,
  buildAskDbHeuristicPlan,
  buildAskDbTimeFilterSql,
  buildReadOnlySqlFromPrompt,
  enrichAskDbHeuristicPlanWithRetrieve,
  formatColumnDescribeLines,
  parseAskDbSubcommand,
  parseQualifiedTableName,
  pickAskDbAmountColumn,
  pickAskDbOrgColumn,
  pickAskDbProjectColumn,
  pickAskDbTechDomainColumn,
  pickAskDbTimeColumn,
  quoteIdentifier,
  scoreTablesForSearch,
  validateReadOnlySelectSql,
} from "../../connectors/askdb-command-core.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const AskDbToolSchema = Type.Object({
  command: Type.Optional(
    Type.String({
      description:
        "AskDB subcommand (same as text after `/askdb`): empty=summary; `schema`; `date` (DB calendar anchor); `describe schema.table`; `search <keywords>` (rank tables); `context <keywords>` (top 5 tables + columns); `sql SELECT ...` (read-only); `count schema.table`; or demo NL (tasks/projects).",
    }),
  ),
  commandName: Type.Optional(
    Type.String({
      description: "Alias for `command` when the host passes the subcommand under a different key.",
    }),
  ),
  skillName: Type.Optional(Type.String({ description: "Skill name hint; ignored by AskDB." })),
});

type ConnectorInstanceSummary = {
  id: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
};

function pickActivePostgresInstance(
  instances: ConnectorInstanceSummary[],
): ConnectorInstanceSummary | null {
  return instances.find((item) => item.providerId === "postgres" && item.enabled) ?? null;
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

async function fetchSchemaTables(instanceId: string): Promise<Array<{ table_schema?: string; table_name?: string }>> {
  const schemaResult = await runConnectorAction({
    instanceId,
    action: "db.schema.list",
  });
  if (!schemaResult.ok) {
    throw new Error(schemaResult.error ?? "schema list failed");
  }
  return Array.isArray(schemaResult.data)
    ? (schemaResult.data as Array<{ table_schema?: string; table_name?: string }>)
    : [];
}

async function runSummaryText(params: {
  instanceId: string;
  displayName: string;
  providerId: string;
}): Promise<string> {
  const tables = await fetchSchemaTables(params.instanceId);
  if (tables.length === 0) {
    return "Connected, but no user tables found.";
  }
  const lines = [
    `Connected to ${params.displayName} (${params.providerId})`,
    `Found ${tables.length} table(s).`,
    "",
    "Suggested workflow (data-dictionary style):",
    "1) `date` — anchor “today / last week” on the DB clock.",
    "2) `search <topic>` — shortlist tables from imported schema.",
    "3) `context <topic>` — top 5 tables with columns (pick the right grain).",
    "4) `sql SELECT ...` — read-only query after you know the table.",
    "",
    "Table row counts (first 8):",
  ];
  for (const item of tables.slice(0, 8)) {
    const schema = normalizeOptionalString(item.table_schema) ?? "public";
    const table = normalizeOptionalString(item.table_name) ?? "<unknown>";
    try {
      const total = await runTableCount({ instanceId: params.instanceId, schema, table });
      lines.push(`- ${schema}.${table}: ${total}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`- ${schema}.${table}: failed (${message})`);
    }
  }
  if (tables.length > 8) {
    lines.push(`...and ${tables.length - 8} more tables.`);
  }
  lines.push("", "Try: `schema`, `search 订单`, `context 订单`, `describe public.orders`, `sql select ...`");
  return lines.join("\n");
}

async function runTableCount(params: {
  instanceId: string;
  schema: string;
  table: string;
}): Promise<number> {
  const sql = `select count(*)::bigint as total from ${quoteIdentifier(params.schema)}.${quoteIdentifier(params.table)}`;
  const countResult = await runConnectorAction({
    instanceId: params.instanceId,
    action: "db.query.read",
    args: { sql },
  });
  if (!countResult.ok) {
    throw new Error(countResult.error ?? "count query failed");
  }
  const rows =
    (countResult.data as { rows?: Array<{ total?: number | string }> } | undefined)?.rows ?? [];
  const raw = rows[0]?.total;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createAskDbTool(): AnyAgentTool {
  return {
    label: "AskDB Query",
    name: "askdb_query",
    description:
      "Read-only PostgreSQL analytics: inspect imported schema (search/context/describe), anchor dates (`date`), then run a single `sql SELECT`. Demo NL still maps to tasks/projects templates only.",
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

      try {
        if (subcommand.kind === "summary") {
          const text = await runSummaryText({
            instanceId: postgres.id,
            displayName: postgres.displayName,
            providerId: postgres.providerId,
          });
          return textResult(text, { ok: true });
        }

        if (subcommand.kind === "schema") {
          const tables = await fetchSchemaTables(postgres.id);
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

        if (subcommand.kind === "date") {
          const queryResult = await runConnectorAction({
            instanceId: postgres.id,
            action: "db.query.read",
            args: { sql: ASKDB_DATE_ANCHOR_SQL },
          });
          if (!queryResult.ok) {
            return textResult(`AskDB failed: ${queryResult.error ?? "date query failed"}`, {
              ok: false,
            });
          }
          const data = queryResult.data as
            | { rowCount?: number; rows?: Array<Record<string, unknown>> }
            | undefined;
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          const lines = [
            "AskDB date anchor (from database server clock; use before interpreting “昨天/上周/近7天”):",
          ];
          lines.push(...renderQueryResultRows(rows, 24));
          return textResult(lines.join("\n"), { ok: true });
        }

        if (subcommand.kind === "describe") {
          const qualified = parseQualifiedTableName(subcommand.table);
          if (!qualified || !qualified.table) {
            return textResult("Usage: describe <table> or describe <schema.table>", { ok: false });
          }
          const descResult = await runConnectorAction({
            instanceId: postgres.id,
            action: "db.table.describe",
            args: { schema: qualified.schema, table: qualified.table },
          });
          if (!descResult.ok) {
            return textResult(`AskDB failed: ${descResult.error ?? "describe failed"}`, {
              ok: false,
            });
          }
          const rows = Array.isArray(descResult.data)
            ? (descResult.data as Array<Record<string, unknown>>)
            : [];
          const lines = [`Columns for ${qualified.schema}.${qualified.table}:`];
          lines.push(...formatColumnDescribeLines(rows));
          return textResult(lines.join("\n"), { ok: true });
        }

        if (subcommand.kind === "search") {
          const tables = await fetchSchemaTables(postgres.id);
          if (tables.length === 0) {
            return textResult("Schema is empty.", { ok: true });
          }
          const ranked = scoreTablesForSearch(tables, subcommand.query);
          const top = ranked.slice(0, 20);
          const lines = [
            `Table candidates for "${subcommand.query}" (up to 20, scored by name match):`,
          ];
          for (const row of top) {
            lines.push(`- ${row.fullName} (score=${row.score})`);
          }
          if (ranked.length > 20) {
            lines.push(`(${ranked.length} tables total; refine search if needed.)`);
          }
          lines.push("", "Next: `context <same query>` for top-5 column detail, or `describe schema.table`.");
          return textResult(lines.join("\n"), { ok: true });
        }

        if (subcommand.kind === "context") {
          const tables = await fetchSchemaTables(postgres.id);
          if (tables.length === 0) {
            return textResult("Schema is empty.", { ok: true });
          }
          const ranked = scoreTablesForSearch(tables, subcommand.query);
          const topFive = ranked.slice(0, 5);
          const lines = [
            `Top ${topFive.length} table(s) for "${subcommand.query}" with column shapes (imported information_schema):`,
          ];
          for (const t of topFive) {
            lines.push("", `## ${t.fullName} (score=${t.score})`);
            const descResult = await runConnectorAction({
              instanceId: postgres.id,
              action: "db.table.describe",
              args: { schema: t.schema, table: t.table },
            });
            if (!descResult.ok) {
              lines.push(`(describe failed: ${descResult.error ?? "unknown"})`);
              continue;
            }
            const rows = Array.isArray(descResult.data)
              ? (descResult.data as Array<Record<string, unknown>>)
              : [];
            lines.push(...formatColumnDescribeLines(rows, 60));
          }
          lines.push("", "Then compose one read-only `sql SELECT ...` using these columns.");
          return textResult(lines.join("\n"), { ok: true });
        }

        if (subcommand.kind === "sql") {
          const checked = validateReadOnlySelectSql(subcommand.sql);
          if (!checked.ok) {
            return textResult(`Rejected SQL: ${checked.reason}`, { ok: false });
          }
          const queryResult = await runConnectorAction({
            instanceId: postgres.id,
            action: "db.query.read",
            args: { sql: checked.sql },
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

        if (subcommand.kind === "count") {
          const qualified = parseQualifiedTableName(subcommand.table);
          if (!qualified || !qualified.table) {
            return textResult("Usage: count <table> or count <schema.table>", { ok: false });
          }
          const total = await runTableCount({
            instanceId: postgres.id,
            schema: qualified.schema,
            table: qualified.table,
          });
          return textResult(`${qualified.schema}.${qualified.table}: ${total} rows`, { ok: true });
        }

        if (subcommand.kind === "query") {
          const heuristicSql = await (async () => {
            const plan = enrichAskDbHeuristicPlanWithRetrieve(
              subcommand.prompt,
              buildAskDbHeuristicPlan(subcommand.prompt),
            );
            const tables = await fetchSchemaTables(postgres.id);
            if (tables.length === 0) {
              return null;
            }
            const ranked = scoreTablesForSearch(tables, plan.searchQuery);
            const target = ranked[0];
            if (!target || target.score <= 0) {
              return null;
            }

            const descResult = await runConnectorAction({
              instanceId: postgres.id,
              action: "db.table.describe",
              args: { schema: target.schema, table: target.table },
            });
            if (!descResult.ok) {
              return null;
            }
            const columns = Array.isArray(descResult.data)
              ? (descResult.data as Array<Record<string, unknown>>)
              : [];
            const timeColumn = pickAskDbTimeColumn(columns);
            const amountColumn = pickAskDbAmountColumn(columns);
            const projectColumn = pickAskDbProjectColumn(columns);
            const techDomainColumn = pickAskDbTechDomainColumn(columns);
            const orgColumn = pickAskDbOrgColumn(columns);
            const tableSql = `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table)}`;
            const whereParts: string[] = [];
            if (timeColumn) {
              whereParts.push(buildAskDbTimeFilterSql(quoteIdentifier(timeColumn), plan.window));
            }
            if (plan.orgConstraint && orgColumn) {
              whereParts.push(`${quoteIdentifier(orgColumn)} like '%${plan.orgConstraint.replaceAll("'", "''")}%'`);
            }
            if (plan.domainConstraint && techDomainColumn) {
              whereParts.push(
                `${quoteIdentifier(techDomainColumn)} like '%${plan.domainConstraint.replaceAll("'", "''")}%'`,
              );
            }
            const whereSql = whereParts.length > 0 ? whereParts.join(" and ") : "true";

            if (plan.metric === "sum_amount" && plan.topN && projectColumn && amountColumn) {
              if (plan.asksTechDomain && techDomainColumn) {
                return `with ranked_projects as (select ${quoteIdentifier(projectColumn)} as project_name, ${quoteIdentifier(
                  techDomainColumn,
                )} as tech_domain, coalesce(sum(${quoteIdentifier(amountColumn)}), 0)::numeric as total_amount from ${tableSql} where ${whereSql} group by 1, 2 order by total_amount desc limit ${plan.topN}) select tech_domain, project_name, total_amount from ranked_projects order by total_amount desc`;
              }
              return `select ${quoteIdentifier(projectColumn)} as project_name, coalesce(sum(${quoteIdentifier(amountColumn)}), 0)::numeric as total_amount from ${tableSql} where ${whereSql} group by 1 order by total_amount desc limit ${plan.topN}`;
            }

            if (plan.trendByDay && timeColumn) {
              if (plan.metric === "sum_amount" && amountColumn) {
                return `select ${quoteIdentifier(timeColumn)}::date as day, coalesce(sum(${quoteIdentifier(amountColumn)}), 0)::numeric as total_amount from ${tableSql} where ${whereSql} group by day order by day`;
              }
              return `select ${quoteIdentifier(timeColumn)}::date as day, count(*)::bigint as total_count from ${tableSql} where ${whereSql} group by day order by day`;
            }
            if (plan.metric === "sum_amount" && amountColumn) {
              return `select coalesce(sum(${quoteIdentifier(amountColumn)}), 0)::numeric as total_amount from ${tableSql} where ${whereSql}`;
            }
            return `select count(*)::bigint as total_count from ${tableSql} where ${whereSql}`;
          })();
          const resolvedSql = heuristicSql ?? buildReadOnlySqlFromPrompt(subcommand.prompt);
          if (!resolvedSql) {
            return textResult(
              [
                "No query strategy matched that question.",
                "Use schema-driven flow:",
                "- `date`",
                "- `search <topic>` / `context <topic>` / `describe schema.table`",
                "- `sql SELECT ...` (read-only, single statement)",
              ].join("\n"),
              { ok: false },
            );
          }
          const queryResult = await runConnectorAction({
            instanceId: postgres.id,
            action: "db.query.read",
            args: { sql: resolvedSql },
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`AskDB failed: ${message}`, { ok: false });
      }
    },
  };
}
