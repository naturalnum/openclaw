/**
 * OpenClaw workspace bootstrap / state files (see `src/agents/workspace.ts`).
 * Hidden from Power UI「最近修改」— users care about task outputs, not agent scaffolding.
 */
export const OPENCLAW_WORKSPACE_HIDDEN_FILE_NAMES = new Set(
  [
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
    "MEMORY.md",
    "memory.md",
  ].map((name) => name.toLowerCase()),
);

export const OPENCLAW_WORKSPACE_HIDDEN_DIR_NAMES = new Set([".chat-uploads", ".openclaw"]);

function isRelativeWorkspacePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return false;
  }
  return !/^[a-z]:[\\/]/i.test(trimmed);
}

export function isOpenClawDefaultWorkspaceEntry(entry: {
  name: string;
  kind: "file" | "directory";
  path?: string;
}): boolean {
  const name = entry.name.trim();
  if (!name) {
    return true;
  }
  const pathSegments = (entry.path ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (
    entry.path &&
    isRelativeWorkspacePath(entry.path) &&
    pathSegments.some((segment) => OPENCLAW_WORKSPACE_HIDDEN_DIR_NAMES.has(segment))
  ) {
    return true;
  }
  if (entry.kind === "directory") {
    return OPENCLAW_WORKSPACE_HIDDEN_DIR_NAMES.has(name.toLowerCase());
  }
  return OPENCLAW_WORKSPACE_HIDDEN_FILE_NAMES.has(name.toLowerCase());
}

export function filterUserVisibleWorkspaceEntries<
  T extends { name: string; kind: "file" | "directory" },
>(entries: T[]): T[] {
  return entries.filter((entry) => !isOpenClawDefaultWorkspaceEntry(entry));
}
