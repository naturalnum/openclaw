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
import {
  listOwnedConnectorInstances,
  invokeConnectorActionForAccount,
} from "../../connectors/runtime.js";
import type { ConnectorInstance } from "../../connectors/types.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { resolveChannelAccountId } from "./channel-context.js";
import { rejectUnauthorizedCommand } from "./command-gates.js";
import type { CommandHandler } from "./commands-types.js";

function pickActivePostgresInstance(instances: ConnectorInstance[]): ConnectorInstance | null {
  return instances.find((item) => item.providerId === "postgres" && item.enabled) ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const argText = commandBodyNormalized.replace(/^\/askdb\b/i, "").trim();
  const subcommand = parseAskDbSubcommand(argText);

  try {
    if (subcommand.kind === "summary") {
      const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
      if (tables.length === 0) {
        return { shouldContinue: false, reply: { text: "Connected, but no user tables found." } };
      }
      const lines = [
        `Connected to ${postgres.displayName} (${postgres.providerId})`,
        `Found ${tables.length} table(s).`,
        "",
        "Suggested workflow:",
        "1) `/askdb date` — anchor dates on DB clock",
        "2) `/askdb search <topic>` — shortlist tables",
        "3) `/askdb context <topic>` — top 5 tables + columns",
        "4) `/askdb sql SELECT ...` — read-only query",
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
      lines.push("", "Try: /askdb schema", "/askdb search 订单", "/askdb context 订单");
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

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

    if (subcommand.kind === "date") {
      const result = await runReadQuery({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        sql: ASKDB_DATE_ANCHOR_SQL,
      });
      const lines = [
        "AskDB date anchor (from database server clock; use before interpreting “昨天/上周/近7天”):",
      ];
      lines.push(...renderQueryResultRows(result.rows, 24));
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    if (subcommand.kind === "describe") {
      const qualified = parseQualifiedTableName(subcommand.table);
      if (!qualified || !qualified.table) {
        return {
          shouldContinue: false,
          reply: { text: "Usage: /askdb describe <table> or /askdb describe <schema.table>" },
        };
      }
      const desc = await invokeConnectorActionForAccount({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        action: "db.table.describe",
        args: { schema: qualified.schema, table: qualified.table },
      });
      if (!desc.ok) {
        return { shouldContinue: false, reply: { text: `AskDB failed: ${desc.error ?? "describe"}` } };
      }
      const rows = Array.isArray(desc.data)
        ? (desc.data as Array<Record<string, unknown>>)
        : [];
      const lines = [`Columns for ${qualified.schema}.${qualified.table}:`];
      lines.push(...formatColumnDescribeLines(rows));
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    if (subcommand.kind === "search") {
      const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
      if (tables.length === 0) {
        return { shouldContinue: false, reply: { text: "Schema is empty." } };
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
        lines.push(`(${ranked.length} tables total.)`);
      }
      lines.push("", "Next: /askdb context <same query> or /askdb describe schema.table");
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    if (subcommand.kind === "context") {
      const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
      if (tables.length === 0) {
        return { shouldContinue: false, reply: { text: "Schema is empty." } };
      }
      const ranked = scoreTablesForSearch(tables, subcommand.query);
      const topFive = ranked.slice(0, 5);
      const lines = [
        `Top ${topFive.length} table(s) for "${subcommand.query}" with column shapes:`,
      ];
      for (const t of topFive) {
        lines.push("", `## ${t.fullName} (score=${t.score})`);
        const desc = await invokeConnectorActionForAccount({
          ownerAccountId: accountId,
          instanceId: postgres.id,
          action: "db.table.describe",
          args: { schema: t.schema, table: t.table },
        });
        if (!desc.ok) {
          lines.push(`(describe failed: ${desc.error ?? "unknown"})`);
          continue;
        }
        const rows = Array.isArray(desc.data)
          ? (desc.data as Array<Record<string, unknown>>)
          : [];
        lines.push(...formatColumnDescribeLines(rows, 60));
      }
      lines.push("", "Then: /askdb sql SELECT ... (read-only, single statement)");
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    if (subcommand.kind === "sql") {
      const checked = validateReadOnlySelectSql(subcommand.sql);
      if (!checked.ok) {
        return { shouldContinue: false, reply: { text: `Rejected SQL: ${checked.reason}` } };
      }
      const result = await runReadQuery({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        sql: checked.sql,
      });
      const lines = [`AskDB query result (${result.rowCount} row(s)):`];
      lines.push(...renderQueryResultRows(result.rows));
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
      const heuristicSql = await (async () => {
        const plan = enrichAskDbHeuristicPlanWithRetrieve(
          subcommand.prompt,
          buildAskDbHeuristicPlan(subcommand.prompt),
        );
        const tables = await runSchemaList({ ownerAccountId: accountId, instanceId: postgres.id });
        if (tables.length === 0) {
          return null;
        }
        const ranked = scoreTablesForSearch(tables, plan.searchQuery);
        const target = ranked[0];
        if (!target || target.score <= 0) {
          return null;
        }
        const desc = await invokeConnectorActionForAccount({
          ownerAccountId: accountId,
          instanceId: postgres.id,
          action: "db.table.describe",
          args: { schema: target.schema, table: target.table },
        });
        if (!desc.ok) {
          return null;
        }
        const columns = Array.isArray(desc.data)
          ? (desc.data as Array<Record<string, unknown>>)
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
        return {
          shouldContinue: false,
          reply: {
            text:
              "No query strategy matched.\n" +
              "Try: /askdb date → /askdb search <topic> → /askdb context <topic> → /askdb sql SELECT ...",
          },
        };
      }
      const result = await runReadQuery({
        ownerAccountId: accountId,
        instanceId: postgres.id,
        sql: resolvedSql,
      });
      const lines = [`AskDB query result (${result.rowCount} row(s)):`];
      lines.push(...renderQueryResultRows(result.rows));
      return { shouldContinue: false, reply: { text: lines.join("\n") } };
    }

    return { shouldContinue: false, reply: { text: "Unsupported AskDB command." } };
  } catch (error) {
    return {
      shouldContinue: false,
      reply: { text: `AskDB failed: ${toErrorMessage(error)}` },
    };
  }
};
