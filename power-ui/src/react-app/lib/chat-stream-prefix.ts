/** Mirrors Lit workbench trimming so tool-committed text does not duplicate in chat deltas. */

export function trimCommittedPrefixFromText(text: string, prefix: string): string {
  if (!prefix || !text.startsWith(prefix)) {
    return text;
  }
  return text.slice(prefix.length);
}

export function trimCommittedPrefixFromChatMessage(
  message: unknown,
  prefix: string,
  state: "delta" | "final" | "aborted" | "error",
): unknown {
  if (!prefix || (state !== "delta" && state !== "final")) {
    return message;
  }
  if (!message || typeof message !== "object") {
    return message;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.text === "string") {
    return {
      ...record,
      text: trimCommittedPrefixFromText(record.text, prefix),
    };
  }
  if (!Array.isArray(record.content)) {
    return message;
  }
  let trimmed = false;
  const nextContent = record.content.map((item) => {
    if (
      !trimmed &&
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).type === "text" &&
      typeof (item as Record<string, unknown>).text === "string"
    ) {
      trimmed = true;
      return {
        ...(item as Record<string, unknown>),
        text: trimCommittedPrefixFromText((item as Record<string, unknown>).text as string, prefix),
      };
    }
    return item;
  });
  return trimmed
    ? {
        ...record,
        content: nextContent,
      }
    : message;
}
