import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

const PROTECTED_PATH_PATTERNS = [
  /(^|[/"'\s])skills(\/|$)/,
  /(^|[/"'\s])\.agents\/skills(\/|$)/,
  /(^|[/"'\s])\.openclaw\/extensions(\/|$)/,
  /\/workspace\/skills(\/|$)/,
  /\/workspace\/\.agents\/skills(\/|$)/,
  /\/workspace\/\.openclaw\/extensions(\/|$)/,
] as const;
const WORKSPACE_ROOT_DELETE_PATTERNS = [
  /(^|[/"'\s])\/workspace\/?($|["'\s])/,
  /(^|[/"'\s])workspace\/?($|["'\s])/,
] as const;
/*受保护路径
skills/...
.agents/skills/...
.openclaw/extensions/...
/workspace/skills/...
/workspace/.agents/skills/...
/workspace/.openclaw/extensions/... 
*/
const MUTATING_SHELL_PATTERNS = [
  /\bmkdir\b/,
  /\bcp\b/,
  /\bmv\b/,
  /\brm\b/,
  /\btouch\b/,
  /\bln\b/,
  /\binstall\b/,
  /\btee\b/,
  /\bcat\b[\s\S]*>/,
  /\becho\b[\s\S]*>/,
  /\bgit\s+clone\b/,
  /\bunzip\b/,
  /\btar\b/,
] as const;

function normalizePathLike(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/");
}

export function isProtectedWorkspacePath(pathLike: string): boolean {
  const normalized = normalizePathLike(pathLike.trim());
  if (!normalized) {
    return false;
  }
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
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

export function patchTouchesProtectedPath(input: string): boolean {
  const lines = input.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/.exec(line.trim());
    if (match?.[1] && isProtectedWorkspacePath(match[1])) {
      return true;
    }
  }
  return false;
}

export function shellCommandMutatesProtectedPath(command: string): boolean {
  const normalized = normalizePathLike(command.trim());
  if (!normalized) {
    return false;
  }
  if (!PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shellCommandDeletesWorkspaceRoot(command: string): boolean {
  const normalized = normalizePathLike(command.trim());
  if (!normalized) {
    return false;
  }
  if (!/\brm\b/.test(normalized)) {
    return false;
  }
  return WORKSPACE_ROOT_DELETE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function blockProtectedToolWrite(
  toolName: string,
  params: Record<string, unknown>,
): { block: true; blockReason: string } | undefined {
  if (toolName === "write" || toolName === "edit") {
    const targetPath = extractToolPath(params);
    if (targetPath && isProtectedWorkspacePath(targetPath)) {
      return {
        block: true,
        blockReason: `Blocked write to protected workspace path: ${targetPath}`,
      };
    }
  }

  if (toolName === "apply_patch") {
    const input = typeof params.input === "string" ? params.input : "";
    if (input && patchTouchesProtectedPath(input)) {
      return {
        block: true,
        blockReason: "Blocked apply_patch touching protected workspace paths",
      };
    }
  }

  return undefined;
}

const plugin = {
  id: "workspace-guard-plugin",
  name: "Workspace Guard Plugin",
  description: "Prevents plugin/skill installation into protected workspace paths.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.on("before_tool_call", async (event, ctx) => {
      const command = typeof event.params?.command === "string" ? event.params.command : "";
      api.logger.info(
        `[workspace-guard-plugin] before_tool_call tool=${event.toolName} command=${JSON.stringify(command)} session=${ctx.sessionKey ?? ""}`,
      );

      const protectedWriteBlock = blockProtectedToolWrite(event.toolName, event.params);
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
      if (shellCommandDeletesWorkspaceRoot(command)) {
        api.logger.warn(
          `[workspace-guard-plugin] blocking workspace root deletion command=${JSON.stringify(command)}`,
        );
        return {
          block: true,
          blockReason: `Blocked shell deletion of workspace root: ${command}`,
        };
      }
      if (shellCommandMutatesProtectedPath(command)) {
        api.logger.warn(
          `[workspace-guard-plugin] blocking protected shell mutation command=${JSON.stringify(command)}`,
        );
        return {
          block: true,
          blockReason: `Blocked shell write to protected workspace path: ${command}`,
        };
      }
    });
  },
};

export default plugin;
