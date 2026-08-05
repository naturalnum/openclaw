import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScriptTestHarness } from "./test-helpers.js";

const bootstrapScript = path.resolve("scripts/agent-bootstrap-config.mjs");

type BootstrapConfig = {
  gateway: {
    mode?: string;
    port?: number;
    bind?: string;
    auth: {
      mode?: string;
      token?: string | Record<string, unknown>;
      rateLimit?: unknown;
      [key: string]: unknown;
    };
    controlUi: {
      root?: string;
      basePath?: string;
      allowedOrigins?: string[];
      dangerouslyDisableDeviceAuth?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  agents?: unknown;
  models?: unknown;
  skills?: unknown;
  plugins?: unknown;
  customProductSetting?: unknown;
  [key: string]: unknown;
};

function formatOriginHost(host: string): string {
  return host.includes(":") ? `[${host.replaceAll("%", "%25")}]` : host;
}

function expectedManagedOrigins(port: number): string[] {
  const hosts = new Set(["localhost", "127.0.0.1"]);
  const hostname = os.hostname().trim();
  if (hostname) {
    hosts.add(hostname);
  }
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      const address = entry.address.trim();
      if (entry.internal || !address || family !== "IPv4") {
        continue;
      }
      hosts.add(address);
    }
  }
  return [...hosts].toSorted().map((host) => `http://${formatOriginHost(host)}:${port}`);
}

function runBootstrap(
  dataDir: string,
  appDir: string,
  port: number,
  envOverrides: NodeJS.ProcessEnv = {},
): void {
  execFileSync(process.execPath, [bootstrapScript, dataDir, appDir, String(port)], {
    env: {
      ...process.env,
      POWER_AGENT_SKILL_CENTER_URL: "",
      POWER_AGENT_SKILL_BOX_URL: "",
      POWER_AGENT_SKILL_CENTER_CLIENT_ID: "",
      POWER_AGENT_SKILL_CENTER_CLIENT_SECRET: "",
      POWER_AGENT_SKILL_CENTER_TOKEN_URL: "",
      POWER_AGENT_SKILL_CENTER_SCOPE: "",
      ...envOverrides,
    },
    stdio: "pipe",
  });
}

function readConfig(dataDir: string): BootstrapConfig {
  return JSON.parse(readFileSync(path.join(dataDir, "openclaw.json"), "utf8")) as BootstrapConfig;
}

describe("agent-bootstrap-config", () => {
  const { createTempDir } = createScriptTestHarness();

  it("creates a fresh LAN config with persistent token auth and current interface origins", () => {
    const root = createTempDir("openclaw-agent-bootstrap-fresh-");
    const dataDir = path.join(root, "data");
    const appDir = path.join(root, "app");
    const port = 19_123;

    runBootstrap(dataDir, appDir, port);

    const config = readConfig(dataDir);
    expect(config.gateway).toMatchObject({
      mode: "local",
      port,
      bind: "lan",
      auth: {
        mode: "token",
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      controlUi: {
        root: path.join(appDir, "dist", "power-ui"),
        dangerouslyDisableDeviceAuth: true,
      },
    });
    expect(config.gateway.controlUi.allowedOrigins).toEqual(expectedManagedOrigins(port));
    expect(config.skills).toEqual({ allowBundled: ["__none__"] });
    expect(statSync(path.join(dataDir, "openclaw.json")).mode & 0o777).toBe(0o600);
  });

  it("persists SkillCenter OAuth settings supplied during first startup", () => {
    const root = createTempDir("openclaw-agent-bootstrap-oauth-");
    const dataDir = path.join(root, "data");
    const appDir = path.join(root, "app");

    runBootstrap(dataDir, appDir, 19_127, {
      POWER_AGENT_SKILL_CENTER_URL: "https://skills.example",
      POWER_AGENT_SKILL_BOX_URL: "http://box.example",
      POWER_AGENT_SKILL_CENTER_CLIENT_ID: "agent-test",
      POWER_AGENT_SKILL_CENTER_CLIENT_SECRET: "test-client-secret", // pragma: allowlist secret
      POWER_AGENT_SKILL_CENTER_TOKEN_URL: "https://auth.example/oauth/token",
      POWER_AGENT_SKILL_CENTER_SCOPE: "read write",
    });

    expect(readConfig(dataDir).skills).toEqual({
      allowBundled: ["__none__"],
      registry: {
        enabled: true,
        baseUrl: "https://skills.example",
        boxBaseUrl: "http://box.example",
        oauth: {
          clientId: "agent-test",
          clientSecret: "test-client-secret", // pragma: allowlist secret
          tokenUrl: "https://auth.example/oauth/token",
          scope: "read write",
        },
        timeoutMs: 10_000,
      },
    });
  });

  it("upgrades an existing config without replacing user models, agents, skills, or token", () => {
    const root = createTempDir("openclaw-agent-bootstrap-upgrade-");
    const dataDir = path.join(root, "data");
    const appDir = path.join(root, "updated-app");
    const configPath = path.join(dataDir, "openclaw.json");
    const port = 19_124;
    const existing = {
      gateway: {
        mode: "local",
        port: 18_790,
        bind: "loopback",
        auth: {
          mode: "none",
          token: "keep-this-token",
          password: "remove-this-obsolete-password",
          rateLimit: { maxAttempts: 7, windowMs: 30_000 },
        },
        controlUi: {
          root: "/old/app/dist/power-ui",
          basePath: "/agent",
          allowedOrigins: ["https://existing.example"],
        },
        remote: { url: "wss://remote.example" },
      },
      agents: {
        defaults: { workspace: "/data/users/admin/default" },
        list: [{ id: "agent-a", workspace: "/data/users/admin/projects/a" }],
      },
      models: {
        mode: "merge",
        providers: { private: { baseUrl: "https://models.example" } },
      },
      skills: {
        registry: { enabled: false, baseUrl: "https://skills.example" },
      },
      plugins: {
        allow: ["power-backend"],
        entries: { "power-backend": { enabled: true } },
      },
      customProductSetting: { keep: true },
    };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    runBootstrap(dataDir, appDir, port);

    const config = readConfig(dataDir);
    expect(config.agents).toEqual(existing.agents);
    expect(config.models).toEqual(existing.models);
    expect(config.skills).toEqual({
      ...existing.skills,
      allowBundled: ["__none__"],
    });
    expect(config.plugins).toEqual(existing.plugins);
    expect(config.customProductSetting).toEqual(existing.customProductSetting);
    expect(config.gateway).toMatchObject({
      mode: "local",
      port,
      bind: "lan",
      auth: {
        mode: "token",
        token: "keep-this-token",
        rateLimit: existing.gateway.auth.rateLimit,
      },
      controlUi: {
        root: path.join(appDir, "dist", "power-ui"),
        basePath: "/agent",
        dangerouslyDisableDeviceAuth: true,
      },
      remote: existing.gateway.remote,
    });
    expect(config.gateway.controlUi.allowedOrigins).toEqual([
      "https://existing.example",
      ...expectedManagedOrigins(port),
    ]);
    expect(config.gateway.auth).not.toHaveProperty("password");
  });

  it("is idempotent across repeated starts", () => {
    const root = createTempDir("openclaw-agent-bootstrap-idempotent-");
    const dataDir = path.join(root, "data");
    const appDir = path.join(root, "app");
    const configPath = path.join(dataDir, "openclaw.json");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          gateway: {
            mode: "local",
            bind: "loopback",
            auth: { mode: "none" },
            controlUi: {},
          },
          preservedAcrossMigration: true,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    runBootstrap(dataDir, appDir, 19_125);
    const first = readFileSync(configPath, "utf8");
    const firstToken = readConfig(dataDir).gateway.auth.token;
    expect(firstToken).toMatch(/^[a-f0-9]{64}$/);

    runBootstrap(dataDir, appDir, 19_125);
    const second = readFileSync(configPath, "utf8");

    expect(second).toBe(first);
    expect(readConfig(dataDir).gateway.auth.token).toBe(firstToken);
  });

  it("preserves a configured SecretRef gateway token", () => {
    const root = createTempDir("openclaw-agent-bootstrap-secret-ref-");
    const dataDir = path.join(root, "data");
    const appDir = path.join(root, "app");
    const configPath = path.join(dataDir, "openclaw.json");
    const tokenRef = {
      source: "env",
      provider: "default",
      id: "POWER_AGENT_GATEWAY_TOKEN",
    };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      configPath,
      `${JSON.stringify({ gateway: { auth: { mode: "token", token: tokenRef } } }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    runBootstrap(dataDir, appDir, 19_126);

    expect(readConfig(dataDir).gateway.auth.token).toEqual(tokenRef);
  });
});
