import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeOptionalString } from "../shared/string-coerce.js";

/** Mirrors postgres connector read-query gate (keep aligned). */
export const READ_ONLY_SQL_PREFIX_RE = /^\s*(select|with|explain)\b/i;

/** Single-row calendar anchor from DB server (for “昨天/上周/近7天”). */
export const ASKDB_DATE_ANCHOR_SQL = `select
  current_timestamp as db_now,
  current_date as today,
  (current_date - interval '1 day')::date as yesterday,
  (current_date - interval '6 day')::date as rolling_7d_start_inclusive,
  current_date as rolling_7d_end_inclusive,
  (date_trunc('week', current_date::timestamp))::date as iso_week_start_monday,
  ((date_trunc('week', current_date::timestamp) + interval '6 day'))::date as iso_week_end_sunday,
  ((date_trunc('week', current_date::timestamp) - interval '7 day'))::date as prev_iso_week_start_monday,
  ((date_trunc('week', current_date::timestamp) - interval '1 day'))::date as prev_iso_week_end_sunday`;

export type AskDbSubcommand =
  | { kind: "summary" }
  | { kind: "schema" }
  | { kind: "date" }
  | { kind: "count"; table: string }
  | { kind: "describe"; table: string }
  | { kind: "search"; query: string }
  | { kind: "context"; query: string }
  | { kind: "sql"; sql: string }
  | { kind: "query"; prompt: string };

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function parseQualifiedTableName(tableInput: string): { schema: string; table: string } | null {
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

export function parseAskDbSubcommand(raw: string): AskDbSubcommand {
  const argText = raw.trim();
  if (!argText) {
    return { kind: "summary" };
  }
  const lower = argText.toLowerCase();
  if (lower === "schema") {
    return { kind: "schema" };
  }
  if (lower === "date" || argText === "日历") {
    return { kind: "date" };
  }
  if (lower.startsWith("describe ")) {
    const table = argText.slice("describe ".length).trim();
    if (table) {
      return { kind: "describe", table };
    }
  }
  if (lower.startsWith("search ")) {
    const query = argText.slice("search ".length).trim();
    if (query) {
      return { kind: "search", query };
    }
  }
  if (lower.startsWith("context ")) {
    const query = argText.slice("context ".length).trim();
    if (query) {
      return { kind: "context", query };
    }
  }
  if (lower.startsWith("sql ")) {
    const sql = argText.slice("sql ".length).trim();
    if (sql) {
      return { kind: "sql", sql };
    }
  }
  if (lower.startsWith("count ")) {
    const table = argText.slice("count ".length).trim();
    if (table) {
      return { kind: "count", table };
    }
  }
  return { kind: "query", prompt: argText };
}

export function normalizeNaturalPrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

/** Demo-only natural language → SQL (tasks/projects templates). */
export function buildReadOnlySqlFromPrompt(prompt: string): string | null {
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

export function validateReadOnlySelectSql(
  sql: string,
): { ok: true; sql: string } | { ok: false; reason: string } {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { ok: false, reason: "SQL is empty" };
  }
  if (trimmed.length > 16_384) {
    return { ok: false, reason: "SQL is too long" };
  }
  if (!READ_ONLY_SQL_PREFIX_RE.test(trimmed)) {
    return { ok: false, reason: "Only SELECT, WITH, or EXPLAIN statements are allowed" };
  }
  const parts = trimmed
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return { ok: false, reason: "Multiple SQL statements are not allowed" };
  }
  return { ok: true, sql: trimmed };
}

function scoreTable(schema: string, table: string, queryRaw: string): number {
  const full = `${schema}.${table}`.toLowerCase();
  const tableLower = table.toLowerCase();
  const schemaLower = schema.toLowerCase();
  const q = queryRaw.trim().toLowerCase();
  let score = 0;
  if (q && full.includes(q)) {
    score += 10;
  }
  const tokens = q.split(/\s+/).filter((t) => t.length >= 1);
  for (const token of tokens) {
    if (token.length >= 2 && full.includes(token)) {
      score += 3;
    }
    if (token.length >= 2 && tableLower.includes(token)) {
      score += 2;
    }
    if (token.length >= 2 && schemaLower.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export type ScoredTable = {
  schema: string;
  table: string;
  fullName: string;
  score: number;
};

export type AskDbMetricKind = "count" | "sum_amount";
export type AskDbTimeWindow =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_year";

export type AskDbHeuristicPlan = {
  searchQuery: string;
  metric: AskDbMetricKind;
  trendByDay: boolean;
  window: AskDbTimeWindow;
  topN: number | null;
  asksTechDomain: boolean;
  orgConstraint: string | null;
  domainConstraint: string | null;
};

export type AskDbRetrieveCategory = "unit" | "award" | "domain" | "term" | "example";
export type AskDbRetrieveHit = { query: string; content: string };
export type AskDbRetrieveProvider = {
  retrieve: (query: string, category: AskDbRetrieveCategory, topK: number) => AskDbRetrieveHit[];
};

export type AskDbLocalRetrieveDictionary = Record<
  AskDbRetrieveCategory,
  Array<{ key: string; content: string }>
>;

const DEFAULT_ASKDB_LOCAL_RETRIEVE_DICTIONARY: AskDbLocalRetrieveDictionary = {
  unit: [
    { key: "总部", content: "总部" },
    { key: "公司总部", content: "总部" },
    { key: "全公司", content: "全公司" },
  ],
  award: [],
  domain: [
    { key: "人工智能", content: "人工智能,AI" },
    { key: "新能源", content: "新能源" },
    { key: "大电网规划运行", content: "大电网规划运行" },
  ],
  term: [
    { key: "项目金额", content: "project amount total_amount payment_amount gmv" },
    { key: "技术领域", content: "tech domain technology_domain tech_field" },
    { key: "总部项目", content: "headquarter hq project" },
  ],
  example: [],
};

const ASKDB_RETRIEVE_DICTIONARY_RELATIVE_PATH = "skills/askdb-analytics/retrieve-dictionary.json";
let cachedAskDbRetrieveDictionary: AskDbLocalRetrieveDictionary | null = null;

function isAskDbRetrieveCategory(value: string): value is AskDbRetrieveCategory {
  return value === "unit" || value === "award" || value === "domain" || value === "term" || value === "example";
}

function normalizeAskDbLocalRetrieveDictionary(raw: unknown): AskDbLocalRetrieveDictionary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const normalized: AskDbLocalRetrieveDictionary = {
    unit: [],
    award: [],
    domain: [],
    term: [],
    example: [],
  };
  for (const [key, value] of Object.entries(input)) {
    if (!isAskDbRetrieveCategory(key) || !Array.isArray(value)) {
      continue;
    }
    normalized[key] = value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as Record<string, unknown>;
        const k = normalizeOptionalString(row.key);
        const c = normalizeOptionalString(row.content);
        if (!k || !c) {
          return null;
        }
        return { key: k, content: c };
      })
      .filter((item): item is { key: string; content: string } => item != null);
  }
  return normalized;
}

function resolveAskDbDictionaryPath(): string {
  return path.join(process.cwd(), ASKDB_RETRIEVE_DICTIONARY_RELATIVE_PATH);
}

export function loadAskDbLocalRetrieveDictionaryFromDisk(): AskDbLocalRetrieveDictionary | null {
  const filePath = resolveAskDbDictionaryPath();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const text = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return normalizeAskDbLocalRetrieveDictionary(parsed);
  } catch {
    return null;
  }
}

function getAskDbLocalRetrieveDictionary(): AskDbLocalRetrieveDictionary {
  if (cachedAskDbRetrieveDictionary) {
    return cachedAskDbRetrieveDictionary;
  }
  cachedAskDbRetrieveDictionary =
    loadAskDbLocalRetrieveDictionaryFromDisk() ?? DEFAULT_ASKDB_LOCAL_RETRIEVE_DICTIONARY;
  return cachedAskDbRetrieveDictionary;
}

export function createLocalAskDbRetrieveProvider(
  dictionary: AskDbLocalRetrieveDictionary = getAskDbLocalRetrieveDictionary(),
): AskDbRetrieveProvider {
  return {
    retrieve(query, category, topK) {
      const normalizedQuery = normalizeNaturalPrompt(query);
      const entries = dictionary[category] ?? [];
      const hits: AskDbRetrieveHit[] = [];
      for (const entry of entries) {
        const key = normalizeNaturalPrompt(entry.key);
        if (!key) {
          continue;
        }
        if (normalizedQuery.includes(key)) {
          hits.push({ query: entry.key, content: entry.content });
        }
      }
      return hits.slice(0, Math.max(1, topK));
    },
  };
}

export const defaultAskDbRetrieveProvider = createLocalAskDbRetrieveProvider();

export function scoreTablesForSearch(
  tables: Array<{ table_schema?: string; table_name?: string }>,
  query: string,
): ScoredTable[] {
  const scored: ScoredTable[] = [];
  for (const item of tables) {
    const schema = normalizeOptionalString(item.table_schema) ?? "public";
    const table = normalizeOptionalString(item.table_name) ?? "";
    if (!table) {
      continue;
    }
    const fullName = `${schema}.${table}`;
    scored.push({
      schema,
      table,
      fullName,
      score: scoreTable(schema, table, query),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
  return scored;
}

export function buildAskDbHeuristicPlan(prompt: string): AskDbHeuristicPlan {
  const text = normalizeNaturalPrompt(prompt);
  const includesAny = (keywords: string[]): boolean => keywords.some((kw) => text.includes(kw));
  const searchTerms: string[] = [];

  if (includesAny(["订单", "交易", "支付单", "order", "trade", "transaction"])) {
    searchTerms.push("orders", "order", "trade", "transaction", "payment");
  }
  if (includesAny(["用户", "会员", "客户", "user", "member", "customer"])) {
    searchTerms.push("users", "user", "member", "customer");
  }
  if (includesAny(["支付", "付费", "充值", "payment", "pay", "paid"])) {
    searchTerms.push("payments", "payment", "pay");
  }
  if (includesAny(["任务", "task"])) {
    searchTerms.push("tasks", "task");
  }
  if (includesAny(["项目", "project"])) {
    searchTerms.push("projects", "project");
  }
  if (includesAny(["总部", "headquarter", "hq"])) {
    searchTerms.push("headquarter", "hq", "总部");
  }
  if (includesAny(["技术领域", "技术方向", "tech", "domain"])) {
    searchTerms.push("tech", "domain", "technology");
  }

  const metric: AskDbMetricKind = includesAny([
    "gmv",
    "交易额",
    "销售额",
    "收入",
    "金额",
    "revenue",
    "amount",
  ])
    ? "sum_amount"
    : "count";
  const trendByDay = includesAny(["趋势", "按天", "daily", "每天", "曲线"]);

  let window: AskDbTimeWindow = "last_7_days";
  if (includesAny(["今天", "today"])) {
    window = "today";
  } else if (includesAny(["昨天", "yesterday"])) {
    window = "yesterday";
  } else if (includesAny(["近30天", "最近30天", "30天", "last 30 days"])) {
    window = "last_30_days";
  } else if (includesAny(["本周", "this week"])) {
    window = "this_week";
  } else if (includesAny(["上周", "last week", "previous week"])) {
    window = "last_week";
  } else if (includesAny(["今年", "本年", "年初至今", "ytd", "this year"])) {
    window = "this_year";
  }

  const topNMatch = text.match(/top\s*(\d{1,2})|前\s*(\d{1,2})/i);
  const topNRaw = topNMatch?.[1] ?? topNMatch?.[2] ?? null;
  const topN = topNRaw ? Number.parseInt(topNRaw, 10) : includesAny(["前三", "top3"]) ? 3 : null;
  const asksTechDomain = includesAny(["技术领域", "技术方向", "tech domain", "technology domain"]);
  const orgConstraint = includesAny(["总部", "公司总部", "headquarter", "hq"]) ? "总部" : null;
  const domainConstraint = asksTechDomain
    ? includesAny(["人工智能", "ai"])
      ? "人工智能"
      : includesAny(["新能源"])
        ? "新能源"
        : null
    : null;

  return {
    searchQuery: searchTerms.length > 0 ? searchTerms.join(" ") : text,
    metric,
    trendByDay,
    window,
    topN: Number.isFinite(topN) && topN != null ? topN : null,
    asksTechDomain,
    orgConstraint,
    domainConstraint,
  };
}

export function enrichAskDbHeuristicPlanWithRetrieve(
  prompt: string,
  basePlan: AskDbHeuristicPlan,
  provider: AskDbRetrieveProvider = defaultAskDbRetrieveProvider,
): AskDbHeuristicPlan {
  const termHits = provider.retrieve(prompt, "term", 3);
  const domainHits = provider.retrieve(prompt, "domain", 3);
  const unitHits = provider.retrieve(prompt, "unit", 3);
  const extraTerms = termHits.map((hit) => hit.content).join(" ");
  const searchQuery = `${basePlan.searchQuery} ${extraTerms}`.trim();
  const domainConstraint = basePlan.domainConstraint ?? (domainHits[0]?.query ?? null);
  const orgConstraint = basePlan.orgConstraint ?? (unitHits[0]?.content ?? null);
  return {
    ...basePlan,
    searchQuery,
    domainConstraint,
    orgConstraint,
  };
}

export function pickAskDbTimeColumn(rows: Array<Record<string, unknown>>): string | null {
  const names = rows
    .map((row) => normalizeOptionalString(row.column_name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());

  const preferred = [
    "created_at",
    "event_time",
    "event_at",
    "ordered_at",
    "paid_at",
    "updated_at",
    "createdon",
    "createdat",
    "date",
    "dt",
    "day",
  ];
  for (const candidate of preferred) {
    const hit = names.find((name) => name === candidate);
    if (hit) {
      return hit;
    }
  }
  return names.find((name) => name.endsWith("_at") || name.endsWith("_time")) ?? null;
}

export function pickAskDbAmountColumn(rows: Array<Record<string, unknown>>): string | null {
  const names = rows
    .map((row) => normalizeOptionalString(row.column_name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  const preferred = [
    "amount",
    "total_amount",
    "pay_amount",
    "payment_amount",
    "gmv",
    "revenue",
    "price",
    "total_price",
    "fee",
  ];
  for (const candidate of preferred) {
    const hit = names.find((name) => name === candidate);
    if (hit) {
      return hit;
    }
  }
  return names.find((name) => name.includes("amount") || name.includes("price")) ?? null;
}

export function buildAskDbTimeFilterSql(timeColumnSql: string, window: AskDbTimeWindow): string {
  if (window === "today") {
    return `${timeColumnSql}::date = current_date`;
  }
  if (window === "yesterday") {
    return `${timeColumnSql}::date = current_date - interval '1 day'`;
  }
  if (window === "last_30_days") {
    return `${timeColumnSql} >= current_date - interval '29 day'`;
  }
  if (window === "this_week") {
    return `${timeColumnSql}::date >= date_trunc('week', current_date::timestamp)::date and ${timeColumnSql}::date < (date_trunc('week', current_date::timestamp)::date + interval '7 day')`;
  }
  if (window === "last_week") {
    return `${timeColumnSql}::date >= (date_trunc('week', current_date::timestamp)::date - interval '7 day') and ${timeColumnSql}::date < date_trunc('week', current_date::timestamp)::date`;
  }
  if (window === "this_year") {
    return `${timeColumnSql}::date >= date_trunc('year', current_date::timestamp)::date and ${timeColumnSql}::date <= current_date`;
  }
  return `${timeColumnSql} >= current_date - interval '6 day'`;
}

export function pickAskDbProjectColumn(rows: Array<Record<string, unknown>>): string | null {
  const names = rows
    .map((row) => normalizeOptionalString(row.column_name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  const preferred = ["project_name", "project", "project_title", "项目名称", "项目"];
  for (const candidate of preferred) {
    const hit = names.find((name) => name === candidate);
    if (hit) {
      return hit;
    }
  }
  return names.find((name) => name.includes("project")) ?? null;
}

export function pickAskDbTechDomainColumn(rows: Array<Record<string, unknown>>): string | null {
  const names = rows
    .map((row) => normalizeOptionalString(row.column_name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  const preferred = ["tech_domain", "technology_domain", "domain", "tech_field", "technical_field", "技术领域"];
  for (const candidate of preferred) {
    const hit = names.find((name) => name === candidate);
    if (hit) {
      return hit;
    }
  }
  return names.find((name) => name.includes("tech") || name.includes("domain")) ?? null;
}

export function pickAskDbOrgColumn(rows: Array<Record<string, unknown>>): string | null {
  const names = rows
    .map((row) => normalizeOptionalString(row.column_name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  const preferred = [
    "org_name",
    "organization_name",
    "work_unit_name",
    "company_name",
    "unit_name",
    "belong_org_name",
    "总部单位",
  ];
  for (const candidate of preferred) {
    const hit = names.find((name) => name === candidate);
    if (hit) {
      return hit;
    }
  }
  return names.find((name) => name.includes("org") || name.includes("unit") || name.includes("company")) ?? null;
}

export function formatColumnDescribeLines(
  rows: Array<Record<string, unknown>>,
  maxLines = 120,
): string[] {
  if (rows.length === 0) {
    return ["(no columns returned)"];
  }
  const lines: string[] = [];
  for (const row of rows.slice(0, maxLines)) {
    const name = String(row.column_name ?? "");
    const type = String(row.data_type ?? "");
    const nullable = String(row.is_nullable ?? "");
    const def = row.column_default != null ? String(row.column_default) : "";
    const defSuffix = def ? ` default=${def}` : "";
    lines.push(`- ${name}: ${type} nullable=${nullable}${defSuffix}`);
  }
  if (rows.length > maxLines) {
    lines.push(`...and ${rows.length - maxLines} more column(s).`);
  }
  return lines;
}
