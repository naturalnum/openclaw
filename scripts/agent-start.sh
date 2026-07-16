#!/bin/sh
set -eu

AGENT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="${AGENT_ROOT}/app"
DATA_DIR="${AGENT_ROOT}/data"
RUN_DIR="${DATA_DIR}/run"
PID_FILE="${RUN_DIR}/gateway.pid"

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
  if [ -z "${gateway_pid}" ] && command -v lsof >/dev/null 2>&1; then
    candidate_pids="$(lsof -nP -t -iTCP:"${gateway_port}" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    for candidate_pid in ${candidate_pids}; do
      case "${candidate_pid}" in
        ''|*[!0-9]*) continue ;;
      esac
      if is_gateway_process "${candidate_pid}"; then
        gateway_pid="${candidate_pid}"
        break
      fi
    done
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
node "${APP_DIR}/bootstrap-config.mjs" "${DATA_DIR}" "${APP_DIR}"
printf '%s\n' "$$" > "${PID_FILE}"
exec node "${APP_DIR}/openclaw.mjs" gateway run --allow-unconfigured "$@"
