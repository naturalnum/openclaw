import { normalizeAgentId, parseAgentSessionKey } from "../../../../src/routing/session-key.ts";
import { generateUUID } from "../../compat/ui-core.ts";

function truncateWords(input: string, limit: number) {
  return input.trim().split(/\s+/).filter(Boolean).slice(0, limit).join(" ");
}

export function buildPowerSessionKey(projectId: string) {
  const normalizedProjectId = normalizeAgentId(projectId);
  return `agent:${normalizedProjectId}:power:${generateUUID()}`;
}

export function buildSessionLabelFromPrompt(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "New task";
  }
  return truncateWords(collapsed, 8).slice(0, 80);
}

export function looksLikeOpaqueSessionId(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/^[0-9a-f]{12,}$/i.test(normalized)) {
    return true;
  }
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    return true;
  }
  return /^[A-Za-z0-9_-]{20,}$/.test(normalized) && !/[aeiou\u4e00-\u9fff]/i.test(normalized);
}

export function isGeneratedUntitledSessionLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return /^(New conversation|新会话)(\s*[·•-]\s*\d{2}:\d{2})?$/.test(normalized);
}

export function isSystemGeneratedSessionLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/^(system|assistant|tool)\s*:/i.test(normalized)) {
    return true;
  }
  return /^\[(?:19|20)\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\b.*\]/.test(normalized);
}

export function isProtectedMainSessionKey(sessionKey: string) {
  const normalized = sessionKey.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "global") {
    return true;
  }
  return parseAgentSessionKey(normalized)?.rest === "main";
}
