import { normalizeAgentId } from "../../../../ui/src/ui/session-key.ts";

const USER_SCOPE_PREFIX = "u";

type LocalUserScopeProfile = {
  id?: string | null;
};

export function buildLocalUserScope(user: LocalUserScopeProfile | null | undefined): string {
  const id = user?.id?.trim();
  if (!id) {
    return "";
  }
  return normalizeAgentId(`${USER_SCOPE_PREFIX}-${id}`);
}

export function buildScopedProjectName(name: string, userScope: string): string {
  const trimmed = name.trim();
  const scope = userScope.trim();
  return scope && trimmed ? `${scope}-${trimmed}` : trimmed;
}

export function stripScopedProjectName(name: string, userScope: string): string {
  const trimmed = name.trim();
  const scope = userScope.trim();
  if (!scope) {
    return trimmed;
  }
  const prefix = `${scope}-`;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed;
  }
  return trimmed.slice(prefix.length).trim() || trimmed;
}

export function isProjectInLocalUserScope(projectId: string, userScope: string): boolean {
  const scope = userScope.trim();
  if (!scope) {
    return true;
  }
  return normalizeAgentId(projectId).startsWith(`${scope}-`);
}

export function buildScopedChatSessionRest(kind: "power" | "quick", userScope: string): string {
  const scope = userScope.trim();
  return scope ? `user:${scope}:${kind}` : kind;
}

export function isSessionInLocalUserScope(sessionKey: string, userScope: string): boolean {
  const scope = userScope.trim();
  if (!scope) {
    return true;
  }
  return sessionKey.toLowerCase().includes(`:user:${scope.toLowerCase()}:`);
}
