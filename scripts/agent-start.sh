#!/bin/sh
set -eu

AGENT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="${AGENT_ROOT}/app"
DATA_DIR="${AGENT_ROOT}/data"
RUN_DIR="${DATA_DIR}/run"
PID_FILE="${RUN_DIR}/gateway.pid"
START_LOG="${DATA_DIR}/logs/start.log"

print_access_urls() {
  node - "${gateway_port}" <<'NODE'
const os = require("node:os");
const port = process.argv[2];
const hosts = new Set(["127.0.0.1"]);
const hostname = os.hostname().trim();
if (hostname) {
  hosts.add(hostname);
}
for (const entries of Object.values(os.networkInterfaces())) {
  for (const entry of entries ?? []) {
    const family = String(entry.family);
    const address = entry.address?.trim();
    if (
      entry.internal ||
      !address ||
      (family !== "IPv4" && family !== "4")
    ) {
      continue;
    }
    hosts.add(address);
  }
}
const formatHost = (host) =>
  host.includes(":") ? `[${host.replaceAll("%", "%25")}]` : host;
console.log("Access URLs:");
for (const host of hosts) {
  console.log(`  http://${formatHost(host)}:${port}`);
}
NODE
}

report_started() {
  echo "Power Agent started in background (pid ${gateway_pid})."
  print_access_urls
  echo "Log: ${START_LOG}"
}

mkdir -p \
  "${DATA_DIR}/auth/users" \
  "${DATA_DIR}/users" \
  "${DATA_DIR}/external/claude" \
  "${DATA_DIR}/external/codex" \
  "${DATA_DIR}/logs" \
  "${RUN_DIR}" \
  "${DATA_DIR}/tmp"
chmod 0700 "${DATA_DIR}"

gateway_port=18789
expect_port=0
for arg in "$@"; do
  if [ "${expect_port}" -eq 1 ]; then
    gateway_port="${arg}"
    expect_port=0
    continue
  fi
  case "${arg}" in
    --port) expect_port=1 ;;
    --port=*) gateway_port="${arg#--port=}" ;;
  esac
done

is_gateway_process() {
  checked_pid="$1"
  command_line="$(ps -p "${checked_pid}" -o command= 2>/dev/null || true)"
  case "${command_line}" in
    *openclaw-gateway*|*"${APP_DIR}/openclaw.mjs"*) return 0 ;;
    *) return 1 ;;
  esac
}

is_recorded_agent_process() {
  checked_pid="$1"
  command_line="$(ps -p "${checked_pid}" -o command= 2>/dev/null || true)"
  [ "${command_line}" = "openclaw" ] || is_gateway_process "${checked_pid}"
}

find_gateway_listener_pid() {
  candidate_pids=""
  if command -v lsof >/dev/null 2>&1; then
    candidate_pids="$(lsof -nP -t -iTCP:"${gateway_port}" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
  fi

  # Minimal Linux installations may not include lsof. OpenClaw records the
  # real foreground Gateway PID in its lock file after the CLI respawn, so use
  # that as a portable fallback.
  lock_pids="$(node - "${DATA_DIR}/tmp" "${OPENCLAW_CONFIG_PATH}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [tmpRoot, expectedConfigPath] = process.argv.slice(2);
const matches = [];
let runtimeDirs = [];
try {
  runtimeDirs = fs.readdirSync(tmpRoot, { withFileTypes: true });
} catch {}
for (const runtimeDir of runtimeDirs) {
  if (!runtimeDir.isDirectory() || !runtimeDir.name.startsWith("openclaw-")) {
    continue;
  }
  const runtimePath = path.join(tmpRoot, runtimeDir.name);
  let entries = [];
  try {
    entries = fs.readdirSync(runtimePath, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/^gateway\..+\.lock$/.test(entry.name)) {
      continue;
    }
    const lockPath = path.join(runtimePath, entry.name);
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (
        lock.configPath === expectedConfigPath &&
        Number.isSafeInteger(lock.pid) &&
        lock.pid > 0
      ) {
        matches.push({ pid: lock.pid, mtimeMs: fs.statSync(lockPath).mtimeMs });
      }
    } catch {}
  }
}
for (const match of matches.toSorted((a, b) => b.mtimeMs - a.mtimeMs)) {
  console.log(match.pid);
}
NODE
)"
  candidate_pids="${candidate_pids} ${lock_pids}"
  for candidate_pid in ${candidate_pids}; do
    case "${candidate_pid}" in
      ''|*[!0-9]*) continue ;;
    esac
    if is_gateway_process "${candidate_pid}"; then
      echo "${candidate_pid}"
      return
    fi
  done
}

stop_existing_gateway() {
  gateway_pid=""
  if [ -f "${PID_FILE}" ]; then
    gateway_pid="$(tr -d '[:space:]' < "${PID_FILE}")"
    case "${gateway_pid}" in
      ''|*[!0-9]*) gateway_pid="" ;;
    esac
    if [ -n "${gateway_pid}" ] &&
      { ! kill -0 "${gateway_pid}" 2>/dev/null || ! is_recorded_agent_process "${gateway_pid}"; }; then
      gateway_pid=""
    fi
    if [ -z "${gateway_pid}" ]; then
      rm -f "${PID_FILE}"
    fi
  fi

  # Older packages did not persist the actual Gateway PID. Recover it from the
  # listen port, but only when the process identifies as OpenClaw.
  if [ -z "${gateway_pid}" ]; then
    gateway_pid="$(find_gateway_listener_pid)"
  fi
  if [ -z "${gateway_pid}" ]; then
    return
  fi

  echo "Stopping existing Power Agent (pid ${gateway_pid})..."
  kill -TERM "${gateway_pid}"
  wait_count=0
  while [ "${wait_count}" -lt 60 ]; do
    if ! kill -0 "${gateway_pid}" 2>/dev/null; then
      rm -f "${PID_FILE}"
      return
    fi
    sleep 0.5
    wait_count=$((wait_count + 1))
  done
  echo "Existing process did not stop in time; forcing shutdown."
  kill -KILL "${gateway_pid}" 2>/dev/null || true
  rm -f "${PID_FILE}"
}

export OPENCLAW_STATE_DIR="${DATA_DIR}"
export OPENCLAW_CONFIG_PATH="${DATA_DIR}/openclaw.json"
export OPENCLAW_LOG_FILE="${DATA_DIR}/logs/openclaw.log"
export OPENCLAW_CLAUDE_HOME="${DATA_DIR}/external/claude"
export CLAUDE_CONFIG_DIR="${DATA_DIR}/external/claude"
export CODEX_HOME="${DATA_DIR}/external/codex"
export TMPDIR="${DATA_DIR}/tmp"

cd "${AGENT_ROOT}"
stop_existing_gateway
node "${APP_DIR}/bootstrap-config.mjs" "${DATA_DIR}" "${APP_DIR}" "${gateway_port}"

echo "Starting Power Agent on port ${gateway_port}..."
nohup node "${APP_DIR}/openclaw.mjs" gateway run --allow-unconfigured "$@" \
  >>"${START_LOG}" 2>&1 </dev/null &
gateway_launcher_pid=$!
gateway_pid="${gateway_launcher_pid}"
printf '%s\n' "${gateway_launcher_pid}" > "${PID_FILE}"

wait_count=0
while [ "${wait_count}" -lt 60 ]; do
  gateway_listener_pid="$(find_gateway_listener_pid)"
  if [ -n "${gateway_listener_pid}" ]; then
    gateway_pid="${gateway_listener_pid}"
    printf '%s\n' "${gateway_listener_pid}" > "${PID_FILE}"
    report_started
    exit 0
  elif command -v curl >/dev/null 2>&1 &&
    kill -0 "${gateway_launcher_pid}" 2>/dev/null &&
    is_gateway_process "${gateway_launcher_pid}" &&
    curl -fsS "http://127.0.0.1:${gateway_port}/health" >/dev/null 2>&1; then
    report_started
    exit 0
  elif ! command -v curl >/dev/null 2>&1 && [ "${wait_count}" -ge 4 ] &&
    kill -0 "${gateway_launcher_pid}" 2>/dev/null &&
    is_gateway_process "${gateway_launcher_pid}"; then
    report_started
    exit 0
  fi
  if ! kill -0 "${gateway_launcher_pid}" 2>/dev/null; then
    rm -f "${PID_FILE}"
    echo "Power Agent failed to start. See ${START_LOG}" >&2
    exit 1
  fi
  sleep 0.5
  wait_count=$((wait_count + 1))
done

echo "Power Agent process is running, but port ${gateway_port} did not become ready." >&2
echo "See ${START_LOG}" >&2
exit 1
