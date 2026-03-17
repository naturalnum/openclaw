import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

const MUTATING_SHELL_COMMANDS = new Set([
  "mkdir",
  "cp",
  "mv",
  "rm",
  "touch",
  "ln",
  "install",
  "tee",
  "unzip",
  "tar",
]);
const REDIRECTION_TOKENS = new Set([">", ">>", "1>", "1>>", "2>", "2>>"]);
const VALUE_FLAGS = new Set(["-C", "-d", "-f", "-m", "-o", "-t", "-T", "-g"]);
const WORKSPACE_WIPE_PATTERNS = [
  /(^|\s)rm\b[\s\S]*\s\.\/*(\s|$)/,
  /(^|\s)rm\b[\s\S]*\s\*(\s|$)/,
  /(^|\s)rm\b[\s\S]*\s\.\[\!\.\]\*(\s|$)/,
  /(^|\s)rm\b[\s\S]*\s\.[*?[]/,
  /\bfind\b[\s\S]*\s\.\s[\s\S]*-delete\b/,
  /\bgit\b[\s\S]*\bclean\b[\s\S]*-f/,
  /\brsync\b[\s\S]*--delete\b/,
  /\bfind\b[\s\S]*\s\.\s[\s\S]*-exec\b[\s\S]*\brm\b/,
  /\bfind\b[\s\S]*\s\.\s[\s\S]*-execdir\b[\s\S]*\brm\b/,
] as const;

function normalizeFsPath(value: string): string {
  return path.resolve(value.trim()).replaceAll("\\", "/");
}

function isInsideDir(rootDir: string, candidatePath: string): boolean {
  const root = normalizeFsPath(rootDir);
  const candidate = normalizeFsPath(candidatePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function resolvePathAgainstWorkspace(workspaceDir: string, targetPath: string): string {
  const trimmed = targetPath.trim();
  return path.isAbsolute(trimmed)
    ? normalizeFsPath(trimmed)
    : normalizeFsPath(path.join(workspaceDir, trimmed));
}

function isWorkspaceProtectedPath(workspaceDir: string, targetPath: string): boolean {
  const resolved = resolvePathAgainstWorkspace(workspaceDir, targetPath);
  const protectedDirs = [
    path.join(workspaceDir, "skills"),
    path.join(workspaceDir, "extensions"),
    path.join(workspaceDir, ".agents", "skills"),
    path.join(workspaceDir, ".openclaw", "extensions"),
  ];
  return protectedDirs.some((dir) => isInsideDir(dir, resolved));
}

function tokenizeShell(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function splitShellSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function looksLikePathToken(token: string): boolean {
  if (!token || token === "." || token === "..") {
    return true;
  }
  if (token.startsWith("-")) {
    return false;
  }
  if (
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("~/")
  ) {
    return true;
  }
  return !token.includes("=") && !token.includes("://");
}

function extractCandidatePathsFromSegment(segment: string): string[] {
  const tokens = tokenizeShell(segment);
  if (tokens.length === 0) {
    return [];
  }

  const commandName = path.basename(tokens[0] ?? "").toLowerCase();
  const candidates: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (REDIRECTION_TOKENS.has(token)) {
      const target = tokens[index + 1];
      if (target) {
        candidates.push(target);
      }
      index += 1;
      continue;
    }

    if (commandName === "git" && tokens[index + 1] === "clone") {
      const maybeTarget = tokens.at(-1);
      if (maybeTarget && maybeTarget !== "clone" && !maybeTarget.startsWith("http")) {
        candidates.push(maybeTarget);
      }
      break;
    }

    if (!MUTATING_SHELL_COMMANDS.has(commandName) || index === 0 || !looksLikePathToken(token)) {
      continue;
    }
    const previous = tokens[index - 1] ?? "";
    if (VALUE_FLAGS.has(previous)) {
      continue;
    }
    candidates.push(token);
  }

  return candidates;
}

function resolveShellMutationReason(params: {
  command: string;
  workspaceDir: string;
}): string | null {
  for (const segment of splitShellSegments(params.command)) {
    if (WORKSPACE_WIPE_PATTERNS.some((pattern) => pattern.test(segment))) {
      return `Blocked shell deletion of workspace contents: ${segment}`;
    }
    const tokens = tokenizeShell(segment);
    if (tokens.length === 0) {
      continue;
    }

    const commandName = path.basename(tokens[0] ?? "").toLowerCase();
    const candidates = extractCandidatePathsFromSegment(segment);

    for (const candidate of candidates) {
      const resolved = resolvePathAgainstWorkspace(params.workspaceDir, candidate);
      if (!isInsideDir(params.workspaceDir, resolved)) {
        return `Blocked shell write outside workspace: ${candidate}`;
      }
      if (isWorkspaceProtectedPath(params.workspaceDir, candidate)) {
        return `Blocked shell write to protected workspace path: ${candidate}`;
      }
    }

    if (commandName === "cd" && tokens[1]) {
      const destination = resolvePathAgainstWorkspace(params.workspaceDir, tokens[1]);
      if (!isInsideDir(params.workspaceDir, destination)) {
        return `Blocked shell mutation outside workspace via cd: ${tokens[1]}`;
      }
      continue;
    }
    if (!MUTATING_SHELL_COMMANDS.has(commandName)) {
      continue;
    }
  }

  return null;
}

function extractToolPath(params: Record<string, unknown>): string {
  const direct = ["path", "file", "targetPath"];
  for (const key of direct) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function resolveToolPathReason(params: {
  workspaceDir: string;
  targetPath: string;
}): string | null {
  const resolved = resolvePathAgainstWorkspace(params.workspaceDir, params.targetPath);
  if (!isInsideDir(params.workspaceDir, resolved)) {
    return `Blocked write outside workspace: ${params.targetPath}`;
  }
  if (isWorkspaceProtectedPath(params.workspaceDir, params.targetPath)) {
    return `Blocked write to protected workspace path: ${params.targetPath}`;
  }
  return null;
}

export function patchTouchesReadonlyPath(input: string, workspaceDir: string): string | null {
  const lines = input.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/.exec(line.trim());
    if (!match?.[1]) {
      continue;
    }
    const reason = resolveToolPathReason({
      workspaceDir,
      targetPath: match[1],
    });
    if (reason) {
      return reason;
    }
  }
  return null;
}

function blockProtectedToolWrite(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  workspaceDir: string;
}): { block: true; blockReason: string } | undefined {
  if (params.toolName === "write" || params.toolName === "edit") {
    const targetPath = extractToolPath(params.toolParams);
    if (targetPath) {
      const reason = resolveToolPathReason({
        workspaceDir: params.workspaceDir,
        targetPath,
      });
      if (reason) {
        return {
          block: true,
          blockReason: reason,
        };
      }
    }
  }

  if (params.toolName === "apply_patch") {
    const input = typeof params.toolParams.input === "string" ? params.toolParams.input : "";
    if (input) {
      const reason = patchTouchesReadonlyPath(input, params.workspaceDir);
      if (reason) {
        return {
          block: true,
          blockReason: reason,
        };
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveAgentWorkspaceFromConfig(
  config: OpenClawPluginApi["config"] | undefined,
  agentId: string | undefined,
): string {
  if (!config || !agentId) {
    return "";
  }
  const agents = isRecord(config.agents) ? config.agents : undefined;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  for (const entry of list) {
    if (!isRecord(entry) || entry.id !== agentId) {
      continue;
    }
    return typeof entry.workspace === "string" ? entry.workspace.trim() : "";
  }
  return "";
}

function resolveWorkspaceDir(
  api: OpenClawPluginApi,
  ctx: { workspaceDir?: string; agentId?: string },
): string {
  const direct = ctx.workspaceDir?.trim();
  if (direct) {
    return normalizeFsPath(direct);
  }

  const agentWorkspace = resolveAgentWorkspaceFromConfig(api.config, ctx.agentId);
  if (agentWorkspace) {
    return normalizeFsPath(agentWorkspace);
  }

  const defaultWorkspace = api.config?.agents?.defaults?.workspace?.trim();
  return defaultWorkspace ? normalizeFsPath(defaultWorkspace) : "";
}

const plugin = {
  id: "workspace-guard-plugin",
  name: "Workspace Guard Plugin",
  description:
    "Restricts writes/deletes to the workspace and keeps workspace skills/extensions read-only.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.on("before_tool_call", async (event, ctx) => {
      const workspaceDir = resolveWorkspaceDir(api, ctx);
      const command = typeof event.params?.command === "string" ? event.params.command : "";
      api.logger.info(
        `[workspace-guard-plugin] before_tool_call tool=${event.toolName} workspace=${JSON.stringify(workspaceDir ?? "")} command=${JSON.stringify(command)} session=${ctx.sessionKey ?? ""}`,
      );

      if (!workspaceDir) {
        return;
      }

      const protectedWriteBlock = blockProtectedToolWrite({
        toolName: event.toolName,
        toolParams: event.params,
        workspaceDir,
      });
      if (protectedWriteBlock) {
        api.logger.warn(
          `[workspace-guard-plugin] blocking protected write tool=${event.toolName} reason=${JSON.stringify(protectedWriteBlock.blockReason)}`,
        );
        return protectedWriteBlock;
      }

      if (event.toolName !== "exec" && event.toolName !== "bash") {
        return;
      }
      if (!command) {
        return;
      }

      const reason = resolveShellMutationReason({
        command,
        workspaceDir,
      });
      if (!reason) {
        return;
      }
      api.logger.warn(
        `[workspace-guard-plugin] blocking protected shell mutation command=${JSON.stringify(command)} reason=${JSON.stringify(reason)}`,
      );
      return {
        block: true,
        blockReason: reason,
      };
    });
  },
};

export {
  extractCandidatePathsFromSegment,
  isInsideDir,
  isWorkspaceProtectedPath,
  resolveWorkspaceDir,
  resolvePathAgainstWorkspace,
  resolveShellMutationReason,
  resolveToolPathReason,
};

export default plugin;
