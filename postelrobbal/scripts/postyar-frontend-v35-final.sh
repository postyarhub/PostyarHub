#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/postyarh"
PROJECT="$ROOT/postelrobbal"
PUBLIC="$ROOT/public_html"
DIST="$PROJECT/frontend/dist"
NODE="$ROOT/nodevenv/postelrobbal/api/22/bin/node"
BACKUPS="$ROOT/backups"

TS="$(date +%Y%m%d-%H%M%S)"
NEW_ID="postyar-ui-v35-${TS}"
WORK="$ROOT/tmp/${NEW_ID}"
CANDIDATE="$WORK/release"
INDEX_TMP="$PUBLIC/.index-${NEW_ID}.tmp"
BACKUP_DIR="$BACKUPS/frontend-${NEW_ID}"
RELEASE_DIR="$PUBLIC/__postyar_releases/$NEW_ID"

fail() { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '[INFO] %s\n' "$*"; }

mkdir -p "$WORK" "$BACKUP_DIR" "$PUBLIC/__postyar_releases"

[ -f "$PUBLIC/index.html" ] || fail "Production index.html missing."
[ -f "$DIST/index.html" ] || fail "frontend/dist/index.html missing."
[ -d "$DIST/assets" ] || fail "frontend/dist/assets missing."
[ -x "$NODE" ] || fail "Pinned Node 22 runtime missing."

# Restore the original release-check.sh if one of the earlier repair attempts
# modified it. This uses only the backup created by the earlier commands.
LATEST_GATE_BACKUP="$(ls -1t "$BACKUPS"/release-check-before-fd-fix-*.sh 2>/dev/null | head -n 1 || true)"
if [ -n "$LATEST_GATE_BACKUP" ] && [ -s "$LATEST_GATE_BACKUP" ]; then
  cp "$LATEST_GATE_BACKUP" "$PROJECT/scripts/release-check.sh"
  chmod 0755 "$PROJECT/scripts/release-check.sh"
  info "Restored release-check.sh from its pre-repair backup."
fi

# Determine the new Vite entry names from the build that already exists.
NEW_INDEX_JS="$(sed -nE 's#.*src="/assets/(index-[^"]+\.js)".*#\1#p' "$DIST/index.html" | head -n 1)"
NEW_CSS="$(sed -nE 's#.*href="/assets/(index-[^"]+\.css)".*#\1#p' "$DIST/index.html" | head -n 1)"
NEW_VENDOR="$(sed -nE 's#.*href="/assets/(vendor-[^"]+\.js)".*#\1#p' "$DIST/index.html" | head -n 1)"

[ -n "$NEW_INDEX_JS" ] || NEW_INDEX_JS="$(find "$DIST/assets" -maxdepth 1 -type f -name 'index-*.js' -printf '%f\n' | head -n 1)"
[ -n "$NEW_CSS" ] || NEW_CSS="$(find "$DIST/assets" -maxdepth 1 -type f -name 'index-*.css' -printf '%f\n' | head -n 1)"
[ -n "$NEW_VENDOR" ] || NEW_VENDOR="$(find "$DIST/assets" -maxdepth 1 -type f -name 'vendor-*.js' -printf '%f\n' | head -n 1)"

[ -f "$DIST/assets/$NEW_INDEX_JS" ] || fail "New main JS not found: $NEW_INDEX_JS"
[ -f "$DIST/assets/$NEW_CSS" ] || fail "New CSS not found: $NEW_CSS"
[ -f "$DIST/assets/$NEW_VENDOR" ] || fail "New vendor JS not found: $NEW_VENDOR"

mkdir -p "$CANDIDATE"
cp -a "$DIST"/. "$CANDIDATE"/

# Rewrite release-qualified and unversioned absolute asset references INSIDE
# the new release only. Relative asset references remain untouched.
while IFS= read -r -d '' f; do
  sed -i -E \
    "s#/__postyar_releases/postyar-ui-v[0-9]+-[^/]+/#/__postyar_releases/${NEW_ID}/#g" \
    "$f"
  sed -i -E \
    "s#(['\"=(])/assets/#\1/__postyar_releases/${NEW_ID}/assets/#g" \
    "$f"
  sed -i \
    "s#\`/assets/#\`/__postyar_releases/${NEW_ID}/assets/#g" \
    "$f"
  sed -i \
    "s#url(/assets/#url(/__postyar_releases/${NEW_ID}/assets/#g" \
    "$f"
done < <(find "$CANDIDATE" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.webmanifest' \) -print0)

# Build the production shell from the CURRENT V34 shell, changing only the
# three Vite entry references. SEO/meta/recovery and all other root content
# are preserved.
cp "$PUBLIC/index.html" "$BACKUP_DIR/index.html.before"

sed -E \
  -e "s#(/__postyar_releases/)[^/]+/assets/index-[^\"']+\.js#\1${NEW_ID}/assets/${NEW_INDEX_JS}#g" \
  -e "s#(/__postyar_releases/)[^/]+/assets/index-[^\"']+\.css#\1${NEW_ID}/assets/${NEW_CSS}#g" \
  -e "s#(/__postyar_releases/)[^/]+/assets/vendor-[^\"']+\.js#\1${NEW_ID}/assets/${NEW_VENDOR}#g" \
  "$PUBLIC/index.html" > "$INDEX_TMP"

# Ensure the new release is physically present before changing production.
mkdir -p "$RELEASE_DIR"
cp -a "$CANDIDATE"/. "$RELEASE_DIR"/

# Atomic activation of the new production entry.
mv "$INDEX_TMP" "$PUBLIC/index.html"

# Record exact rollback information without changing any backend/runtime state.
{
  printf 'release=%s\n' "$NEW_ID"
  printf 'previous_index_backup=%s\n' "$BACKUP_DIR/index.html.before"
  printf 'new_main_js=%s\n' "$NEW_INDEX_JS"
  printf 'new_css=%s\n' "$NEW_CSS"
  printf 'new_vendor_js=%s\n' "$NEW_VENDOR"
  printf 'release_dir=%s\n' "$RELEASE_DIR"
  printf 'timestamp=%s\n' "$TS"
} > "$BACKUP_DIR/RESULT.txt"

sha256sum "$PUBLIC/index.html" > "$BACKUP_DIR/index.html.after.sha256"

printf '\nRELEASE ACTIVATED: %s\n' "$NEW_ID"
printf 'Previous index backup: %s\n' "$BACKUP_DIR/index.html.before"
printf 'New release: %s\n' "$RELEASE_DIR"
printf 'No backend, database, migration, worker, scheduler, or Passenger changes were made.\n'
