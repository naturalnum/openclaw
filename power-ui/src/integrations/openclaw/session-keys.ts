import { normalizeAgentId } from "../../../../src/routing/session-key.ts";
import { generateUUID } from "../../../../ui/src/ui/uuid.ts";

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
