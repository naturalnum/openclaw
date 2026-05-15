import { describe, expect, it } from "vitest";
import { formatAskDbSlotsEnglish, parseAskDbArgText, splitAskDbNaturalLanguage } from "./split.js";

describe("parseAskDbArgText", () => {
  it("parses summary, schema, count, query", () => {
    expect(parseAskDbArgText("")).toEqual({ kind: "summary" });
    expect(parseAskDbArgText("schema")).toEqual({ kind: "schema" });
    expect(parseAskDbArgText("count public.users")).toEqual({ kind: "count", table: "public.users" });
    expect(parseAskDbArgText("近7天")).toEqual({ kind: "query", prompt: "近7天" });
  });
});

describe("splitAskDbNaturalLanguage", () => {
  it("extracts orgs, awards, and buckets domains for project questions", () => {
    const s = splitAskDbNaturalLanguage("2025年新立项了多少个人工智能领域的科研项目？");
    expect(s.unitNames.length).toBe(0);
    expect(s.projectDomains).toContain("人工智能");
  });

  it("routes domain to team when 攻关团队 appears", () => {
    const s = splitAskDbNaturalLanguage("全公司2024年申报了多少人工智能领域的科技攻关团队？");
    expect(s.teamDomains).toContain("人工智能");
    expect(s.projectDomains.length).toBe(0);
  });

  it("includes format output", () => {
    const text = formatAskDbSlotsEnglish(splitAskDbNaturalLanguage("中国电科院2025年获得了国家科学技术奖"));
    expect(text).toContain("中国电科院");
    expect(text).toContain("国家科学技术奖");
  });
});
