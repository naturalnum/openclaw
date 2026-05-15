/**
 * AskDB: parse `/askdb` command line and split natural-language questions into
 * structured slots (v0 rule-based). SQL generation is intentionally not done here.
 */

export type AskDbSubcommand =
  | { kind: "summary" }
  | { kind: "schema" }
  | { kind: "count"; table: string }
  | { kind: "query"; prompt: string };

/** Mirrors the Dify NER slots shape; values are best-effort until an LLM step exists. */
export type AskDbSlots = {
  rawQuestion: string;
  unitNames: string[];
  awardNames: string[];
  projectDomains: string[];
  achievementDomains: string[];
  expertDomains: string[];
  teamDomains: string[];
};

const DOMAIN_TERMS = [
  "人工智能",
  "新能源",
  "大电网规划运行",
  "数智化赋能",
  "车网互动",
  "网络安全",
  "直流配网",
  "5G通信",
  "安全稳定控制",
  "类脑",
  "高电压",
] as const;

const AWARD_TERMS = [
  "国家科学技术奖",
  "中国专利奖",
  "中国标准创新贡献奖",
  "公司科技奖",
  "省级科技奖",
  "社会科技奖",
  "标准创新贡献奖",
  "标准奖",
] as const;

const ORG_SNIPPETS = [
  "中国电科院",
  "国家电网公司",
  "国家电网",
  "国网",
  "全公司",
  "清华大学",
  "北京大学",
  "华北电力大学",
  "华为",
  "国网能研院",
  "国网经研院",
  "国网南瑞",
] as const;

const PRO_FIELD_DELETE_FUZZY = [
  "自管",
  "在研",
  "指南",
  "任务制",
  "人才培育支持",
  "未来产业",
  "海外院",
  "非共识",
  "海外合作",
  "技改",
  "实验室技改",
] as const;

const PRO_FIELD_DELETE_ACCURATE = [
  "总部",
  "国家",
  "公司",
  "基础研究",
  "基础",
  "基础类",
  "应用",
  "应用类",
  "应用基础类",
  "应用基础",
  "管理",
  "总部管理",
  "科技",
  "总部科技",
  "合作",
] as const;

const ACH_FIELD_DELETE_ACCURATE = ["专著", "学术", "发明"] as const;

export function parseAskDbArgText(argText: string): AskDbSubcommand {
  const trimmed = argText.trim();
  if (!trimmed) {
    return { kind: "summary" };
  }
  if (trimmed === "schema") {
    return { kind: "schema" };
  }
  if (trimmed.toLowerCase().startsWith("count ")) {
    const table = trimmed.slice("count ".length).trim();
    if (table) {
      return { kind: "count", table };
    }
  }
  return { kind: "query", prompt: trimmed };
}

function collectHits(text: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  for (const t of terms) {
    if (text.includes(t)) {
      hits.push(t);
    }
  }
  return hits;
}

function filterProjectDomains(candidates: string[]): string[] {
  const out: string[] = [];
  for (const raw of candidates) {
    let keep = true;
    for (const j of PRO_FIELD_DELETE_ACCURATE) {
      if (j === raw) {
        keep = false;
        break;
      }
    }
    if (!keep) {
      continue;
    }
    for (const j of PRO_FIELD_DELETE_FUZZY) {
      if (raw.includes(j)) {
        keep = false;
        break;
      }
    }
    if (keep) {
      out.push(raw);
    }
  }
  return out;
}

function filterAchievementDomains(candidates: string[]): string[] {
  const out: string[] = [];
  for (const raw of candidates) {
    let drop = false;
    for (const j of ACH_FIELD_DELETE_ACCURATE) {
      if (j === raw) {
        drop = true;
        break;
      }
    }
    if (!drop) {
      out.push(raw);
    }
  }
  return out;
}

/**
 * Rule-based slot fill (v0). Does not call models. Domains are bucketed with simple
 * keyword priority: 攻关团队 > 专家 > 成果 > 项目.
 */
export function splitAskDbNaturalLanguage(prompt: string): AskDbSlots {
  const rawQuestion = prompt.trim();
  const text = rawQuestion;

  const unitNames = collectHits(text, ORG_SNIPPETS);
  const awardNames = collectHits(text, AWARD_TERMS);
  const domainHits = collectHits(text, DOMAIN_TERMS);

  const hasTeam = /攻关团队|科技攻关/.test(text);
  const hasExpert = /专家|科研人员|首席|职称|正高级|副高级/.test(text);
  const hasAchievement = /专利|论文|软著|专著|成果|著作权|论著/.test(text);
  const hasProject = /项目|立项|经费|指南|验收|在研|总部|国家项目|公司项目/.test(text);

  let projectDomains: string[] = [];
  let achievementDomains: string[] = [];
  let expertDomains: string[] = [];
  let teamDomains: string[] = [];

  if (hasTeam) {
    teamDomains = [...domainHits];
  } else if (hasExpert) {
    expertDomains = [...domainHits];
  } else if (hasAchievement) {
    achievementDomains = filterAchievementDomains(domainHits);
  } else if (hasProject) {
    projectDomains = filterProjectDomains(domainHits);
  } else {
    projectDomains = filterProjectDomains(domainHits);
  }

  return {
    rawQuestion,
    unitNames,
    awardNames,
    projectDomains,
    achievementDomains,
    expertDomains,
    teamDomains,
  };
}

export function formatAskDbSlotsEnglish(slots: AskDbSlots): string {
  const lines = [
    "AskDB question split (rule-based v0; no SQL executed):",
    `- rawQuestion: ${slots.rawQuestion}`,
    `- unitNames: ${slots.unitNames.length ? slots.unitNames.join(", ") : "(none detected)"}`,
    `- awardNames: ${slots.awardNames.length ? slots.awardNames.join(", ") : "(none detected)"}`,
    `- projectDomains: ${slots.projectDomains.length ? slots.projectDomains.join(", ") : "(none)"}`,
    `- achievementDomains: ${slots.achievementDomains.length ? slots.achievementDomains.join(", ") : "(none)"}`,
    `- expertDomains: ${slots.expertDomains.length ? slots.expertDomains.join(", ") : "(none)"}`,
    `- teamDomains: ${slots.teamDomains.length ? slots.teamDomains.join(", ") : "(none)"}`,
    "",
    "Next: merge with your data dictionary or internal docs (files, wiki, RAG) to refine table choice, then read-only SQL. For live schema + slots + dates together, use NL `/askdb` query mode (ASKDB_JSON). For row counts: /askdb count <schema.table>",
  ];
  return lines.join("\n");
}
