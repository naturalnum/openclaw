export type ChatStreamSegment = { text: string; ts: number };

/** 工具切分前保存的是「截至当时的整段流式文本」，后段往往包含前段，只保留非前缀片段。 */
export function dedupeCumulativeStreamSegments(segments: ChatStreamSegment[]): ChatStreamSegment[] {
  if (segments.length <= 1) {
    return segments;
  }
  const sorted = [...segments].toSorted((a, b) => a.ts - b.ts);
  const kept: ChatStreamSegment[] = [];
  for (const segment of sorted) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }
    const subsumedByLater = sorted.some(
      (other) =>
        other.ts > segment.ts &&
        other.text.trim().startsWith(text) &&
        other.text.trim().length > text.length,
    );
    if (!subsumedByLater) {
      kept.push(segment);
    }
  }
  return kept;
}

/** 当前流式正文去掉已展示过的前缀，避免与历史片段重复。 */
export function streamTextAfterPrefix(stream: string, prefix: string): string {
  const body = stream.trim();
  const head = prefix.trim();
  if (!body) {
    return "";
  }
  if (!head) {
    return body;
  }
  if (body.startsWith(head)) {
    return body.slice(head.length).trim();
  }
  return body;
}
