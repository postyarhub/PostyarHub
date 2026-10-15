#!/usr/bin/env bash
# ============================================================================
# Postyar — release packaging (contract §148-151)
#
# Stages the release tree into a clean /tmp staging dir (excluding .git,
# node_modules, .env*, logs, private/, coverage/, tmp/, local DB files),
# verifies the staging copy with scripts/release-check.sh, zips it to
# postyar-production-final.zip, writes SHA256SUMS (zip hash), verifies the
# archive listing, secret-scans the listing, and prints the final SHA256.
#
# IDEMPOTENT: every run rebuilds staging + zip from scratch.
#
# Usage:
#   scripts/make-release.sh [--skip-check]
#     --skip-check  Package without running the release gate (NOT recommended).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NAME="postyar-production-final"
STAGE="/tmp/${NAME}-staging"
OUT_ZIP="${ROOT}/${NAME}.zip"
OUT_SUMS="${ROOT}/SHA256SUMS"
SKIP_CHECK=0
[ "${1:-}" = "--skip-check" ] && SKIP_CHECK=1

log()  { printf '\033[1;34m[package]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[  ok  ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

command -v zip >/dev/null 2>&1 || die "zip not found in PATH."
command -v unzip >/dev/null 2>&1 || die "unzip not found in PATH."
command -v sha256sum >/dev/null 2>&1 || die "sha256sum not found in PATH."

# ----------------------------------------------------------- 1. clean staging
log "Resetting staging dir: ${STAGE}"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"

# ------------------------------------------------------------- 2. stage tree
log "Staging tree (excluding .git, node_modules, .env*, logs, private, coverage, tmp, DB files)"
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --include '.env.example' \
  --include '.env.example/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.log' \
  --exclude 'dev.log' \
  --exclude 'private/' \
  --exclude 'storage/' \
  --exclude 'coverage/' \
  --exclude 'tmp/' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  --exclude '*.sql.gz' \
  --exclude '*.pem' \
  --exclude '*.key' \
  --exclude "${NAME}.zip" \
  --exclude 'SHA256SUMS' \
  --exclude 'docs/' \
  --exclude 'reports/' \
  --exclude 'Thumbs.db' \
  --exclude '.DS_Store' \
  "${ROOT}/" "${STAGE}/"
# Safety net: the annotated env template must ship with the release.
if [ -f "${ROOT}/postelrobbal/config/.env.example" ] && [ ! -f "${STAGE}/postelrobbal/config/.env.example" ]; then
  mkdir -p "${STAGE}/postelrobbal/config"
  cp "${ROOT}/postelrobbal/config/.env.example" "${STAGE}/postelrobbal/config/.env.example"
fi
ok "Staged into ${STAGE}"

# ------------------------------------------------- 3. verify staging (gate)
if [ "$SKIP_CHECK" -eq 1 ]; then
  log "SKIPPING release gate (--skip-check) — NOT recommended"
else
  log "Running release gate against staging copy"
  POSTYAR_ALLOW_MISSING_SHA256SUMS=1 "${SCRIPT_DIR}/release-check.sh" "${STAGE}" \
    || die "release-check FAILED on staging — fix blockers before packaging."
fi

# --------------------------------------------------------------- 4. zip it
log "Creating archive ${OUT_ZIP}"
rm -f "${OUT_ZIP}"
(cd "${STAGE}" && zip -qr "${OUT_ZIP}" .) || die "zip creation failed."
[ -s "${OUT_ZIP}" ] || die "zip is empty."

# --------------------------------------------------- 5. verify zip listing
log "Verifying archive listing"
# Capture once: piping unzip into `grep -q` under pipefail can fail on SIGPIPE.
LISTING="$(unzip -l "${OUT_ZIP}")"
FILE_COUNT="$(printf '%s\n' "${LISTING}" | awk '/files$/{print $2}')"
[ "${FILE_COUNT:-0}" -gt 0 ] || die "zip listing reports 0 files."
for required in \
  "postelrobbal/app/package.json" "postelrobbal/frontend/package.json" \
  "postelrobbal/database/migrations/0001_init.sql" "postelrobbal/database/migrations/0013_runtime_drift_repairs.sql" \
  "postelrobbal/scripts/deploy.sh" "postelrobbal/scripts/release-check.sh" "postelrobbal/config/.env.example" \
  "postelrobbal/wordpress-plugin/postyar-connector/postyar-connector.php" \
  "public_html/index.html" "public_html/runtime-recovery.js" "postelrobbal/api/app.js" \
  "postelrobbal/workers/worker.js" "postelrobbal/scheduler/scheduler.js"; do
  grep -q " ${required}\$" <<<"${LISTING}" || die "required file missing from zip: ${required}"
done
# The archive must have exactly the two deployment roots and no reports/docs/checksum layer.
ROOT_LINES="$(unzip -Z1 "${OUT_ZIP}" | awk -F/ 'NF==2 && $2=="" {print $0}' | sort)"
EXPECTED_ROOTS=$'postelrobbal/\npublic_html/'
if [ "${ROOT_LINES}" != "${EXPECTED_ROOTS}" ]; then
  printf '%s\n' "${ROOT_LINES}"
  die "archive root structure is not exactly postelrobbal/ + public_html/."
fi
if unzip -Z1 "${OUT_ZIP}" | grep -Eq '^(docs|reports|SHA256SUMS)(/|$)'; then
  die "reports/docs/checksum leaked into deployment archive."
fi
ok "Archive contains ${FILE_COUNT} entries; required files and root layout verified"

# -------------------------------------------- 6. secret scan the zip listing
log "Scanning archive listing for forbidden/secret-looking filenames"
if grep -Ei " (\.[Ee][Nn][Vv]|[[:alnum:]_.-]*\.sqlite[0-9.]*|[[:alnum:]_.-]*\.sql\.gz|[[:alnum:]_.-]*\.pem|[[:alnum:]_.-]*\.key|dev\.log|Thumbs\.db|\.DS_Store)$" <<<"${LISTING}" >/dev/null 2>&1; then
  grep -Ei " (\.[Ee][Nn][Vv]|[[:alnum:]_.-]*\.sqlite[0-9.]*|[[:alnum:]_.-]*\.sql\.gz|[[:alnum:]_.-]*\.pem|[[:alnum:]_.-]*\.key|dev\.log|Thumbs\.db|\.DS_Store)$" <<<"${LISTING}"
  die "forbidden filenames inside the zip (see above)."
fi
ok "No forbidden filenames inside the archive"

# ------------------------------------------------- 7. SHA256SUMS + verdict
log "Writing ${OUT_SUMS} (zip hash)"
ZIP_SHA="$(sha256sum "${OUT_ZIP}" | awk '{print $1}')"
printf '%s  %s\n' "${ZIP_SHA}" "${NAME}.zip" > "${OUT_SUMS}"

SIZE_MB="$(du -m "${OUT_ZIP}" | awk '{print $1}')"
echo ""
echo "============================================================"
echo " Release artifact : ${OUT_ZIP} (${SIZE_MB} MB, ${FILE_COUNT} entries)"
echo " Checksums        : ${OUT_SUMS}"
echo " SHA256           : ${ZIP_SHA}"
echo "============================================================"
echo "Verify on target:  sha256sum -c SHA256SUMS"
ok "SUCCESS"
