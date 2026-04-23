#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${PROJECT_ROOT}/.." && pwd)"
DEPLOY_CLAUDE_CODE_ROOT="${WORKSPACE_ROOT}/deploy_claude_code"
BUILD_ENV_FILE="${SCRIPT_DIR}/build.env"

if [[ -f "${BUILD_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${BUILD_ENV_FILE}"
  set +a
fi

OPENCLAW_IMAGE="${OPENCLAW_IMAGE:-openclaw-power:20260412-v1.0}"
OPENCLAW_DOCKERFILE="${OPENCLAW_DOCKERFILE:-${SCRIPT_DIR}/Dockerfile}"
OPENCLAW_BUILD_CONTEXT="${OPENCLAW_BUILD_CONTEXT:-${PROJECT_ROOT}}"
OPENCLAW_NODE_IMAGE="${OPENCLAW_NODE_IMAGE:-node:24-bookworm-slim}"
OPENCLAW_PLATFORM="${OPENCLAW_PLATFORM:-linux/arm64}"

CTX_DIR="$(mktemp -d /tmp/openclaw-deploy-build.XXXXXX)"

cleanup() {
  rm -rf "${CTX_DIR}"
}
trap cleanup EXIT

echo "==> Building local runtime assets"
(
  cd "${PROJECT_ROOT}"
CI=true pnpm install --no-frozen-lockfile --reporter=silent
  pnpm build:docker
  pnpm qa:lab:build
  CI=true pnpm install --prod --no-frozen-lockfile --reporter=silent
)

restore_deps() {
  (
    cd "${PROJECT_ROOT}"
CI=true pnpm install --no-frozen-lockfile --reporter=silent
  )
}
trap 'restore_deps; cleanup' EXIT

mkdir -p "${CTX_DIR}"
for item in dist node_modules extensions skills docs qa deploy package.json openclaw.mjs; do
  cp -R "${PROJECT_ROOT}/${item}" "${CTX_DIR}/${item}"
done

if [[ ! -d "${DEPLOY_CLAUDE_CODE_ROOT}" ]]; then
  echo "ERROR: deploy_claude_code not found at ${DEPLOY_CLAUDE_CODE_ROOT}" >&2
  exit 1
fi

cp -R "${DEPLOY_CLAUDE_CODE_ROOT}" "${CTX_DIR}/deploy_claude_code"

BUILD_ARGS=()
for key in OPENCLAW_NODE_IMAGE OPENCLAW_EXTENSIONS OPENCLAW_INSTALL_DOCKER_CLI OPENCLAW_INSTALL_BROWSER OPENCLAW_DOCKER_APT_PACKAGES; do
  value="${!key:-}"
  if [[ -n "${value}" ]]; then
    BUILD_ARGS+=(--build-arg "${key}=${value}")
  fi
done

echo "==> Building Docker image ${OPENCLAW_IMAGE}"
docker build \
  --platform "${OPENCLAW_PLATFORM}" \
  -f "${OPENCLAW_DOCKERFILE}" \
  -t "${OPENCLAW_IMAGE}" \
  "${BUILD_ARGS[@]}" \
  "${CTX_DIR}"

restore_deps
trap cleanup EXIT
