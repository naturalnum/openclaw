#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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
kill_listeners_on_port 19001
kill_listeners_on_port 19003
kill_listeners_on_port 5174

echo "[dev-stack] starting gateway:dev ..."
pnpm gateway:dev &
GATEWAY_PID=$!

cleanup() {
  if kill -0 "$GATEWAY_PID" >/dev/null 2>&1; then
    echo "[dev-stack] stopping gateway:dev (pid=$GATEWAY_PID) ..."
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

# Give gateway a short head start so power-ui can connect.
sleep 1

echo "[dev-stack] starting power-ui:dev ..."
pnpm power-ui:dev
