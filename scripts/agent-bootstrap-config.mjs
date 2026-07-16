#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const [dataDir, appDir] = process.argv.slice(2);
if (!dataDir || !appDir) {
  throw new Error("usage: agent-bootstrap-config.mjs <data-dir> <app-dir>");
}

const configPath = path.join(dataDir, "openclaw.json");
let existingConfig;
try {
  existingConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
    throw err;
  }
}

if (!existingConfig) {
  const usersDir = path.join(dataDir, "users");
  const config = {
    gateway: {
      mode: "local",
      bind: "loopback",
      auth: { mode: "none" },
      controlUi: { root: path.join(appDir, "dist", "power-ui") },
    },
    logging: { file: path.join(dataDir, "logs", "openclaw.log") },
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
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
} else {
  // Power Agent has its own local-user login and only exposes the Gateway on loopback.
  // Remove the redundant shared-token gate so a normal UI launch can connect after login.
  existingConfig.gateway ??= {};
  const auth = existingConfig.gateway.auth;
  if (auth?.mode !== "none" || auth.token !== undefined || auth.password !== undefined) {
    existingConfig.gateway.auth = { mode: "none" };
    await fs.writeFile(configPath, `${JSON.stringify(existingConfig, null, 2)}\n`, { mode: 0o600 });
  }
}
