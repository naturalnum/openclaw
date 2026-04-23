#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
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
OPENCLAW_NODE_IMAGE="${OPENCLAW_NODE_IMAGE:-swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:24-bookworm-slim-linuxarm64}"
OPENCLAW_PLATFORM="${OPENCLAW_PLATFORM:-linux/arm64}"
OPENCLAW_NPM_REGISTRY="${OPENCLAW_NPM_REGISTRY:-https://registry.npmmirror.com}"

CTX_DIR="$(mktemp -d /tmp/openclaw-deploy-build.XXXXXX)"

cleanup() {
  rm -rf "${CTX_DIR}"
}
trap cleanup EXIT

echo "==> Building local runtime assets"
(
  cd "${PROJECT_ROOT}"
  export npm_config_registry="${OPENCLAW_NPM_REGISTRY}"
  export NPM_CONFIG_REGISTRY="${OPENCLAW_NPM_REGISTRY}"
  CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --no-frozen-lockfile --reporter=silent
  pnpm build:docker
  pnpm qa:lab:build
  CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --prod --no-frozen-lockfile --reporter=silent
)

restore_deps() {
  (
    cd "${PROJECT_ROOT}"
    export npm_config_registry="${OPENCLAW_NPM_REGISTRY}"
    export NPM_CONFIG_REGISTRY="${OPENCLAW_NPM_REGISTRY}"
    CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --no-frozen-lockfile --reporter=silent
  )
}
trap 'restore_deps; cleanup' EXIT

mkdir -p "${CTX_DIR}"
for item in dist node_modules extensions skills docs qa deploy package.json openclaw.mjs; do
  cp -R "${PROJECT_ROOT}/${item}" "${CTX_DIR}/${item}"
done

BUILD_ARGS=()
for key in OPENCLAW_NODE_IMAGE OPENCLAW_EXTENSIONS OPENCLAW_INSTALL_DOCKER_CLI OPENCLAW_INSTALL_BROWSER OPENCLAW_DOCKER_APT_PACKAGES OPENCLAW_CLAUDE_CODE_VERSION OPENCLAW_APT_MIRROR OPENCLAW_PYPI_INDEX_URL OPENCLAW_NPM_REGISTRY; do
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
