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

export const OPENCLAW_WORKSPACE_HIDDEN_DIR_NAMES = new Set([".openclaw"]);

export function isOpenClawDefaultWorkspaceEntry(entry: {
  name: string;
  kind: "file" | "directory";
}): boolean {
  const name = entry.name.trim();
  if (!name) {
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
