/**
 * Resolve common Chinese / English relative date phrases to local calendar
 * half-open ranges [startInclusiveLocalDate, endExclusiveLocalDate).
 * Used like a lightweight "date tool" before NL→SQL.
 */

export type AskDbTimeResolution = {
  phrase: string;
  startInclusiveLocalDate: string;
  endExclusiveLocalDate: string;
  note: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/** Monday = start of ISO-style week in local timezone (Mon 00:00 … next Mon 00:00). */
function startOfLocalWeekMonday(d: Date): Date {
  const sod = startOfLocalDay(d);
  const dow = sod.getDay();
  const daysFromMonday = (dow + 6) % 7;
  return addLocalDays(sod, -daysFromMonday);
}

function startOfLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

type Range = { start: Date; endExclusive: Date; note: string };

function toResolution(phrase: string, r: Range): AskDbTimeResolution {
  return {
    phrase,
    startInclusiveLocalDate: formatLocalYmd(r.start),
    endExclusiveLocalDate: formatLocalYmd(r.endExclusive),
    note: r.note,
  };
}

/**
 * Extract all matching relative-time windows from `text` using `now` as the anchor.
 * Deterministic: patterns are tested in a fixed order; each pattern at most once.
 */
export function extractAskDbTimeResolutions(text: string, now: Date): AskDbTimeResolution[] {
  const t = text.trim();
  if (!t) {
    return [];
  }

  const sod = startOfLocalDay(now);
  const out: AskDbTimeResolution[] = [];
  const seen = new Set<string>();

  const push = (phrase: string, range: Range) => {
    const key = phrase;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(toResolution(phrase, range));
  };

  const yearMatch = t.match(/(20\d{2})年/);
  if (yearMatch?.[1]) {
    const y = Number.parseInt(yearMatch[1], 10);
    if (Number.isFinite(y)) {
      const start = new Date(y, 0, 1);
      const endExclusive = new Date(y + 1, 0, 1);
      push(`${yearMatch[1]}年`, {
        start,
        endExclusive,
        note: "Calendar year from phrase YYYY年 (local date).",
      });
    }
  }

  if (/去年|上一年/.test(t)) {
    const y = sod.getFullYear() - 1;
    push("去年", {
      start: new Date(y, 0, 1),
      endExclusive: new Date(y + 1, 0, 1),
      note: "Previous calendar year (local).",
    });
  }

  if (/今年|本年/.test(t)) {
    const y = sod.getFullYear();
    push("今年", {
      start: new Date(y, 0, 1),
      endExclusive: new Date(y + 1, 0, 1),
      note: "Current calendar year (local).",
    });
  }

  if (/上月|上个月/.test(t)) {
    const firstThis = startOfLocalMonth(sod);
    const endExclusive = firstThis;
    const firstPrev = new Date(firstThis.getFullYear(), firstThis.getMonth() - 1, 1);
    push("上月", {
      start: firstPrev,
      endExclusive,
      note: "Previous calendar month (local).",
    });
  }

  if (/本月|这个月/.test(t)) {
    const start = startOfLocalMonth(sod);
    const endExclusive = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    push("本月", { start, endExclusive, note: "Current calendar month (local)." });
  }

  if (/近30天|最近30天|过去30天|last\s*30\s*days/i.test(t)) {
    const start = addLocalDays(sod, -29);
    const endExclusive = addLocalDays(sod, 1);
    push("近30天", {
      start,
      endExclusive,
      note: "30 local calendar days ending today (inclusive of today).",
    });
  }

  if (/近7天|最近7天|过去7天|last\s*7\s*days/i.test(t)) {
    const start = addLocalDays(sod, -6);
    const endExclusive = addLocalDays(sod, 1);
    push("近7天", {
      start,
      endExclusive,
      note: "7 local calendar days ending today (inclusive of today).",
    });
  }

  if (/上周|上个星期|上星期/.test(t)) {
    const thisMon = startOfLocalWeekMonday(sod);
    const lastMon = addLocalDays(thisMon, -7);
    push("上周", {
      start: lastMon,
      endExclusive: thisMon,
      note: "Previous Mon–Sun week in local timezone.",
    });
  }

  if (/本周|这周|这个星期/.test(t)) {
    const thisMon = startOfLocalWeekMonday(sod);
    const nextMon = addLocalDays(thisMon, 7);
    push("本周", {
      start: thisMon,
      endExclusive: nextMon,
      note: "Current Mon–Sun week in local timezone.",
    });
  }

  if (/前天/.test(t)) {
    const start = addLocalDays(sod, -2);
    const endExclusive = addLocalDays(sod, -1);
    push("前天", { start, endExclusive, note: "Local calendar day before yesterday." });
  }

  if (/昨天|昨日/.test(t)) {
    const start = addLocalDays(sod, -1);
    const endExclusive = sod;
    push("昨天", { start, endExclusive, note: "Previous local calendar day." });
  }

  if (/今天|当日|当天/.test(t)) {
    const endExclusive = addLocalDays(sod, 1);
    push("今天", { start: sod, endExclusive, note: "Current local calendar day." });
  }

  return out;
}
