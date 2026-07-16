#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_ROOT="${1:-${PROJECT_ROOT}/deploy/agent}"
APP_DIR="${OUTPUT_ROOT}/app"
OUTPUT_PARENT="$(dirname "${OUTPUT_ROOT}")"
OUTPUT_NAME="$(basename "${OUTPUT_ROOT}")"
ARCHIVE_PATH="${OUTPUT_ROOT}.tar.gz"

cd "${PROJECT_ROOT}"
pnpm build

mkdir -p "${OUTPUT_ROOT}"
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}"
for item in dist node_modules skills docs qa package.json openclaw.mjs; do
  cp -R "${PROJECT_ROOT}/${item}" "${APP_DIR}/${item}"
done
cp "${SCRIPT_DIR}/agent-bootstrap-config.mjs" "${APP_DIR}/bootstrap-config.mjs"
find "${APP_DIR}" -name .DS_Store -type f -delete

cp "${SCRIPT_DIR}/agent-start.sh" "${OUTPUT_ROOT}/start.sh"
chmod 0755 "${OUTPUT_ROOT}/start.sh"

rm -f "${ARCHIVE_PATH}"
tar \
  --exclude='.DS_Store' \
  --exclude="${OUTPUT_NAME}/data" \
  -czf "${ARCHIVE_PATH}" \
  -C "${OUTPUT_PARENT}" \
  "${OUTPUT_NAME}"

echo "Agent package created at ${OUTPUT_ROOT}"
echo "Clean install archive created at ${ARCHIVE_PATH}"
echo "The application updater may replace app/ and start.sh; data/ is created on first launch."
