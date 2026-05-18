import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type UrlAccessGuardConfig = {
  mode: "blocklist" | "allowlist";
  blocklist: string[];
  allowlist: string[];
};

const DEFAULT_BLOCKLIST = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "*.internal",
  "*.local",
  "169.254.*",
  "10.*",
  "192.168.*",
  "172.16.*",
  "172.17.*",
  "172.18.*",
  "172.19.*",
  "172.20.*",
  "172.21.*",
  "172.22.*",
  "172.23.*",
  "172.24.*",
  "172.25.*",
  "172.26.*",
  "172.27.*",
  "172.28.*",
  "172.29.*",
  "172.30.*",
  "172.31.*",
];

// Tools that perform URL access
const URL_TOOLS = new Set(["web_fetch", "web_search", "fetch", "http_request", "curl"]);

// Tool param keys that typically contain URLs
const URL_PARAM_KEYS = ["url", "uri", "endpoint", "href", "target", "address"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfig(value: unknown): UrlAccessGuardConfig {
  const raw = isRecord(value) ? value : {};
  const mode = raw.mode === "allowlist" ? "allowlist" : "blocklist";

  const blocklist = Array.isArray(raw.blocklist)
    ? raw.blocklist
        .filter((entry): entry is string => typeof entry === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const allowlist = Array.isArray(raw.allowlist)
    ? raw.allowlist
        .filter((entry): entry is string => typeof entry === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : [];

  // In blocklist mode, merge user blocklist with defaults
  const mergedBlocklist = [...new Set([...DEFAULT_BLOCKLIST, ...blocklist])];
  return { mode, blocklist: mergedBlocklist, allowlist };
}

function extractHostname(urlStr: string): string | null {
  try {
    // Handle cases where URL might not have a protocol
    const normalized = urlStr.startsWith("http") ? urlStr : `https://${urlStr}`;
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesPattern(hostname: string, pattern: string): boolean {
  const lowerPattern = pattern.toLowerCase();

  // Exact match
  if (hostname === lowerPattern) {
    return true;
  }

  // Wildcard pattern matching (e.g., *.example.com, 192.168.*)
  if (lowerPattern.includes("*")) {
    const regex = new RegExp(
      "^" + lowerPattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]*") + "$",
    );
    return regex.test(hostname);
  }

  // Subdomain matching: pattern "example.com" matches "sub.example.com"
  if (hostname.endsWith(`.${lowerPattern}`)) {
    return true;
  }

  return false;
}

function extractUrlsFromParams(params: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of URL_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      urls.push(value.trim());
    }
  }
  // Also check for URLs in command params (e.g., curl commands)
  if (typeof params.command === "string") {
    const urlMatches = params.command.match(/https?:\/\/[^\s"']+/g);
    if (urlMatches) {
      urls.push(...urlMatches);
    }
  }
  return urls;
}

export function evaluateUrlAccess(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  config: UrlAccessGuardConfig;
}): string | null {
  const { toolName, toolParams, config } = params;

  // Only check URL-related tools
  if (!URL_TOOLS.has(toolName)) {
    return null;
  }

  const urls = extractUrlsFromParams(toolParams);
  if (urls.length === 0) {
    return null;
  }

  for (const url of urls) {
    const hostname = extractHostname(url);
    if (!hostname) {
      continue;
    }

    if (config.mode === "blocklist") {
      // Block if hostname matches any pattern in blocklist
      for (const pattern of config.blocklist) {
        if (matchesPattern(hostname, pattern)) {
          return `blocked URL access to ${hostname} (matches blocklist pattern: ${pattern})`;
        }
      }
    } else {
      // Allowlist mode: block unless hostname matches an allowed pattern
      const allowed = config.allowlist.some((pattern) => matchesPattern(hostname, pattern));
      if (!allowed) {
        return `blocked URL access to ${hostname} (not in allowlist)`;
      }
    }
  }

  return null;
}

export const urlAccessGuardConfigSchema = {
  validate(value: unknown) {
    if (value === undefined) {
      return { ok: true as const, value: undefined };
    }
    if (!isRecord(value)) {
      return { ok: false as const, errors: ["expected config object"] };
    }
    const allowedKeys = new Set(["mode", "blocklist", "allowlist"]);
    const errors: string[] = [];
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        errors.push(`unknown config key: ${key}`);
      }
    }
    if (value.mode !== undefined && value.mode !== "blocklist" && value.mode !== "allowlist") {
      errors.push(`mode must be "blocklist" or "allowlist"`);
    }
    for (const key of ["blocklist", "allowlist"] as const) {
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
      mode: {
        type: "string",
        enum: ["blocklist", "allowlist"],
        description:
          "Filtering mode: blocklist blocks matching URLs, allowlist only permits matching URLs.",
      },
      blocklist: {
        type: "array",
        items: { type: "string" },
        description: "URL domain patterns to block (supports * wildcard).",
      },
      allowlist: {
        type: "array",
        items: { type: "string" },
        description:
          "URL domain patterns to allow (supports * wildcard). Only used in allowlist mode.",
      },
    },
  },
};

const plugin = {
  id: "url-access-guard-plugin",
  name: "URL Access Guard Plugin",
  description: "Controls agent URL access via blocklist/allowlist filtering.",
  configSchema: urlAccessGuardConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = normalizeConfig(api.pluginConfig);
    api.on("before_tool_call", (event): { block: true; blockReason: string } | void => {
      const reason = evaluateUrlAccess({
        toolName: event.toolName,
        toolParams: event.params,
        config,
      });
      if (!reason) {
        return;
      }
      api.logger.warn(
        `[url-access-guard-plugin] blocking tool=${event.toolName} reason=${JSON.stringify(reason)}`,
      );
      return {
        block: true,
        blockReason: `Blocked URL access (${reason})`,
      };
    });
  },
};

export { normalizeConfig };

export default plugin;
