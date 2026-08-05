export const UNTITLED_SESSION_DISPLAY_LABEL = "新对话";

export function resolveSessionDisplayLabel(
  label: string | null | undefined,
  sessionKey: string | null | undefined,
): string {
  const normalizedLabel = label?.trim() ?? "";
  const normalizedSessionKey = sessionKey?.trim() ?? "";
  if (!normalizedLabel || normalizedLabel === normalizedSessionKey) {
    return UNTITLED_SESSION_DISPLAY_LABEL;
  }
  return normalizedLabel;
}
