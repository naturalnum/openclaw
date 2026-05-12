import { describe, expect, it } from "vitest";
import {
  buildAskDbHeuristicPlan,
  buildAskDbTimeFilterSql,
  buildReadOnlySqlFromPrompt,
  createLocalAskDbRetrieveProvider,
  enrichAskDbHeuristicPlanWithRetrieve,
  loadAskDbLocalRetrieveDictionaryFromDisk,
  parseAskDbSubcommand,
  pickAskDbAmountColumn,
  pickAskDbOrgColumn,
  pickAskDbProjectColumn,
  pickAskDbTechDomainColumn,
  pickAskDbTimeColumn,
  scoreTablesForSearch,
  validateReadOnlySelectSql,
} from "./askdb-command-core.js";

describe("parseAskDbSubcommand", () => {
  it("parses summary, schema, date", () => {
    expect(parseAskDbSubcommand("")).toEqual({ kind: "summary" });
    expect(parseAskDbSubcommand("schema")).toEqual({ kind: "schema" });
    expect(parseAskDbSubcommand("DATE")).toEqual({ kind: "date" });
    expect(parseAskDbSubcommand("日历")).toEqual({ kind: "date" });
  });

  it("parses describe, search, context, sql, count", () => {
    expect(parseAskDbSubcommand("describe public.users")).toEqual({
      kind: "describe",
      table: "public.users",
    });
    expect(parseAskDbSubcommand("search order 订单")).toEqual({
      kind: "search",
      query: "order 订单",
    });
    expect(parseAskDbSubcommand("context 销量")).toEqual({
      kind: "context",
      query: "销量",
    });
    expect(parseAskDbSubcommand("sql SELECT 1")).toEqual({
      kind: "sql",
      sql: "SELECT 1",
    });
    expect(parseAskDbSubcommand("count users")).toEqual({
      kind: "count",
      table: "users",
    });
  });

  it("falls back to query prompt", () => {
    expect(parseAskDbSubcommand("近7天完成任务数")).toMatchObject({ kind: "query" });
  });
});

describe("validateReadOnlySelectSql", () => {
  it("accepts single select", () => {
    expect(validateReadOnlySelectSql("  select 1 as x ")).toEqual({
      ok: true,
      sql: "select 1 as x",
    });
  });

  it("rejects multi-statement", () => {
    expect(validateReadOnlySelectSql("select 1; select 2").ok).toBe(false);
  });

  it("rejects insert", () => {
    expect(validateReadOnlySelectSql("insert into t values (1)").ok).toBe(false);
  });
});

describe("scoreTablesForSearch", () => {
  it("ranks substring matches higher", () => {
    const ranked = scoreTablesForSearch(
      [
        { table_schema: "public", table_name: "dim_geo" },
        { table_schema: "analytics", table_name: "orders_daily" },
      ],
      "order",
    );
    expect(ranked[0]?.fullName).toBe("analytics.orders_daily");
  });
});

describe("buildReadOnlySqlFromPrompt", () => {
  it("maps demo task prompt", () => {
    const sql = buildReadOnlySqlFromPrompt("近7天完成任务数");
    expect(sql).toContain("tasks");
    expect(sql).toContain("done");
  });
});

describe("buildAskDbHeuristicPlan", () => {
  it("detects order trend and amount metric", () => {
    const plan = buildAskDbHeuristicPlan("近30天订单金额趋势");
    expect(plan.searchQuery).toContain("orders");
    expect(plan.metric).toBe("sum_amount");
    expect(plan.trendByDay).toBe(true);
    expect(plan.window).toBe("last_30_days");
  });

  it("detects this year top3 tech-domain intent", () => {
    const plan = buildAskDbHeuristicPlan("今年总部项目中项目金额前三的项目的技术领域是什么");
    expect(plan.window).toBe("this_year");
    expect(plan.metric).toBe("sum_amount");
    expect(plan.topN).toBe(3);
    expect(plan.asksTechDomain).toBe(true);
  });
});

describe("column pickers", () => {
  it("picks preferred time and amount columns", () => {
    const rows = [
      { column_name: "id" },
      { column_name: "created_at" },
      { column_name: "total_amount" },
    ];
    expect(pickAskDbTimeColumn(rows)).toBe("created_at");
    expect(pickAskDbAmountColumn(rows)).toBe("total_amount");
  });

  it("picks project and tech-domain columns", () => {
    const rows = [{ column_name: "project_name" }, { column_name: "tech_domain" }];
    expect(pickAskDbProjectColumn(rows)).toBe("project_name");
    expect(pickAskDbTechDomainColumn(rows)).toBe("tech_domain");
  });

  it("picks org columns", () => {
    const rows = [{ column_name: "work_unit_name" }];
    expect(pickAskDbOrgColumn(rows)).toBe("work_unit_name");
  });
});

describe("buildAskDbTimeFilterSql", () => {
  it("builds last 7 days filter by default branch", () => {
    const sql = buildAskDbTimeFilterSql(`"created_at"`, "last_7_days");
    expect(sql).toContain("interval '6 day'");
  });

  it("builds this year filter", () => {
    const sql = buildAskDbTimeFilterSql(`"created_at"`, "this_year");
    expect(sql).toContain("date_trunc('year'");
  });
});

describe("retrieve enrichment", () => {
  it("loads local retrieve dictionary from disk", () => {
    const dictionary = loadAskDbLocalRetrieveDictionaryFromDisk();
    expect(dictionary).not.toBeNull();
    expect(dictionary?.term.length).toBeGreaterThan(0);
  });

  it("enriches search query and constraints from local dictionary", () => {
    const provider = createLocalAskDbRetrieveProvider({
      unit: [{ key: "总部", content: "总部" }],
      award: [],
      domain: [{ key: "人工智能", content: "人工智能" }],
      term: [{ key: "项目金额", content: "project amount total_amount" }],
      example: [],
    });
    const base = buildAskDbHeuristicPlan("今年总部人工智能项目金额前三");
    const enriched = enrichAskDbHeuristicPlanWithRetrieve("今年总部人工智能项目金额前三", base, provider);
    expect(enriched.searchQuery).toContain("total_amount");
    expect(enriched.orgConstraint).toBe("总部");
    expect(enriched.domainConstraint).toBe("人工智能");
  });
});
