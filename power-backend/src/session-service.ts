import crypto from "node:crypto";
import { normalizeAgentId } from "../../src/routing/session-key.ts";
import type { PowerSessionDraft } from "./types.js";

export function buildPowerSessionKey(projectId: string, seed: string) {
  const normalizedProjectId = normalizeAgentId(projectId);
  const normalizedSeed = seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = normalizedSeed || crypto.randomUUID();
  return `agent:${normalizedProjectId}:power:${suffix}`;
}

export function createSessionDraft(params: {
  projectId: string;
  label: string;
  seed?: string;
}): PowerSessionDraft {
  const seed = params.seed?.trim() || crypto.randomUUID();
  return {
    projectId: normalizeAgentId(params.projectId),
    sessionKey: buildPowerSessionKey(params.projectId, seed),
    label: params.label.trim() || "New task",
  };
}
