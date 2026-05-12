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

OPENCLAW_IMAGE="${OPENCLAW_IMAGE:-openclaw-power:20260412-v1.1}"
OPENCLAW_DOCKERFILE="${OPENCLAW_DOCKERFILE:-${SCRIPT_DIR}/Dockerfile}"
OPENCLAW_BUILD_CONTEXT="${OPENCLAW_BUILD_CONTEXT:-${PROJECT_ROOT}}"
OPENCLAW_NODE_IMAGE="${OPENCLAW_NODE_IMAGE:-docker.m.daocloud.io/library/node:24-bookworm-slim}"
OPENCLAW_PLATFORM="${OPENCLAW_PLATFORM:-linux/amd64}"
OPENCLAW_NPM_REGISTRY="${OPENCLAW_NPM_REGISTRY:-https://registry.npmmirror.com}"
OPENCLAW_BUILD_MODE="${OPENCLAW_BUILD_MODE:-full}"
OPENCLAW_BUILD_TMP_ROOT="${OPENCLAW_BUILD_TMP_ROOT:-${PROJECT_ROOT}/.tmp}"

if [[ "${OPENCLAW_DOCKERFILE}" != /* ]]; then
  OPENCLAW_DOCKERFILE="${PROJECT_ROOT}/${OPENCLAW_DOCKERFILE#./}"
fi
if [[ "${OPENCLAW_BUILD_CONTEXT}" != /* ]]; then
  OPENCLAW_BUILD_CONTEXT="${PROJECT_ROOT}/${OPENCLAW_BUILD_CONTEXT#./}"
fi

mkdir -p "${OPENCLAW_BUILD_TMP_ROOT}"
CTX_DIR="$(mktemp -d "${OPENCLAW_BUILD_TMP_ROOT%/}/openclaw-deploy-build.XXXXXX")"
SHOULD_RESTORE_DEPS=0

cleanup() {
  rm -rf "${CTX_DIR}"
}

restore_deps() {
  (
    cd "${PROJECT_ROOT}"
    export npm_config_registry="${OPENCLAW_NPM_REGISTRY}"
    export NPM_CONFIG_REGISTRY="${OPENCLAW_NPM_REGISTRY}"
    CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --no-frozen-lockfile --reporter=silent
  )
}

finalize() {
  if [[ "${SHOULD_RESTORE_DEPS}" == "1" ]]; then
    restore_deps
  fi
  cleanup
}
trap finalize EXIT

echo "==> Building local runtime assets (mode: ${OPENCLAW_BUILD_MODE})"
(
  cd "${PROJECT_ROOT}"
  export npm_config_registry="${OPENCLAW_NPM_REGISTRY}"
  export NPM_CONFIG_REGISTRY="${OPENCLAW_NPM_REGISTRY}"
  case "${OPENCLAW_BUILD_MODE}" in
    full)
      CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --no-frozen-lockfile --reporter=silent
      pnpm build:docker
      pnpm qa:lab:build
      CI=true pnpm install --registry "${OPENCLAW_NPM_REGISTRY}" --prod --no-frozen-lockfile --reporter=silent
      ;;
    frontend-only)
      if [[ ! -f "dist/index.js" || ! -f "dist/extensions/power-backend/index.mjs" ]]; then
        echo "ERROR: frontend-only mode requires existing runtime assets (dist/index.js and dist/extensions/power-backend/index.mjs)." >&2
        echo "Run once with OPENCLAW_BUILD_MODE=full, then retry frontend-only." >&2
        exit 1
      fi
      pnpm power-ui:build
      ;;
    *)
      echo "ERROR: unsupported OPENCLAW_BUILD_MODE=${OPENCLAW_BUILD_MODE}. Use 'full' or 'frontend-only'." >&2
      exit 2
      ;;
  esac
)

if [[ "${OPENCLAW_BUILD_MODE}" == "full" ]]; then
  SHOULD_RESTORE_DEPS=1
fi

DOCKER_CONTEXT="${CTX_DIR}"
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
echo "==> Base image: ${OPENCLAW_NODE_IMAGE}"
echo "==> Docker context: ${DOCKER_CONTEXT}"
docker build \
  --platform "${OPENCLAW_PLATFORM}" \
  -f "${OPENCLAW_DOCKERFILE}" \
  -t "${OPENCLAW_IMAGE}" \
  "${BUILD_ARGS[@]}" \
  "${DOCKER_CONTEXT}"
