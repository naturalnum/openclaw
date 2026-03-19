export function normalizeSlug(input: unknown): string {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(raw ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

interface SkillLike {
  slug?: unknown;
  displayName?: unknown;
  summary?: unknown;
}

export function scoreHit(skill: SkillLike, q: string): number {
  const slug = String(skill.slug ?? "").toLowerCase();
  const name = String(skill.displayName ?? "").toLowerCase();
  const summary = String(skill.summary ?? "").toLowerCase();
  if (slug === q) return 100;
  if (name === q) return 90;
  if (slug.includes(q)) return 80;
  if (name.includes(q)) return 70;
  if (summary.includes(q)) return 50;
  return 10;
}
