import type { AskDbSlots } from "./split.js";

export type SchemaTableRow = {
  table_schema?: string;
  table_name?: string;
};

export type AskDbTableRank = {
  qualifiedName: string;
  score: number;
  matchedTokens: string[];
};

function normalizeOptional(s: string | undefined, fallback: string): string {
  const v = s?.trim();
  return v && v.length > 0 ? v : fallback;
}

function qualifiedName(row: SchemaTableRow): string {
  const schema = normalizeOptional(row.table_schema, "public");
  const table = normalizeOptional(row.table_name, "<unknown>");
  return `${schema}.${table}`;
}

/** Collect search needles from slots + raw question (deduped, stable order). */
export function collectKeywordsFromSlots(slots: AskDbSlots): string[] {
  const raw = slots.rawQuestion.trim();
  const bag: string[] = [
    ...slots.unitNames,
    ...slots.awardNames,
    ...slots.projectDomains,
    ...slots.achievementDomains,
    ...slots.expertDomains,
    ...slots.teamDomains,
  ];
  if (raw.length >= 2) {
    bag.push(raw);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of bag) {
    const k = item.trim();
    if (k.length < 2) {
      continue;
    }
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  // Longer needles first so substring checks in scoring prefer meaningful hits.
  return out.toSorted((a, b) => b.length - a.length || a.localeCompare(b));
}

function isMostlyAscii(s: string): boolean {
  return !/[\u0080-\uFFFF]/.test(s);
}

function scoreTable(qualified: string, keywords: readonly string[]): AskDbTableRank {
  const haystackMixed = qualified;
  const haystackAscii = qualified.toLowerCase();
  const matched = new Set<string>();
  let score = 0;

  for (const kw of keywords) {
    if (kw.length < 2) {
      continue;
    }
    const hit = isMostlyAscii(kw)
      ? haystackAscii.includes(kw.toLowerCase())
      : haystackMixed.includes(kw);
    if (hit) {
      matched.add(kw);
      score += kw.length;
    }
  }

  const matchedTokens = [...matched].toSorted((a, b) => a.localeCompare(b));
  return { qualifiedName: qualified, score, matchedTokens };
}

/**
 * Rank schema tables by lexical overlap with keywords (slots + raw question).
 * Returns coarse (default 20) and top (default 5) lists, deterministic.
 */
export function rankSchemaTablesByKeywords(
  keywords: readonly string[],
  tables: readonly SchemaTableRow[],
  params?: { coarseLimit?: number; fineLimit?: number },
): { coarse: AskDbTableRank[]; top: AskDbTableRank[] } {
  const coarseLimit = params?.coarseLimit ?? 20;
  const fineLimit = params?.fineLimit ?? 5;

  let ranked = tables
    .map((row) => scoreTable(qualifiedName(row), keywords))
    .toSorted((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.qualifiedName.localeCompare(b.qualifiedName);
    });

  if (ranked.length > 0 && ranked.every((r) => r.score === 0)) {
    ranked = ranked.toSorted((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  }

  return {
    coarse: ranked.slice(0, coarseLimit),
    top: ranked.slice(0, fineLimit),
  };
}
