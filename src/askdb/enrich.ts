import {
  extractAskDbTimeResolutions,
  formatLocalYmd,
  type AskDbTimeResolution,
} from "./time-anchor.js";
import {
  collectKeywordsFromSlots,
  rankSchemaTablesByKeywords,
  type AskDbTableRank,
  type SchemaTableRow,
} from "./table-hints.js";
import { splitAskDbNaturalLanguage, type AskDbSlots } from "./split.js";

export type AskDbQueryEnrichment = {
  anchorLocalDate: string;
  slots: AskDbSlots;
  timeResolutions: AskDbTimeResolution[];
  coarseTableCandidates: AskDbTableRank[];
  topTableCandidates: AskDbTableRank[];
};

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Rule split + relative date anchor + schema table lexical rank (coarse/top).
 * Does not execute SQL. Intended input for LLM / external RAG.
 */
export function enrichAskDbQuery(
  prompt: string,
  schemaTables: readonly SchemaTableRow[],
  options?: { now?: Date; coarseLimit?: number; fineLimit?: number },
): AskDbQueryEnrichment {
  const now = options?.now ?? new Date();
  const slots = splitAskDbNaturalLanguage(prompt);
  const keywords = collectKeywordsFromSlots(slots);
  const { coarse, top } = rankSchemaTablesByKeywords(keywords, schemaTables, {
    coarseLimit: options?.coarseLimit,
    fineLimit: options?.fineLimit,
  });

  return {
    anchorLocalDate: formatLocalYmd(now),
    slots,
    timeResolutions: extractAskDbTimeResolutions(slots.rawQuestion, now),
    coarseTableCandidates: coarse,
    topTableCandidates: top,
  };
}

export function formatAskDbEnrichmentEnglish(e: AskDbQueryEnrichment): string {
  const lines: string[] = [
    "AskDB enrichment (rules + local date anchor + schema name rank; no SQL executed):",
    `- anchorLocalDate: ${e.anchorLocalDate}`,
    "",
    "Slots:",
    `- rawQuestion: ${e.slots.rawQuestion}`,
    `- unitNames: ${e.slots.unitNames.length ? e.slots.unitNames.join(", ") : "(none)"}`,
    `- awardNames: ${e.slots.awardNames.length ? e.slots.awardNames.join(", ") : "(none)"}`,
    `- projectDomains: ${e.slots.projectDomains.length ? e.slots.projectDomains.join(", ") : "(none)"}`,
    `- achievementDomains: ${e.slots.achievementDomains.length ? e.slots.achievementDomains.join(", ") : "(none)"}`,
    `- expertDomains: ${e.slots.expertDomains.length ? e.slots.expertDomains.join(", ") : "(none)"}`,
    `- teamDomains: ${e.slots.teamDomains.length ? e.slots.teamDomains.join(", ") : "(none)"}`,
    "",
  ];

  if (e.timeResolutions.length === 0) {
    lines.push("Time anchor: (no common relative phrases detected)", "");
  } else {
    lines.push("Time anchor (local calendar half-open [start, end)):");
    for (const tr of e.timeResolutions) {
      lines.push(
        `- [${tr.phrase}] ${tr.startInclusiveLocalDate} .. ${tr.endExclusiveLocalDate} — ${tr.note}`,
      );
    }
    lines.push("");
  }

  lines.push(`Table hints — top ${e.topTableCandidates.length} (lexical overlap with slots/question):`);
  for (const row of e.topTableCandidates) {
    const mt = row.matchedTokens.length ? row.matchedTokens.join("; ") : "(no keyword hit)";
    lines.push(`- ${row.qualifiedName} (score=${row.score}) — ${mt}`);
  }
  lines.push("");
  lines.push(
    `Coarse pool (first ${e.coarseTableCandidates.length} by rank): ${e.coarseTableCandidates.map((r) => r.qualifiedName).join(", ")}`,
  );
  lines.push(
    "",
    "Next: join with your data dictionary or internal docs (or a RAG index) to refine 20→5-style table choice, then read-only SQL. Use /askdb count <schema.table> to verify row counts.",
  );

  return lines.join("\n");
}

export function formatAskDbEnrichmentJson(e: AskDbQueryEnrichment): string {
  return stableStringify(e);
}
