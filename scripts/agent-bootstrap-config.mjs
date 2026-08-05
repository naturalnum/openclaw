#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [dataDir, appDir, gatewayPortRaw] = process.argv.slice(2);
if (!dataDir || !appDir || !gatewayPortRaw) {
  throw new Error("usage: agent-bootstrap-config.mjs <data-dir> <app-dir> <gateway-port>");
}

const gatewayPort = Number(gatewayPortRaw);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
  throw new Error(`invalid gateway port: ${gatewayPortRaw}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatOriginHost(host) {
  const normalized = host.trim();
  if (!normalized.includes(":")) {
    return normalized;
  }
  return `[${normalized.replaceAll("%", "%25")}]`;
}

function buildManagedControlUiOrigins(existingOrigins) {
  const origins = new Set(
    Array.isArray(existingOrigins)
      ? existingOrigins.filter((origin) => typeof origin === "string" && origin.trim())
      : [],
  );
  const hosts = new Set(["localhost", "127.0.0.1"]);
  const hostname = os.hostname().trim();
  if (hostname) {
    hosts.add(hostname);
  }
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      const address = entry.address?.trim();
      if (entry.internal || !address || family !== "IPv4") {
        continue;
      }
      hosts.add(address);
    }
  }
  for (const host of [...hosts].toSorted()) {
    origins.add(`http://${formatOriginHost(host)}:${gatewayPort}`);
  }
  return [...origins];
}

function resolvePersistentGatewayToken(auth) {
  if (typeof auth.token === "string" && auth.token.trim()) {
    return auth.token.trim();
  }
  if (isRecord(auth.token)) {
    return auth.token;
  }
  return crypto.randomBytes(32).toString("hex");
}

async function writeManagedConfig(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);
}

const configPath = path.join(dataDir, "openclaw.json");
const skillCenterBaseUrl = process.env.POWER_AGENT_SKILL_CENTER_URL?.trim();
const skillBoxBaseUrl = process.env.POWER_AGENT_SKILL_BOX_URL?.trim();
const skillCenterClientId = process.env.POWER_AGENT_SKILL_CENTER_CLIENT_ID?.trim();
const skillCenterClientSecret = process.env.POWER_AGENT_SKILL_CENTER_CLIENT_SECRET?.trim();
const skillCenterTokenUrl = process.env.POWER_AGENT_SKILL_CENTER_TOKEN_URL?.trim();
const skillCenterScope = process.env.POWER_AGENT_SKILL_CENTER_SCOPE?.trim();
const hasSkillCenterOAuthEnv = Boolean(
  skillCenterClientId || skillCenterClientSecret || skillCenterTokenUrl || skillCenterScope,
);
if (hasSkillCenterOAuthEnv && (!skillCenterClientId || !skillCenterClientSecret)) {
  throw new Error(
    "POWER_AGENT_SKILL_CENTER_CLIENT_ID and POWER_AGENT_SKILL_CENTER_CLIENT_SECRET must be configured together",
  );
}
const skillCenterOAuth =
  skillCenterClientId && skillCenterClientSecret
    ? {
        clientId: skillCenterClientId,
        clientSecret: skillCenterClientSecret,
        ...(skillCenterTokenUrl ? { tokenUrl: skillCenterTokenUrl } : {}),
        scope: skillCenterScope || "read write",
      }
    : undefined;
let existingConfig;
try {
  existingConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
    throw err;
  }
}
if (!existingConfig && skillCenterOAuth && !skillCenterBaseUrl) {
  throw new Error(
    "POWER_AGENT_SKILL_CENTER_URL is required when configuring SkillCenter OAuth on first startup",
  );
}

if (!existingConfig) {
  const usersDir = path.join(dataDir, "users");
  const token = resolvePersistentGatewayToken({});
  const config = {
    gateway: {
      mode: "local",
      port: gatewayPort,
      bind: "lan",
      auth: { mode: "token", token },
      controlUi: {
        root: path.join(appDir, "dist", "power-ui"),
        allowedOrigins: buildManagedControlUiOrigins(),
        // Power Agent is an appliance-style trusted-LAN deployment. Plain HTTP
        // is not a browser secure context, so device identity is unavailable.
        dangerouslyDisableDeviceAuth: true,
      },
    },
    logging: { file: path.join(dataDir, "logs", "openclaw.log") },
    skills: {
      // Power Agent only loads skills installed by SkillCenter or uploaded by
      // users. A non-matching sentinel disables OpenClaw's bundled skill prompts.
      allowBundled: ["__none__"],
      ...(skillCenterBaseUrl || skillBoxBaseUrl
        ? {
            registry: {
              enabled: true,
              ...(skillCenterBaseUrl ? { baseUrl: skillCenterBaseUrl } : {}),
              ...(skillBoxBaseUrl ? { boxBaseUrl: skillBoxBaseUrl } : {}),
              ...(skillCenterOAuth ? { oauth: skillCenterOAuth } : {}),
              timeoutMs: 10_000,
            },
          }
        : {}),
    },
    plugins: {
      allow: ["power-backend"],
      entries: {
        "power-backend": {
          enabled: true,
          config: {
            roots: [usersDir],
            terminal: {
              enabled: true,
              shell: process.env.SHELL || "/bin/bash",
              defaultCwd: usersDir,
              idleTimeoutMs: 1_800_000,
            },
          },
        },
      },
      installs: {},
    },
  };
  await writeManagedConfig(configPath, config);
} else {
  const existingGateway = isRecord(existingConfig.gateway) ? existingConfig.gateway : {};
  const existingAuth = isRecord(existingGateway.auth) ? existingGateway.auth : {};
  const existingControlUi = isRecord(existingGateway.controlUi) ? existingGateway.controlUi : {};
  const { password: _password, ...authWithoutPassword } = existingAuth;
  existingConfig.gateway = {
    ...existingGateway,
    mode: "local",
    port: gatewayPort,
    bind: "lan",
    auth: {
      ...authWithoutPassword,
      mode: "token",
      token: resolvePersistentGatewayToken(existingAuth),
    },
    controlUi: {
      ...existingControlUi,
      root: path.join(appDir, "dist", "power-ui"),
      allowedOrigins: buildManagedControlUiOrigins(existingControlUi.allowedOrigins),
      dangerouslyDisableDeviceAuth: existingControlUi.dangerouslyDisableDeviceAuth ?? true,
    },
  };
  const existingSkills = isRecord(existingConfig.skills) ? existingConfig.skills : {};
  existingConfig.skills = {
    ...existingSkills,
    allowBundled: ["__none__"],
  };
  if (skillCenterBaseUrl || skillBoxBaseUrl || skillCenterOAuth) {
    const existingRegistry = isRecord(existingSkills.registry) ? existingSkills.registry : {};
    existingConfig.skills = {
      ...existingConfig.skills,
      registry: {
        ...existingRegistry,
        enabled: true,
        ...(skillCenterBaseUrl ? { baseUrl: skillCenterBaseUrl } : {}),
        ...(skillBoxBaseUrl ? { boxBaseUrl: skillBoxBaseUrl } : {}),
        ...(skillCenterOAuth ? { oauth: skillCenterOAuth } : {}),
        timeoutMs: existingRegistry.timeoutMs ?? 10_000,
      },
    };
  }
  await writeManagedConfig(configPath, existingConfig);
}
