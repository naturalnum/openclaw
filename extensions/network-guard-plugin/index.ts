import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type NetworkGuardConfig = {
  blockedHosts: string[];
  blockedUrlPrefixes: string[];
  blockedCommands: string[];
};

const DEFAULT_BLOCKED_HOSTS = ["example.com"];
const DEFAULT_BLOCKED_URL_PREFIXES = ["https://example.com/"];
const DEFAULT_BLOCKED_COMMANDS = ["curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "telnet"];
const URL_VALUE_KEYS = new Set(["baseUrl", "cdpUrl", "endpoint", "targetUrl", "url", "webhookUrl"]);
type ResolveHostAddresses = (host: string) => Promise<string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function mergeLists(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

function normalizeConfig(value: unknown): NetworkGuardConfig {
  const raw = isRecord(value) ? value : {};
  const blockedHostsExtra = Array.isArray(raw.blockedHosts)
    ? raw.blockedHosts
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeToken)
        .filter(Boolean)
    : [];
  const blockedUrlPrefixesExtra = Array.isArray(raw.blockedUrlPrefixes)
    ? raw.blockedUrlPrefixes
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const blockedCommandsExtra = Array.isArray(raw.blockedCommands)
    ? raw.blockedCommands
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeToken)
        .filter(Boolean)
    : [];
  const blockedHosts = mergeLists(DEFAULT_BLOCKED_HOSTS, blockedHostsExtra);
  const blockedUrlPrefixes = mergeLists(DEFAULT_BLOCKED_URL_PREFIXES, blockedUrlPrefixesExtra);
  const blockedCommands = mergeLists(DEFAULT_BLOCKED_COMMANDS, blockedCommandsExtra);
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

function extractBlockedPrefixHosts(prefixes: string[]): string[] {
  const hosts = new Set<string>();
  for (const prefix of prefixes) {
    try {
      const host = normalizeToken(new URL(prefix).hostname);
      if (host) {
        hosts.add(host);
      }
    } catch {
      continue;
    }
  }
  return [...hosts];
}

async function resolveHostAddressesDefault(host: string): Promise<string[]> {
  if (!host || isIP(host)) {
    return host ? [host] : [];
  }
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    return [...new Set(records.map((record) => record.address))];
  } catch {
    return [];
  }
}

async function buildBlockedAddressSet(
  config: NetworkGuardConfig,
  resolveHostAddresses: ResolveHostAddresses,
): Promise<Map<string, string[]>> {
  const blockedNames = new Set<string>();
  for (const host of config.blockedHosts) {
    blockedNames.add(host);
  }
  for (const host of extractBlockedPrefixHosts(config.blockedUrlPrefixes)) {
    blockedNames.add(host);
  }

  const resolvedEntries = await Promise.all(
    [...blockedNames].map(async (host) => [host, await resolveHostAddresses(host)] as const),
  );
  return new Map(
    resolvedEntries.map(([host, addresses]) => [
      host,
      addresses.filter((address) => Boolean(address)),
    ]),
  );
}

function findBlockedHostMatch(host: string, config: NetworkGuardConfig): string | null {
  const blockedHost = config.blockedHosts.find(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  return blockedHost ? `blocked host: ${blockedHost}` : null;
}

function findBlockedResolvedAddressMatch(
  host: string,
  resolvedBlockedAddresses: Map<string, string[]>,
): string | null {
  if (!host || !isIP(host)) {
    return null;
  }
  for (const [blockedHost, addresses] of resolvedBlockedAddresses) {
    if (addresses.includes(host)) {
      return `blocked resolved host: ${blockedHost}`;
    }
  }
  return null;
}

function matchPathLikePrefix(value: string, prefix: string): boolean {
  return (
    value === prefix ||
    value.startsWith(`${prefix}/`) ||
    value.startsWith(`${prefix}?`) ||
    value.startsWith(`${prefix}#`)
  );
}

function matchesBlockedPrefix(url: string, prefix: string): boolean {
  const normalizedUrl = url.trim();
  const normalizedPrefix = prefix.trim();
  if (!normalizedUrl || !normalizedPrefix) {
    return false;
  }
  if (normalizedUrl.startsWith(normalizedPrefix)) {
    return true;
  }
  const prefixWithoutTrailingSlash = normalizedPrefix.endsWith("/")
    ? normalizedPrefix.slice(0, -1)
    : normalizedPrefix;
  if (!prefixWithoutTrailingSlash) {
    return false;
  }
  if (matchPathLikePrefix(normalizedUrl, prefixWithoutTrailingSlash)) {
    return true;
  }
  try {
    const parsedUrl = new URL(normalizedUrl);
    const parsedPrefix = new URL(prefixWithoutTrailingSlash);
    const urlProtocol = parsedUrl.protocol.toLowerCase();
    const prefixProtocol = parsedPrefix.protocol.toLowerCase();
    const isHttpFamily =
      (urlProtocol === "http:" || urlProtocol === "https:") &&
      (prefixProtocol === "http:" || prefixProtocol === "https:");
    if (!isHttpFamily) {
      return false;
    }
    if (
      parsedUrl.username !== parsedPrefix.username ||
      parsedUrl.password !== parsedPrefix.password ||
      parsedUrl.host.toLowerCase() !== parsedPrefix.host.toLowerCase()
    ) {
      return false;
    }
    return matchPathLikePrefix(
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      `${parsedPrefix.pathname}${parsedPrefix.search}${parsedPrefix.hash}`,
    );
  } catch {
    return false;
  }
}

function matchBlockedUrl(
  url: string,
  config: NetworkGuardConfig,
  resolvedBlockedAddresses: Map<string, string[]>,
): string | null {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return null;
  }
  const blockedPrefix = config.blockedUrlPrefixes.find((prefix) =>
    matchesBlockedPrefix(normalizedUrl, prefix),
  );
  if (blockedPrefix) {
    return `blocked URL prefix: ${blockedPrefix}`;
  }
  const host = parseUrlHost(normalizedUrl);
  if (!host) {
    return null;
  }
  return (
    findBlockedHostMatch(host, config) ??
    findBlockedResolvedAddressMatch(host, resolvedBlockedAddresses)
  );
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

function matchBlockedShellCommand(
  command: string,
  config: NetworkGuardConfig,
  resolvedBlockedAddresses: Map<string, string[]>,
): string | null {
  for (const url of extractShellUrls(command)) {
    const blocked = matchBlockedUrl(url, config, resolvedBlockedAddresses);
    if (blocked) {
      return blocked;
    }
  }
  const hosts = extractShellHosts(command, config.blockedCommands);
  for (const host of hosts) {
    const blocked =
      findBlockedHostMatch(host, config) ??
      findBlockedResolvedAddressMatch(host, resolvedBlockedAddresses);
    if (blocked) {
      return blocked;
    }
  }
  return null;
}

export async function evaluateNetworkToolCall(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  config: NetworkGuardConfig;
  resolveHostAddresses?: ResolveHostAddresses;
}): Promise<string | null> {
  const resolveHostAddresses = params.resolveHostAddresses ?? resolveHostAddressesDefault;
  const resolvedBlockedAddresses = await buildBlockedAddressSet(
    params.config,
    resolveHostAddresses,
  );
  if (params.toolName === "exec" || params.toolName === "bash") {
    const command =
      typeof params.toolParams.command === "string" ? params.toolParams.command.trim() : "";
    return command
      ? matchBlockedShellCommand(command, params.config, resolvedBlockedAddresses)
      : null;
  }

  const urls: string[] = [];
  extractUrlsFromValue(params.toolParams, urls);
  for (const url of urls) {
    const blocked = matchBlockedUrl(url, params.config, resolvedBlockedAddresses);
    if (blocked) {
      return blocked;
    }
  }
  return null;
}

export { normalizeConfig };

const plugin = {
  id: "network-guard-plugin",
  name: "Network Guard Plugin",
  description: "Blocks configured outbound network requests and shell commands.",
  configSchema: networkGuardConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = normalizeConfig(api.pluginConfig);
    api.on("before_tool_call", async (event) => {
      const reason = await evaluateNetworkToolCall({
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
