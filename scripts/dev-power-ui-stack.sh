#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
POWER_BACKEND_DIR="$ROOT_DIR/power-backend"

ensure_power_backend_plugin_path() {
  OPENCLAW_POWER_BACKEND_DIR="$POWER_BACKEND_DIR" node <<'NODE'
const fs = require("node:fs");
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

echo "[dev-stack] starting power-ui:dev (default React at http://127.0.0.1:5174/, legacy Lit at /lit.html, gateway ws://127.0.0.1:18789) ..."
if [[ -n "$GATEWAY_TOKEN" ]]; then
  echo "[dev-stack] one-shot connect URL:"
  echo "  http://127.0.0.1:5174/?gatewayUrl=ws://127.0.0.1:18789&token=${GATEWAY_TOKEN}#/"
else
  echo "[dev-stack] set gateway token in Settings → 连接 (gateway auth mode=token)"
fi
pnpm power-ui:dev
