import { normalizeAgentId } from "../../../../ui/src/ui/session-key.ts";

const USER_SCOPE_PREFIX = "u";
const LOCAL_USER_AGENT_WORKSPACE_KINDS = new Set(["default", "projects"]);
const LOCAL_USER_PROJECT_WORKSPACE_KINDS = new Set(["projects"]);

type LocalUserScopeProfile = {
  id?: string | null;
};

type LocalUserAgent = {
  id: string;
  workspace?: string | null;
};

export function buildLocalUserScope(user: LocalUserScopeProfile | null | undefined): string {
  const id = user?.id?.trim();
  if (!id) {
    return "";
  }
  return normalizeAgentId(`${USER_SCOPE_PREFIX}-${id}`);
}

function hasLocalUserWorkspaceKind(
  workspace: string | null | undefined,
  userScope: string,
  kinds: ReadonlySet<string>,
): boolean {
  const scope = userScope.trim();
  if (!scope) {
    return true;
  }
  const userId = scope.replace(/^u-/, "").toLowerCase();
  const segments = (workspace ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  for (let index = 0; index + 2 < segments.length; index += 1) {
    if (
      segments[index] === "users" &&
      segments[index + 1] === userId &&
      kinds.has(segments[index + 2])
    ) {
      return true;
    }
  }
  return false;
}

export function isAgentInLocalUserScope(
  workspace: string | null | undefined,
  userScope: string,
): boolean {
  return hasLocalUserWorkspaceKind(workspace, userScope, LOCAL_USER_AGENT_WORKSPACE_KINDS);
}

export function isProjectInLocalUserScope(
  workspace: string | null | undefined,
  userScope: string,
): boolean {
  return hasLocalUserWorkspaceKind(workspace, userScope, LOCAL_USER_PROJECT_WORKSPACE_KINDS);
}

export function resolveLocalUserDefaultAgentId(
  agents: LocalUserAgent[] | null | undefined,
  userScope: string,
): string | null {
  const scope = userScope.trim();
  if (!scope) {
    return agents?.[0]?.id?.trim() || null;
  }
  const userId = scope.replace(/^u-/, "").toLowerCase();
  const marker = `/users/${userId}/default`;
  const match = agents?.find((agent) => {
    const workspace = agent.workspace?.trim().replace(/\\/g, "/").toLowerCase() ?? "";
    return workspace === marker || workspace.endsWith(marker);
  });
  return match?.id?.trim() || null;
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
