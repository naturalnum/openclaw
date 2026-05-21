import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import { extractText } from "./message-extract.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const SYNTHETIC_TRANSCRIPT_REPAIR_RESULT =
  "[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.";

const TOOL_ROLES = new Set([
  "tool",
  "toolresult",
  "tool_result",
  "function",
  "tool_use",
  "tooluse",
]);

/** e.g. `2026-05-20 Wednesday 3` from session_status / date anchor tools */
const SESSION_DATE_ANCHOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}\s+(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i;

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.text === "string") {
    return entry.text.trim();
  }
  const extracted = extractText(message);
  return typeof extracted === "string" ? extracted.trim() : "";
}

export function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "assistant") {
    return false;
  }
  if (typeof entry.text === "string") {
    return SILENT_REPLY_PATTERN.test(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && SILENT_REPLY_PATTERN.test(text);
}

function isSyntheticTranscriptRepairToolResult(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "toolresult") {
    return false;
  }
  const text = extractText(message);
  return typeof text === "string" && text.trim() === SYNTHETIC_TRANSCRIPT_REPAIR_RESULT;
}

function isToolRoleMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (TOOL_ROLES.has(role)) {
    return true;
  }
  return (
    typeof entry.toolCallId === "string" ||
    typeof entry.tool_call_id === "string" ||
    typeof entry.toolName === "string" ||
    typeof entry.tool_name === "string"
  );
}

function isRawToolErrorPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes('"status"')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.status !== "error" || typeof parsed.tool !== "string") {
      return false;
    }
    return true;
  } catch {
    return (
      /"status"\s*:\s*"error"/.test(trimmed) &&
      /"tool"\s*:\s*"/.test(trimmed) &&
      (/"error"\s*:\s*"/.test(trimmed) || /"error"\s*:\s*\{/.test(trimmed))
    );
  }
}

function isSessionDateAnchorText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (SESSION_DATE_ANCHOR_PATTERN.test(trimmed)) {
    return true;
  }
  if (/^AskDB date anchor\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isExternalFetchBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("<<<EXTERNAL_UNTRUSTED_CONTENT")) {
    return false;
  }
  return (
    trimmed.includes("SECURITY NOTICE") ||
    trimmed.includes("Web fetch failed") ||
    trimmed.includes("<<<END_EXTERNAL_UNTRUSTED_CONTENT")
  );
}

function isInternalToolNoiseInTranscript(message: unknown): boolean {
  const text = messageText(message);
  if (!text) {
    return false;
  }
  if (isRawToolErrorPayload(text)) {
    return true;
  }
  if (isSessionDateAnchorText(text)) {
    return true;
  }
  if (isExternalFetchBoilerplate(text)) {
    return true;
  }
  return false;
}

/**
 * Whether a transcript message should be hidden from the default chat UI.
 *
 * - `showToolCalls: false` — also hide tool / toolresult rows (render-time).
 * - `showToolCalls` omitted — keep tool rows in history, but still hide internal noise.
 */
export function shouldHideChatMessage(
  message: unknown,
  options?: { showToolCalls?: boolean },
): boolean {
  if (!message || typeof message !== "object") {
    return true;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role === "system") {
    return true;
  }
  if (options?.showToolCalls === false && isToolRoleMessage(message)) {
    return true;
  }
  if (isAssistantSilentReply(message)) {
    return true;
  }
  if (isSyntheticTranscriptRepairToolResult(message)) {
    return true;
  }
  if (isInternalToolNoiseInTranscript(message)) {
    return true;
  }
  return false;
}
