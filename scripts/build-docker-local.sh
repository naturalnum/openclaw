#!/usr/bin/env bash
# Build a Docker image from local pre-built dist/ artifacts, skipping the
# full in-container compile pipeline (Bun install, pnpm build, etc.).
#
# Usage:
#   ./scripts/build-docker-local.sh [IMAGE_TAG] [NODE_IMAGE]
#
# Examples:
#   ./scripts/build-docker-local.sh
#   ./scripts/build-docker-local.sh openclaw:local
#   ./scripts/build-docker-local.sh openclaw:local hub.rat.dev/node:24-bookworm-slim
#
# Requirements:
#   - dist/ must exist (run pnpm build:docker && pnpm ui:build first if missing)
#   - Docker must be running

set -euo pipefail

IMAGE_TAG="${1:-openclaw:local}"
NODE_IMAGE="${2:-hub.rat.dev/node:24-bookworm-slim}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CTX_DIR="$(mktemp -d /tmp/openclaw-docker-ctx.XXXXXX)"

cleanup() {
  echo "→ Cleaning up build context: $CTX_DIR"
  rm -rf "$CTX_DIR"
}
trap cleanup EXIT

echo "========================================"
echo "  OpenClaw local Docker image builder"
echo "========================================"
echo "  Image tag : $IMAGE_TAG"
echo "  Node image : $NODE_IMAGE"
echo "  Repo root  : $REPO_ROOT"
echo "========================================"
echo ""

# ── 0. Preflight checks ─────────────────────────────────────────────────────
echo "→ Checking Docker daemon..."
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Please start Docker Desktop." >&2
  exit 1
fi

echo "→ Checking dist/ directory..."
if [ ! -d "$REPO_ROOT/dist" ] || [ -z "$(ls -A "$REPO_ROOT/dist" 2>/dev/null)" ]; then
  echo "ERROR: dist/ is missing or empty. Run 'pnpm build:docker && pnpm ui:build' first." >&2
  exit 1
fi

# ── 1. Prune dev dependencies ────────────────────────────────────────────────
echo "→ Pruning dev dependencies (pnpm prune --prod)..."
cd "$REPO_ROOT"
CI=true pnpm prune --prod --reporter=silent
echo "   Done."

# ── helper: simple spinner for commands without native progress ──────────────
spinner() {
  local pid=$1 msg=$2
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local frame="${frames:$((i % ${#frames})):1}"
    printf "\r  %s %s" "$frame" "$msg"
    sleep 0.1
    i=$((i + 1))
  done
  printf "\r  ✓ %-60s\n" "$msg"
}

# ── 2. Stage build context ───────────────────────────────────────────────────
echo "→ Staging build context to $CTX_DIR ..."

# node_modules: use rsync with progress; skip broken symlinks from pnpm prune
# --progress is used instead of --info=progress2 (macOS rsync is old and lacks it)
mkdir -p "$CTX_DIR/node_modules"
if command -v rsync > /dev/null 2>&1 && rsync --info=progress2 /dev/null /dev/null 2>/dev/null; then
  echo "  Copying node_modules (rsync --info=progress2)..."
  rsync -a --links --ignore-errors --info=progress2 \
    "$REPO_ROOT/node_modules/" "$CTX_DIR/node_modules/" || true
elif command -v rsync > /dev/null 2>&1; then
  echo "  Copying node_modules (rsync)..."
  rsync -a --links --ignore-errors \
    "$REPO_ROOT/node_modules/" "$CTX_DIR/node_modules/" &
  spinner $! "Copying node_modules"
else
  echo "  Copying node_modules (cp)..."
  cp -rP "$REPO_ROOT/node_modules/" "$CTX_DIR/node_modules/" 2>/dev/null &
  spinner $! "Copying node_modules"
fi
# Verify node_modules was actually copied; abort if empty
if [ -z "$(ls -A "$CTX_DIR/node_modules" 2>/dev/null)" ]; then
  echo "ERROR: node_modules copy failed — $CTX_DIR/node_modules is empty." >&2
  exit 1
fi

# remaining assets with individual progress lines
for item in dist extensions skills docs default_config; do
  printf "  Copying %-20s" "$item/ ..."
  cp -r "$REPO_ROOT/$item" "$CTX_DIR/$item"
  echo "done"
done
for item in package.json openclaw.mjs; do
  printf "  Copying %-20s" "$item ..."
  cp "$REPO_ROOT/$item" "$CTX_DIR/$item"
  echo "done"
done
cp "$REPO_ROOT/Dockerfile.local" "$CTX_DIR/Dockerfile"

# Strip .d.ts / .map from dist (mirrors runtime-assets stage in main Dockerfile)
echo "→ Stripping type declarations and source maps from dist/..."
find "$CTX_DIR/dist" -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete &
spinner $! "Stripping .d.ts / .map files"

# ── 3. Build image ───────────────────────────────────────────────────────────
echo "→ Building Docker image: $IMAGE_TAG (linux/amd64) ..."
docker build \
  --platform linux/amd64 \
  --build-arg NODE_IMAGE="$NODE_IMAGE" \
  -t "$IMAGE_TAG" \
  "$CTX_DIR"

echo ""
echo "========================================"
echo "  Build complete: $IMAGE_TAG"
echo "========================================"

# ── 4. Restore dev dependencies ─────────────────────────────────────────────
echo "→ Restoring dev dependencies (pnpm install)..."
cd "$REPO_ROOT"
pnpm install --reporter=silent
echo "   Done."

echo ""
echo "Run with:"
echo "  docker run --rm -p 18789:18789 $IMAGE_TAG"
