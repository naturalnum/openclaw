import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type NetworkGuardConfig = {
  blockedHosts: string[];
  blockedUrlPrefixes: string[];
  blockedCommands: string[];
};

const DEFAULT_BLOCKED_COMMANDS = ["curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "telnet"];
const URL_VALUE_KEYS = new Set(["baseUrl", "cdpUrl", "endpoint", "targetUrl", "url", "webhookUrl"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeConfig(value: unknown): NetworkGuardConfig {
  const raw = isRecord(value) ? value : {};
  const blockedHosts = Array.isArray(raw.blockedHosts)
    ? raw.blockedHosts
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeToken)
        .filter(Boolean)
    : [];
  const blockedUrlPrefixes = Array.isArray(raw.blockedUrlPrefixes)
    ? raw.blockedUrlPrefixes
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const blockedCommands = Array.isArray(raw.blockedCommands)
    ? raw.blockedCommands
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeToken)
        .filter(Boolean)
    : DEFAULT_BLOCKED_COMMANDS;
  return { blockedHosts, blockedUrlPrefixes, blockedCommands };
}

export const networkGuardConfigSchema = {
  validate(value: unknown) {
    if (value === undefined) {
      return { ok: true as const, value: undefined };
    }
    if (!isRecord(value)) {
      return { ok: false as const, errors: ["expected config object"] };
    }
    const allowedKeys = new Set(["blockedHosts", "blockedUrlPrefixes", "blockedCommands"]);
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
      blockedHosts: {
        type: "array",
        items: { type: "string" },
        description: "Block requests whose URL host matches one of these hostnames or IPs.",
      },
      blockedUrlPrefixes: {
        type: "array",
        items: { type: "string" },
        description: "Block requests whose URL starts with one of these prefixes.",
      },
      blockedCommands: {
        type: "array",
        items: { type: "string" },
        description: "Shell commands to inspect for network targets.",
      },
    },
  },
};

function extractUrlsFromValue(value: unknown, out: string[], path: string[] = []): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const key = path.at(-1) ?? "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      out.push(trimmed);
    } else if (URL_VALUE_KEYS.has(key) && trimmed) {
      out.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractUrlsFromValue(entry, out, path);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    extractUrlsFromValue(entry, out, [...path, key]);
  }
}

function parseUrlHost(value: string): string | null {
  try {
    return normalizeToken(new URL(value).hostname);
  } catch {
    return null;
  }
}

function matchBlockedUrl(url: string, config: NetworkGuardConfig): string | null {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return null;
  }
  const blockedPrefix = config.blockedUrlPrefixes.find((prefix) =>
    normalizedUrl.startsWith(prefix),
  );
  if (blockedPrefix) {
    return `blocked URL prefix: ${blockedPrefix}`;
  }
  const host = parseUrlHost(normalizedUrl);
  if (!host) {
    return null;
  }
  const blockedHost = config.blockedHosts.find(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  return blockedHost ? `blocked host: ${blockedHost}` : null;
}

const URL_REGEX = /\bhttps?:\/\/[^\s"'`]+/g;

function extractShellUrls(command: string): string[] {
  return command.match(URL_REGEX) ?? [];
}

function extractShellHosts(command: string, allowedCommands: string[]): string[] {
  const tokens = command
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }
  const commandName = normalizeToken(tokens[0]!.replace(/^.*\//, ""));
  if (!allowedCommands.includes(commandName)) {
    return [];
  }
  const hosts: string[] = [];
  for (const token of tokens.slice(1)) {
    if (!token || token.startsWith("-")) {
      continue;
    }
    if (token.startsWith("http://") || token.startsWith("https://")) {
      continue;
    }
    const sshLike = token.match(/^(?:[^@\s]+@)?([a-z0-9.-]+|\[[0-9a-f:]+\])(?::.*)?$/i);
    if (sshLike?.[1]) {
      hosts.push(sshLike[1].replace(/^\[/, "").replace(/\]$/, "").toLowerCase());
      break;
    }
  }
  return hosts;
}

function matchBlockedShellCommand(command: string, config: NetworkGuardConfig): string | null {
  for (const url of extractShellUrls(command)) {
    const blocked = matchBlockedUrl(url, config);
    if (blocked) {
      return blocked;
    }
  }
  const hosts = extractShellHosts(command, config.blockedCommands);
  for (const host of hosts) {
    const blockedHost = config.blockedHosts.find(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
    if (blockedHost) {
      return `blocked host: ${blockedHost}`;
    }
  }
  return null;
}

export function evaluateNetworkToolCall(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  config: NetworkGuardConfig;
}): string | null {
  if (params.toolName === "exec" || params.toolName === "bash") {
    const command =
      typeof params.toolParams.command === "string" ? params.toolParams.command.trim() : "";
    return command ? matchBlockedShellCommand(command, params.config) : null;
  }

  const urls: string[] = [];
  extractUrlsFromValue(params.toolParams, urls);
  for (const url of urls) {
    const blocked = matchBlockedUrl(url, params.config);
    if (blocked) {
      return blocked;
    }
  }
  return null;
}

const plugin = {
  id: "network-guard-plugin",
  name: "Network Guard Plugin",
  description: "Blocks configured outbound network requests and shell commands.",
  configSchema: networkGuardConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = normalizeConfig(api.pluginConfig);
    api.on("before_tool_call", async (event) => {
      const reason = evaluateNetworkToolCall({
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
        `[network-guard-plugin] blocking tool=${event.toolName} reason=${JSON.stringify(reason)}${command}`,
      );
      return {
        block: true,
        blockReason: `Blocked network access (${reason})`,
      };
    });
  },
};

export default plugin;
