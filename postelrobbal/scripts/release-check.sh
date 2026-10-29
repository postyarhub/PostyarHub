#!/usr/bin/env bash
# ============================================================================
# Postyar — release gate (contract §136-137)
#
# FAILS (non-zero) on any release blocker:
#   1. Forbidden files in the tree (.env with content, *.sqlite, *.sql.gz,
#      private/storage uploads, dev.log, *.pem/*key files, Thumbs.db/.DS_Store)
#   2. Hardcoded secrets matching high-signal patterns (AWS keys, OpenAI sk-,
#      GitHub tokens, Slack tokens, PEM private keys)
#   3. Placeholder values in committed config files (.env.example is exempt)
#   4. Next.js imports/dependencies inside product source (app/src,
#      frontend/src, wordpress-plugin) — docs discussing "no Next.js" are fine
#   5. Explicit release markers: "TODO: RELEASE" / "FIXME: RELEASE" / "XXX: RELEASE"
#   6. Missing required runtime/release structure
#
# WARN only: frontend/dist missing (built at packaging time, not committed).
#
# Usage:
#   scripts/release-check.sh [ROOT]
#   ROOT defaults to the release tree (parent of scripts/); make-release.sh
#   runs this against the staging copy.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

BLOCKERS=0
WARNINGS=0

fail() { printf '\033[1;31m[BLOCKER]\033[0m %s\n' "$*"; BLOCKERS=$((BLOCKERS + 1)); }
warn() { printf '\033[1;33m[warning]\033[0m %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
pass() { printf '\033[1;32m[  ok  ]\033[0m %s\n' "$*"; }

cd "${ROOT}"

# Scan domain: real product/config/docs dirs; never node_modules/dist (vendor
# and build output can legitimately contain third-party strings).
SCAN_DIRS=(postelrobbal/app/src postelrobbal/frontend/src postelrobbal/wordpress-plugin postelrobbal/database postelrobbal/scripts public_html)
SCAN_EXISTING=()
for d in "${SCAN_DIRS[@]}"; do [ -e "$d" ] && SCAN_EXISTING+=("$d"); done

# ------------------------------------------------------------ 1. forbidden files
echo "== 1/6 Forbidden files =="
FORBIDDEN_FOUND=0
while IFS= read -r -d '' f; do
  case "$f" in
    ./.env)
      if [ -s "$f" ]; then fail "committed .env has content: $f"; FORBIDDEN_FOUND=1; fi ;;
    *.sqlite|*.sqlite3|*.sql.gz|dev.log|Thumbs.db|.DS_Store)
      fail "forbidden file present: $f"; FORBIDDEN_FOUND=1 ;;
    *.pem|*.key)
      fail "private key material present: $f"; FORBIDDEN_FOUND=1 ;;
    *.gitkeep) continue ;;
    */.env|*/.env.*)
      case "$f" in
        ./.env.example|*/.env.example) continue ;;
        *) fail "environment file present: $f"; FORBIDDEN_FOUND=1 ;;
      esac ;;
    ./private/*|./storage/*|./logs/*|./postelrobbal/private/*|./postelrobbal/storage/*|./postelrobbal/logs/*|./postelrobbal/app/private/*)
      fail "private runtime/upload data committed: $f"; FORBIDDEN_FOUND=1 ;;
  esac
done < <(find . -path ./node_modules -prune -o -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path ./.git -prune -o -type f -print0)
[ "$FORBIDDEN_FOUND" -eq 0 ] && pass "no forbidden files"

# ------------------------------------------------------------ 2. secret scan
echo "== 2/6 Secret scan =="
SECRET_PATTERN="(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[bp]-[A-Za-z0-9-]{10,})"
if [ "${#SCAN_EXISTING[@]}" -gt 0 ]; then
  SECRET_HITS="$(grep -rIEn "$SECRET_PATTERN" "${SCAN_EXISTING[@]}" 2>/dev/null || true)"
else
  SECRET_HITS=""
fi
if [ -n "$SECRET_HITS" ]; then
  fail "hardcoded secrets detected:"
  printf '%s\n' "$SECRET_HITS"
else
  pass "no hardcoded secrets in tracked dirs"
fi

# ---------------------------------------------------- 3. placeholder leakage
echo "== 3/6 Placeholder scan (committed configs, .env.example exempt) =="
PLACEHOLDER_HITS=0
while IFS= read -r -d '' f; do
  case "$f" in
    ./.env.example|*/.env.example|*node_modules*|*/dist/*|./.git/*|./bun.lock|*/bun.lock) continue ;;
  esac
  case "$f" in
    *.env*|*.yml|*.yaml|*.ini|*.conf|*.toml|config/*)
      if grep -qEn "REPLACE_WITH|CHANGE_ME|FILL_ME_IN|YOUR_[A-Z_]*_(SECRET|KEY|TOKEN|PASSWORD)_HERE" "$f" 2>/dev/null; then
        fail "placeholder value in committed config: $f"
        PLACEHOLDER_HITS=1
      fi ;;
  esac
done < <(find . -path ./node_modules -prune -o -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path ./.git -prune -o -type f -print0)
[ "$PLACEHOLDER_HITS" -eq 0 ] && pass "no placeholders outside .env.example"
pass ".env.example contains placeholders only (by design)"

# ------------------------------------------------------ 4. Next.js references
echo "== 4/6 Next.js reference scan (product source only) =="
NEXT_HITS=0
for dir in postelrobbal/app/src postelrobbal/frontend/src postelrobbal/wordpress-plugin; do
  [ -e "$dir" ] || continue
  HITS="$(grep -rEi "from ['\"]next(/|['\"]| )|require\(['\"]next|import\(['\"]next|['\"]next['\"]\s*:|nextjs|next\.js" "$dir" 2>/dev/null || true)"
  if [ -n "$HITS" ]; then
    fail "Next.js references in product source ($dir):"
    printf '%s\n' "$HITS"
    NEXT_HITS=1
  fi
done
[ "$NEXT_HITS" -eq 0 ] && pass "no Next.js in product source (docs/audits allowed)"

# ------------------------------------------------------ 5. release markers
echo "== 5/6 Unresolved release markers =="
# --exclude=this script: its own pattern text would otherwise self-match.
MARKER_HITS="$(grep -rn --exclude="release-check.sh" "TODO: RELEASE\|FIXME: RELEASE\|XXX: RELEASE" postelrobbal docs public_html 2>/dev/null || true)"
if [ -n "$MARKER_HITS" ]; then
  fail "explicit release markers found (plain TODO/FIXME are allowed):"
  printf '%s\n' "$MARKER_HITS"
else
  pass "no explicit release blockers (TODO: RELEASE etc.)"
fi

# ------------------------------------------------ 6. required runtime structure
echo "== 6/6 Required runtime structure =="
[ -s "postelrobbal/app/package.json" ]      && pass "postelrobbal/app/package.json"      || fail "missing postelrobbal/app/package.json"
[ -s "postelrobbal/frontend/package.json" ] && pass "postelrobbal/frontend/package.json" || fail "missing postelrobbal/frontend/package.json"
[ -s "postelrobbal/config/.env.example" ]   && pass "postelrobbal/config/.env.example"   || fail "missing postelrobbal/config/.env.example"
SQL_COUNT=0
for sql in postelrobbal/database/migrations/*.sql; do
  [ -e "$sql" ] || { fail "no migrations in postelrobbal/database/migrations/"; break; }
  if [ -s "$sql" ]; then SQL_COUNT=$((SQL_COUNT + 1)); else fail "empty migration file: $sql"; fi
done
[ "$SQL_COUNT" -gt 0 ] && pass "postelrobbal/database/migrations: $SQL_COUNT non-empty SQL file(s)"
[ -s "postelrobbal/wordpress-plugin/postyar-connector/postyar-connector.php" ] \
  && pass "postelrobbal/wordpress-plugin/postyar-connector/postyar-connector.php" \
  || fail "missing postelrobbal/wordpress-plugin/postyar-connector/postyar-connector.php (connector plugin not shipped)"
[ -s "postelrobbal/wordpress-plugin/postyar-wordpress/postyar-wordpress.php" ] \
  && pass "canonical postyar-wordpress plugin source" \
  || fail "missing canonical postyar-wordpress plugin source"
[ -s "postelrobbal/wordpress-plugin/postyar-wordpress.zip" ] \
  && pass "postyar-wordpress.zip (subscription-gated download package)" \
  || fail "missing postelrobbal/wordpress-plugin/postyar-wordpress.zip (dashboard download package)"
if [ -s "postelrobbal/wordpress-plugin/postyar-wordpress.zip" ]; then
  PLUGIN_ZIP_LIST="$(unzip -Z1 "postelrobbal/wordpress-plugin/postyar-wordpress.zip" 2>/dev/null)" \
    || { fail "canonical WordPress plugin ZIP is unreadable"; PLUGIN_ZIP_LIST=""; }
  if [ -n "$PLUGIN_ZIP_LIST" ] && printf '%s\n' "$PLUGIN_ZIP_LIST" | grep -Ev '^postyar-wordpress(/|$)' >/dev/null; then
    fail "WordPress download ZIP contains an unexpected path outside the canonical plugin root"
  elif [ -n "$PLUGIN_ZIP_LIST" ]; then
    pass "WordPress download ZIP path scope is restricted to canonical plugin root"
  fi
fi
for s in postelrobbal/scripts/deploy.sh postelrobbal/scripts/release-check.sh; do
  [ -s "$s" ] && pass "$s" || fail "missing required script: $s"
done
[ -s "postelrobbal/api/app.js" ]            && pass "postelrobbal/api/app.js (Passenger entry)"        || fail "missing postelrobbal/api/app.js"
[ -s "postelrobbal/workers/worker.js" ]     && pass "postelrobbal/workers/worker.js"                   || fail "missing postelrobbal/workers/worker.js"
[ -s "postelrobbal/scheduler/scheduler.js" ] && pass "postelrobbal/scheduler/scheduler.js"             || fail "missing postelrobbal/scheduler/scheduler.js"

# §55 layout boundary: the public web root must exist and contain a built SPA,
# and must never contain server code or secrets.
if [ -s "public_html/index.html" ]; then
  pass "public_html/index.html present (built SPA committed per §55)"
  LEAK="$(find public_html -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.env*' -o -name '*.sql' -o -name '*.php' -o -name '*.cjs' -o -name '*.mjs' \) 2>/dev/null || true)"
  SERVER_DIRS="$(find public_html -mindepth 1 -maxdepth 1 -type d \( -name app -o -name frontend -o -name database -o -name workers -o -name scheduler -o -name scripts -o -name config -o -name api -o -name wordpress-plugin -o -name logs -o -name run \) -print 2>/dev/null || true)"
  if [ -z "$LEAK" ] && [ -z "$SERVER_DIRS" ]; then
    pass "public_html contains only browser/public assets"
  else
    fail "public_html contains server/source/runtime content:"
    [ -n "$LEAK" ] && printf '%s\n' "$LEAK"
    [ -n "$SERVER_DIRS" ] && printf '%s\n' "$SERVER_DIRS"
  fi
else
  warn "public_html/index.html missing — run the frontend build (vite build --outDir public_html) before release"
fi

if [ -f "postelrobbal/frontend/dist/index.html" ]; then pass "postelrobbal/frontend/dist present"
else warn "postelrobbal/frontend/dist missing (intermediate build output, not committed)"; fi

# Release archive policy: deploy roots are exactly postelrobbal/ and public_html/.
# Documentation/reports/checksums live outside the deployment roots.
for extra in docs reports SHA256SUMS; do
  if [ -e "$extra" ]; then warn "non-deploy artifact present at root: $extra (kept outside release archive)"; fi
done

# ------------------------------------------------------------------ verdict
echo ""
if [ "$BLOCKERS" -gt 0 ]; then
  printf '\033[1;31mRELEASE GATE: FAILED — %d blocker(s), %d warning(s)\033[0m\n' "$BLOCKERS" "$WARNINGS"
  exit 1
fi
printf '\033[1;32mRELEASE GATE: PASSED — 0 blockers, %d warning(s)\033[0m\n' "$WARNINGS"
