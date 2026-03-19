export function safeParseTags(tagsRaw: unknown): string[] {
  if (Array.isArray(tagsRaw)) return tagsRaw as string[];
  if (typeof tagsRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // ignore
    }
  }
  return [];
}
