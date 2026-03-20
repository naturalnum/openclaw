import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type HighRiskCommandGuardConfig = {
  blockedCommands: string[];
  blockedSubstrings: string[];
};

const DEFAULT_BLOCKED_COMMANDS = [
  "dd",
  "diskutil",
  "fdisk",
  "halt",
  "init",
  "launchctl",
  "mkfs",
  "mkfs.apfs",
  "mkfs.ext4",
  "mkfs.xfs",
  "parted",
  "poweroff",
  "reboot",
  "sfdisk",
  "shutdown",
  "telinit",
];

const DEFAULT_BLOCKED_SUBSTRINGS = [
  "rm -rf /",
  "rm -fr /",
  "rm -rf /*",
  "rm -fr /*",
  "find / -delete",
  ":(){ :|:& };:",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function mergeNormalizedLists(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

function normalizeConfig(value: unknown): HighRiskCommandGuardConfig {
  const raw = isRecord(value) ? value : {};
  const blockedCommandsExtra = Array.isArray(raw.blockedCommands)
    ? raw.blockedCommands
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeToken)
        .filter(Boolean)
    : [];
  const blockedSubstringsExtra = Array.isArray(raw.blockedSubstrings)
    ? raw.blockedSubstrings
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const blockedCommands = mergeNormalizedLists(DEFAULT_BLOCKED_COMMANDS, blockedCommandsExtra);
  const blockedSubstrings = mergeNormalizedLists(
    DEFAULT_BLOCKED_SUBSTRINGS,
    blockedSubstringsExtra,
  );
  return { blockedCommands, blockedSubstrings };
}

export const highRiskCommandGuardConfigSchema = {
  validate(value: unknown) {
    if (value === undefined) {
      return { ok: true as const, value: undefined };
    }
    if (!isRecord(value)) {
      return { ok: false as const, errors: ["expected config object"] };
    }
    const allowedKeys = new Set(["blockedCommands", "blockedSubstrings"]);
    const errors: string[] = [];
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        errors.push(`unknown config key: ${key}`);
      }
    }
    for (const key of allowedKeys) {
      const candidate = value[key];
      if (candidate === undefined) {
        continue;
      }
      if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== "string")) {
        errors.push(`${key} must be an array of strings`);
      }
    }
    return errors.length > 0 ? { ok: false as const, errors } : { ok: true as const, value };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      blockedCommands: {
        type: "array",
        items: { type: "string" },
        description: "Block shell commands whose executable basename matches one of these values.",
      },
      blockedSubstrings: {
        type: "array",
        items: { type: "string" },
        description: "Block shell commands containing one of these dangerous substrings.",
      },
    },
  },
};

function splitShellSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeShell(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function normalizeCommandName(token: string): string {
  return normalizeToken(path.basename(token));
}

function findCommandName(tokens: string[]): string | null {
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (token === "sudo" || token === "env") {
      continue;
    }
    if (token.includes("=") && !token.startsWith("/") && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }
    return normalizeCommandName(token);
  }
  return null;
}

export function evaluateHighRiskCommand(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  config: HighRiskCommandGuardConfig;
}): string | null {
  if (params.toolName !== "exec" && params.toolName !== "bash") {
    return null;
  }

  const command =
    typeof params.toolParams.command === "string" ? params.toolParams.command.trim() : "";
  if (!command) {
    return null;
  }

  for (const blocked of params.config.blockedSubstrings) {
    if (blocked && command.includes(blocked)) {
      return `blocked dangerous substring: ${blocked}`;
    }
  }

  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeShell(segment);
    const commandName = findCommandName(tokens);
    if (!commandName) {
      continue;
    }
    if (params.config.blockedCommands.includes(commandName)) {
      return `blocked command: ${commandName}`;
    }
  }

  return null;
}

const plugin = {
  id: "high-risk-command-guard-plugin",
  name: "High Risk Command Guard Plugin",
  description: "Blocks configured high-risk shell commands before execution.",
  configSchema: highRiskCommandGuardConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = normalizeConfig(api.pluginConfig);
    api.on("before_tool_call", async (event) => {
      const reason = evaluateHighRiskCommand({
        toolName: event.toolName,
        toolParams: event.params,
        config,
      });
      if (!reason) {
        return;
      }
      const command =
        typeof event.params.command === "string"
          ? ` command=${JSON.stringify(event.params.command)}`
          : "";
      api.logger.warn(
        `[high-risk-command-guard-plugin] blocking tool=${event.toolName} reason=${JSON.stringify(reason)}${command}`,
      );
      return {
        block: true,
        blockReason: `Blocked high-risk command (${reason})`,
      };
    });
  },
};

export { normalizeConfig };

export default plugin;
