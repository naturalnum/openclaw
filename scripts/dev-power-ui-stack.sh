#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
POWER_BACKEND_DIR="$ROOT_DIR/power-backend"

ensure_power_backend_plugin_path() {
  OPENCLAW_POWER_BACKEND_DIR="$POWER_BACKEND_DIR" node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const backendPath = process.env.OPENCLAW_POWER_BACKEND_DIR?.trim() ?? "";
const configPath = path.join(
  process.env.OPENCLAW_HOME?.trim() || path.join(process.env.HOME || "", ".openclaw"),
  "openclaw.json",
);

if (!backendPath || !fs.existsSync(backendPath)) {
  console.error("[dev-stack] missing power-backend at", backendPath || "(unset)");
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  console.error("[dev-stack] failed to read", configPath, error);
  process.exit(1);
}

cfg.plugins ??= {};
cfg.plugins.load ??= {};
const paths = Array.isArray(cfg.plugins.load.paths) ? [...cfg.plugins.load.paths] : [];
if (!paths.includes(backendPath)) {
  paths.push(backendPath);
  cfg.plugins.load.paths = paths;
  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  console.log("[dev-stack] added plugins.load.paths:", backendPath);
}

const gatewayPort = 18789;
const uiPort = 5174;
const hosts = new Set(["localhost", "127.0.0.1"]);
const hostname = os.hostname().trim();
if (hostname) {
  hosts.add(hostname);
}
for (const entries of Object.values(os.networkInterfaces())) {
  for (const entry of entries ?? []) {
    const family = String(entry.family);
    const address = entry.address?.trim();
    if (entry.internal || !address || (family !== "IPv4" && family !== "4")) {
      continue;
    }
    hosts.add(address);
  }
}
const formatOriginHost = (host) => (host.includes(":") ? `[${host}]` : host);
const requiredOrigins = [];
for (const host of hosts) {
  for (const port of [gatewayPort, uiPort]) {
    requiredOrigins.push(`http://${formatOriginHost(host)}:${port}`);
  }
}

cfg.gateway ??= {};
const existingToken = cfg.gateway?.auth?.token ?? cfg.gateway?.token;
const managedToken =
  typeof existingToken === "string" && existingToken.trim()
    ? existingToken.trim()
    : existingToken && typeof existingToken === "object" && !Array.isArray(existingToken)
      ? existingToken
      : crypto.randomBytes(32).toString("hex");
cfg.gateway.mode = "local";
cfg.gateway.port = gatewayPort;
cfg.gateway.bind = "lan";
cfg.gateway.auth = {
  mode: "token",
  token: managedToken,
};
cfg.gateway.controlUi = {
  ...cfg.gateway.controlUi,
  allowedOrigins: [
    ...new Set([
      ...(Array.isArray(cfg.gateway.controlUi?.allowedOrigins)
        ? cfg.gateway.controlUi.allowedOrigins.filter(
            (origin) => typeof origin === "string" && origin.trim(),
          )
        : []),
      ...requiredOrigins,
    ]),
  ],
  // nStart is a trusted-LAN developer workflow served over plain HTTP.
  // Production deployments should prefer HTTPS and device identity.
  dangerouslyDisableDeviceAuth: true,
};
fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
console.log(
  `[dev-stack] configured LAN gateway on port ${gatewayPort}; allowed UI origins: ${requiredOrigins.join(", ")}`,
);
NODE
}

ensure_power_backend_plugin_path

kill_listeners_on_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi
  echo "[dev-stack] port $port in use, killing listeners: $pids"
  # shellcheck disable=SC2086
  kill -9 $pids >/dev/null 2>&1 || true
}

echo "[dev-stack] preflight: freeing common dev ports ..."
kill_listeners_on_port 18789
kill_listeners_on_port 19001
kill_listeners_on_port 19003
kill_listeners_on_port 5174

start_gateway_supervisor() {
  while true; do
    echo "[dev-stack] starting gateway (default ~/.openclaw config, not --dev) ..."
    if pnpm gateway:local; then
      status=0
    else
      status=$?
    fi
    echo "[dev-stack] gateway exited (status=$status); restarting in 1s ..."
    sleep 1
  done
}

start_gateway_supervisor &
GATEWAY_SUPERVISOR_PID=$!

cleanup() {
  if kill -0 "$GATEWAY_SUPERVISOR_PID" >/dev/null 2>&1; then
    echo "[dev-stack] stopping gateway supervisor (pid=$GATEWAY_SUPERVISOR_PID) ..."
    kill "$GATEWAY_SUPERVISOR_PID" >/dev/null 2>&1 || true
    local children
    children="$(pgrep -P "$GATEWAY_SUPERVISOR_PID" 2>/dev/null || true)"
    if [[ -n "$children" ]]; then
      # shellcheck disable=SC2086
      kill $children >/dev/null 2>&1 || true
    fi
  fi
}

trap cleanup EXIT INT TERM

# Give gateway a short head start so power-ui can connect.
sleep 3

GATEWAY_TOKEN="$(
  node -e "
    const fs = require('node:fs');
    const path = require('node:path');
    const home = process.env.OPENCLAW_HOME?.trim() || path.join(process.env.HOME || '', '.openclaw');
    const configPath = path.join(home, 'openclaw.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const token = cfg?.gateway?.auth?.token ?? cfg?.gateway?.token ?? '';
      process.stdout.write(String(token).trim());
    } catch {
      process.stdout.write('');
    }
  "
)"

echo "[dev-stack] starting power-ui:dev (React at http://127.0.0.1:5174/, legacy Lit at /lit.html) ..."
echo "[dev-stack] remote browsers should open http://<this-machine-ip>:5174/ and sign in with a local user."
if [[ -z "$GATEWAY_TOKEN" ]]; then
  echo "[dev-stack] warning: gateway token was not found after LAN configuration." >&2
fi
pnpm power-ui:dev
