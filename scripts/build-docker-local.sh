#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-openclaw:local}"
NODE_IMAGE="${2:-hub.rat.dev/node:24-bookworm-slim}"
PLATFORM="${3:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CTX_DIR="$(mktemp -d /tmp/openclaw-docker-ctx.XXXXXX)"

cleanup() {
  rm -rf "$CTX_DIR"
}
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running." >&2
  exit 1
fi

for required in \
  "$REPO_ROOT/dist/index.js" \
  "$REPO_ROOT/dist/control-ui/index.html" \
  "$REPO_ROOT/dist/power-ui/index.html" \
  "$REPO_ROOT/dist/extensions/power-backend/index.mjs" \
  "$REPO_ROOT/default_config/openclaw.json" \
  "$REPO_ROOT/default_config/.env" \
  "$REPO_ROOT/default_config/requirements-openclaw-runtime.txt"; do
  if [[ ! -e "$required" ]]; then
    echo "ERROR: missing required build asset: $required" >&2
    echo "Run: pnpm build:docker && pnpm ui:build && pnpm power-ui:build" >&2
    exit 1
  fi
done

cd "$REPO_ROOT"
CI=true pnpm prune --prod --reporter=silent

mkdir -p "$CTX_DIR/node_modules"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --links --ignore-errors "$REPO_ROOT/node_modules/" "$CTX_DIR/node_modules/" || true
else
  cp -rP "$REPO_ROOT/node_modules/" "$CTX_DIR/node_modules/" 2>/dev/null || true
fi

if [[ -z "$(ls -A "$CTX_DIR/node_modules" 2>/dev/null)" ]]; then
  echo "ERROR: node_modules copy failed." >&2
  exit 1
fi

for item in dist extensions skills docs default_config; do
  cp -r "$REPO_ROOT/$item" "$CTX_DIR/$item"
done
for item in package.json openclaw.mjs Dockerfile.local; do
  cp "$REPO_ROOT/$item" "$CTX_DIR/$item"
done
cp "$CTX_DIR/Dockerfile.local" "$CTX_DIR/Dockerfile"

find "$CTX_DIR/dist" -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete

docker_build_args=(
  --build-arg "NODE_IMAGE=$NODE_IMAGE"
  -t "$IMAGE_TAG"
)

if [[ -n "$PLATFORM" ]]; then
  docker_build_args=(--platform "$PLATFORM" "${docker_build_args[@]}")
fi

docker build "${docker_build_args[@]}" "$CTX_DIR"

CI=true pnpm install --reporter=silent

echo "Built image: $IMAGE_TAG"
