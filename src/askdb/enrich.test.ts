import { describe, expect, it } from "vitest";
import { enrichAskDbQuery, formatAskDbEnrichmentJson } from "./enrich.js";

/** Fixed local instant for reproducible calendar math in tests. */
const anchor = new Date(2026, 4, 12, 15, 0, 0);

describe("enrichAskDbQuery", () => {
  it("resolves 近7天 against anchor local date", () => {
    const e = enrichAskDbQuery("近7天人工智能项目", [], { now: anchor });
    const tr = e.timeResolutions.find((r) => r.phrase === "近7天");
    expect(tr).toBeDefined();
    expect(tr!.startInclusiveLocalDate).toBe("2026-05-06");
    expect(tr!.endExclusiveLocalDate).toBe("2026-05-13");
  });

  it("ranks Chinese table names by domain keyword from slots", () => {
    const tables = [
      { table_schema: "dw", table_name: "order_fact" },
      { table_schema: "dw", table_name: "人工智能项目立项" },
    ];
    const e = enrichAskDbQuery("2025年新立项了多少个人工智能领域的科研项目？", tables, {
      now: anchor,
    });
    expect(e.topTableCandidates[0]?.qualifiedName).toBe("dw.人工智能项目立项");
    expect(e.topTableCandidates[0]?.score).toBeGreaterThan(0);
  });

  it("emits deterministic JSON key ordering at top level", () => {
    const e = enrichAskDbQuery("x", [], { now: anchor });
    const j = formatAskDbEnrichmentJson(e);
    expect(j.indexOf('"anchorLocalDate"')).toBeLessThan(j.indexOf('"coarseTableCandidates"'));
    expect(j.indexOf('"coarseTableCandidates"')).toBeLessThan(j.indexOf('"slots"'));
  });
});
