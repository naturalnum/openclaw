#!/usr/bin/env bash
set -euo pipefail

CLAUDE_HOME="${OPENCLAW_CLAUDE_HOME:-/home/node/.claude}"
CLAUDE_TEMPLATE_PATH="${CLAUDE_HOME}/settings.json.template"
CLAUDE_CONFIG_PATH="${CLAUDE_HOME}/settings.json"

mkdir -p "${CLAUDE_HOME}"

if [[ ! -f "/home/node/.claude.json" ]]; then
  printf '{}\n' > /home/node/.claude.json
fi

claude_auth_token="${OPENCLAW_CLAUDE_AUTH_TOKEN:-${OPENCLAW_CLAUDE_API_KEY:-${DEEPSEEK_API_KEY:-}}}"

if [[ -f "${CLAUDE_TEMPLATE_PATH}" ]]; then
  python3 - "${CLAUDE_TEMPLATE_PATH}" "${CLAUDE_CONFIG_PATH}" <<'PY'
import json
import os
import sys

template_path, output_path = sys.argv[1], sys.argv[2]

with open(template_path, "r", encoding="utf-8") as handle:
    template = json.load(handle)

mapping = {
    "__OPENCLAW_CLAUDE_BASE_URL__": os.environ.get(
        "OPENCLAW_CLAUDE_BASE_URL",
        "https://api.deepseek.com/anthropic",
    ),
    "__OPENCLAW_CLAUDE_AUTH_TOKEN__": os.environ.get(
        "OPENCLAW_CLAUDE_AUTH_TOKEN",
        os.environ.get(
            "OPENCLAW_CLAUDE_API_KEY",
            os.environ.get("DEEPSEEK_API_KEY", ""),
        ),
    ),
    "__OPENCLAW_CLAUDE_API_KEY__": os.environ.get(
        "OPENCLAW_CLAUDE_API_KEY",
        os.environ.get("DEEPSEEK_API_KEY", ""),
    ),
    "__OPENCLAW_CLAUDE_MODEL__": os.environ.get("OPENCLAW_CLAUDE_MODEL", "deepseek-chat"),
    "__OPENCLAW_CLAUDE_SMALL_FAST_MODEL__": os.environ.get(
        "OPENCLAW_CLAUDE_SMALL_FAST_MODEL",
        os.environ.get("OPENCLAW_CLAUDE_MODEL", "deepseek-chat"),
    ),
    "__OPENCLAW_CLAUDE_DISABLE_NONESSENTIAL_TRAFFIC__": os.environ.get(
        "OPENCLAW_CLAUDE_DISABLE_NONESSENTIAL_TRAFFIC",
        "true",
    ),
    "__OPENCLAW_CLAUDE_AUTO_UPDATER_DISABLED__": "1",
}

def resolve(value):
    if isinstance(value, dict):
        return {key: resolve(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [resolve(item) for item in value]
    if isinstance(value, str) and value in mapping:
        return mapping[value]
    return value

rendered = resolve(template)

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(rendered, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
fi

if [[ -z "${claude_auth_token}" ]]; then
  echo "[openclaw-deploy] WARNING: claude provider auth token is empty; 'claude' command will not work until OPENCLAW_CLAUDE_AUTH_TOKEN, OPENCLAW_CLAUDE_API_KEY, or DEEPSEEK_API_KEY is set." >&2
fi

exec "$@"
