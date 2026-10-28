#!/usr/bin/env bash
# ============================================================================
# Postyar — production deployment script (shared host, cPanel/CloudLinux/Passenger)
#
# Contract: §55/§69 (deployment layout), §200 (idempotent deploy), §66/§201
# (migrations: apply committed files exactly once, never invent), §68/§127
# (scheduler is a cron tick model; workers are single-instance).
#
# Design rules:
#   - IDEMPOTENT: safe to re-run; every step converges to the same state.
#   - Never installs Redis, never runs the test suite, never spawns duplicate
#     workers, never invents migrations.
#   - The release may contain prebuilt dist/public_html artifacts. `--build`
#     is supported for hosts without a CI build, using the Node/npm toolchain.
#
# Usage:
#   scripts/deploy.sh [--build]
#     --build   Build app + frontend on THIS machine before deploying
#               (use only on a build box, never on the shared prod host).
#               The frontend build is synced into the release public_html/ so
#               the committed public tree and the deployed one never diverge.
#
# Overridable locations (env):
#   POSTYAR_RELEASE   release tree root           (default: parent of scripts/)
#   POSTYAR_HOME      private app root            (default: $HOME/postelrobbal)
#   PUBLIC_HTML       public web root             (default: $HOME/public_html)
# ============================================================================
set -euo pipefail

# ------------------------------------------------------------------ locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${POSTYAR_RELEASE:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
APP_HOME="${POSTYAR_HOME:-${HOME}/postelrobbal}"
PUBLIC_HTML="${PUBLIC_HTML:-${HOME}/public_html}"
ENV_FILE="${APP_HOME}/config/.env"
API_PORT_FILE="${APP_HOME}/config/api.port"

BUILD_MODE=0
[ "${1:-}" = "--build" ] && BUILD_MODE=1

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------- 1. preflight
preflight() {
  log "Preflight: tooling, directories, environment, dependencies"

  for tool in curl rsync flock pgrep sed unzip; do
    command -v "${tool}" >/dev/null 2>&1 || die "required tool not found in PATH: ${tool}"
  done
  NODE_BIN_PATH="$(cat "${APP_HOME}/config/node.bin" 2>/dev/null || true)"
  if [ -z "${NODE_BIN_PATH}" ] || [ ! -x "${NODE_BIN_PATH}" ]; then
    NODE_BIN_PATH="$(command -v node 2>/dev/null || true)"
  fi
  [ -x "${NODE_BIN_PATH}" ] || NODE_BIN_PATH="/opt/cpanel/ea-nodejs22/bin/node"
  [ -x "${NODE_BIN_PATH}" ] || die "Node.js 22 executable not found."
  NODE_MAJOR="$(${NODE_BIN_PATH} -p 'parseInt(process.versions.node.split(".")[0], 10)')"
  [ "${NODE_MAJOR}" -ge 22 ] || die "Node.js >= 22 required (found: $(${NODE_BIN_PATH} -v))."
  NPM_BIN_PATH="$(dirname "${NODE_BIN_PATH}")/npm"
  [ -x "${NPM_BIN_PATH}" ] || NPM_BIN_PATH="$(command -v npm 2>/dev/null || true)"
  [ -x "${NPM_BIN_PATH}" ] || die "npm executable not found beside the pinned Node.js runtime."

  for dir in app api workers config database private storage logs wordpress-plugin; do
    mkdir -p "${APP_HOME}/${dir}"
  done
  ok "Directory tree present under ${APP_HOME}"
  printf '%s\n' "${NODE_BIN_PATH}" > "${APP_HOME}/config/node.bin"
  chmod 600 "${APP_HOME}/config/node.bin"
  ok "Node runtime pinned for cron: ${NODE_BIN_PATH}"

  [ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. Create it from .env.example (chmod 600)."
  # shellcheck disable=SC1090
  set -a; . "${ENV_FILE}"; set +a

  : "${DATABASE_URL:?DATABASE_URL missing in ${ENV_FILE}}"
  : "${REDIS_URL:?REDIS_URL missing in ${ENV_FILE}}"
  : "${APP_URL:?APP_URL missing in ${ENV_FILE}}"
  : "${API_URL:?API_URL missing in ${ENV_FILE}}"
  PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-${APP_URL}}"
  case "${PUBLIC_ORIGIN}" in
    https://*) ;;
    *) die "PUBLIC_ORIGIN must use https:// (or inherit APP_URL)." ;;
  esac
  : "${SESSION_SECRET:?SESSION_SECRET missing in ${ENV_FILE}}"
  : "${CSRF_SECRET:?CSRF_SECRET missing in ${ENV_FILE}}"
  [ "${#SESSION_SECRET}" -ge 32 ] || die "SESSION_SECRET must be >= 32 chars."
  [ "${#CSRF_SECRET}" -ge 32 ] || die "CSRF_SECRET must be >= 32 chars."
  [[ "${ENCRYPTION_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]] || die "ENCRYPTION_KEY must be exactly 64 hex chars (AES-256-GCM)."
  ok "Environment variables present (${ENV_FILE})"

  if [ "${BUILD_MODE}" -eq 1 ]; then
    log "--build requested: building on this machine"
    (cd "${RELEASE_DIR}/postelrobbal/app" && "${NPM_BIN_PATH}" install --no-audit --no-fund && "${NPM_BIN_PATH}" run build) \
      || die "app build failed (npm install + npm run build)."
    (cd "${RELEASE_DIR}/postelrobbal/frontend" && "${NPM_BIN_PATH}" install --no-audit --no-fund \
      && "${NPM_BIN_PATH}" run build) \
      || die "frontend build failed (npm install + npm run build)."
    rm -rf "${RELEASE_DIR}/public_html"
    mkdir -p "${RELEASE_DIR}/public_html"
    rsync -a --delete "${RELEASE_DIR}/postelrobbal/frontend/dist/" "${RELEASE_DIR}/public_html/"
  fi

  [ -f "${RELEASE_DIR}/postelrobbal/app/dist/server.js" ] || die \
    "postelrobbal/app/dist missing. Build in CI (or run scripts/deploy.sh --build on a build box). Never build TypeScript on the prod shared host by default."
  [ -f "${RELEASE_DIR}/public_html/index.html" ] || die \
    "public_html/index.html missing. Build the SPA in CI (vite build into public_html/), then re-run deploy."
  ok "Build artifacts present (postelrobbal/app/dist, public_html)"
  PLUGIN_ZIP_RELEASE="${RELEASE_DIR}/postelrobbal/wordpress-plugin/postyar-wordpress.zip"
  [ -s "${PLUGIN_ZIP_RELEASE}" ] || die "Canonical WordPress plugin ZIP missing from release; create a complete release package first."
  unzip -tq "${PLUGIN_ZIP_RELEASE}" >/dev/null || die "Canonical WordPress plugin ZIP failed integrity verification."
  # Passenger and the worker/scheduler shims resolve runtime dependencies from
  # postelrobbal/api/node_modules. The compiled application remains under app/.
  log "Installing production dependencies into ${APP_HOME}/api (Passenger runtime)"
  cp "${RELEASE_DIR}/postelrobbal/api/package.json" "${APP_HOME}/api/package.json"
  if [ -f "${RELEASE_DIR}/postelrobbal/api/package-lock.json" ]; then
    cp "${RELEASE_DIR}/postelrobbal/api/package-lock.json" "${APP_HOME}/api/package-lock.json"
  fi
  if [ -f "${APP_HOME}/api/package-lock.json" ]; then
    (cd "${APP_HOME}/api" && "${NPM_BIN_PATH}" ci --omit=dev --no-audit --no-fund) || die "Passenger dependency install failed (npm ci)."
  else
    (cd "${APP_HOME}/api" && "${NPM_BIN_PATH}" install --omit=dev --no-audit --no-fund) || die "Passenger dependency install failed (npm install)."
  fi
  ok "Passenger runtime dependencies ready (${APP_HOME}/api/node_modules)"

  log "Reachability checks (MySQL, Redis) using the Passenger runtime dependencies"
  (cd "${APP_HOME}/api" && "${NODE_BIN_PATH}" -e '
    const mysql = require("mysql2/promise");
    (async () => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL);
      await conn.query("SELECT 1");
      await conn.end();
      console.log("mysql: connected");
    })().catch((e) => { console.error("mysql ping failed:", e.message); process.exit(1); });
  ') || die "DATABASE_URL not reachable."
  (cd "${APP_HOME}/api" && "${NODE_BIN_PATH}" -e '
    const Redis = require("ioredis");
    const r = new Redis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1,
    });
    r.connect().then(() => r.ping())
      .then(async (p) => {
        if (p !== "PONG") throw new Error("unexpected PING reply: " + p);
        console.log("redis: PONG");
        await r.quit(); process.exit(0);
      })
      .catch(async (e) => { console.error("redis ping failed:", e.message); try { await r.quit(); } catch {} process.exit(1); });
  ') || die "REDIS_URL not reachable."
  ok "MySQL + Redis reachable"
}

# ----------------------------------------------- 2.5 public SEO origin
rewrite_public_origin() {
  local origin="${PUBLIC_ORIGIN%/}"
  local file
  for file in "${RELEASE_DIR}/public_html/index.html" "${RELEASE_DIR}/public_html/robots.txt" "${RELEASE_DIR}/public_html/sitemap.xml"; do
    [ -f "${file}" ] || continue
    sed -i "s#__POSTYAR_PUBLIC_ORIGIN__#${origin}#g" "${file}"
  done
  for file in "${RELEASE_DIR}/postelrobbal/frontend/dist/index.html" "${RELEASE_DIR}/postelrobbal/frontend/dist/robots.txt" "${RELEASE_DIR}/postelrobbal/frontend/dist/sitemap.xml"; do
    [ -f "${file}" ] || continue
    sed -i "s#__POSTYAR_PUBLIC_ORIGIN__#${origin}#g" "${file}"
  done
  ok "Public SEO origin resolved to ${origin}"
}

# ------------------------------------------------- 2. migration status + apply
migrate() {
  log "Migration status (applied vs present)"
  (cd "${APP_HOME}/app" && MIGRATIONS_DIR="${APP_HOME}/database/migrations" "${NODE_BIN_PATH}" -e '
    const mysql = require("mysql2/promise");
    const fs = require("fs");
    const dir = process.env.MIGRATIONS_DIR;
    (async () => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL);
      let applied = [];
      try {
        const [rows] = await conn.query("SELECT name FROM schema_migrations");
        applied = rows.map((r) => r.name);
      } catch { /* table may not exist yet on first deploy */ }
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
      console.log("applied :", applied.length ? applied.join(", ") : "(none)");
      console.log("present :", files.join(", ") || "(none)");
      const unknown = applied.filter((a) => !files.includes(a));
      if (unknown.length) {
        console.error("DRIFT: applied migration(s) missing from release: " + unknown.join(", "));
        process.exit(1);
      }
      await conn.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ') || die "migration status check failed."
  ok "No schema drift (release contains every applied migration)"

  log "Applying pending migrations (committed files only, exactly once)"
  # NOTE: dist/db/migrate-cli.js' self-invoking CLI block only triggers when the
  # script path ends in "migrate-cli.ts" (a build artifact quirk), so we import
  # the exported runMigrations() directly — same code path as `npm run migrate`.
  (cd "${APP_HOME}/app" && MIGRATIONS_DIR="${APP_HOME}/database/migrations" APP_HOME="${APP_HOME}" "${NODE_BIN_PATH}" -e '
      import("file://" + process.env.APP_HOME + "/app/dist/db/migrate.js")
        .then((m) => m.runMigrations(process.env.MIGRATIONS_DIR))
        .then((applied) => {
          console.log(applied.length ? "Applied: " + applied.join(", ") : "Already up to date.");
          process.exit(0);
        })
        .catch((e) => { console.error(e.message); process.exit(1); });
    ') || die "migration run failed."
  ok "Migrations applied"
}

# ----------------------------------------------------- 3. copy build artifacts
ship_artifacts() {
  log "Shipping artifacts"

  command -v rsync >/dev/null 2>&1 || die "rsync is required on the server."

  # Frontend SPA → public_html. The release tree ships public_html/ already
  # built (committed), so this is a plain guarded copy — no build on the host.
  if [ -d "${PUBLIC_HTML}" ]; then
    if [ -f "${PUBLIC_HTML}/.postyar-deployed" ] || [ -z "$(ls -A "${PUBLIC_HTML}" 2>/dev/null)" ] || { [ -f "${PUBLIC_HTML}/index.html" ] && grep -qiE 'postyar|پُست‌یار|پست‌یار' "${PUBLIC_HTML}/index.html"; }; then
      rsync -a --delete --exclude '.user.ini' "${RELEASE_DIR}/public_html/" "${PUBLIC_HTML}/"
      if [ ! -e "${PUBLIC_HTML}/.user.ini" ] && [ -f "${RELEASE_DIR}/public_html/.user.ini" ]; then
        install -m 0644 "${RELEASE_DIR}/public_html/.user.ini" "${PUBLIC_HTML}/.user.ini"
      fi
      touch "${PUBLIC_HTML}/.postyar-deployed"
      ok "SPA deployed to ${PUBLIC_HTML} (rsync --delete, guarded)"
    else
      die "Refusing to rsync --delete into non-empty unrelated ${PUBLIC_HTML}."
    fi
  else
    mkdir -p "${PUBLIC_HTML}"
    rsync -a --delete --exclude '.user.ini' "${RELEASE_DIR}/public_html/" "${PUBLIC_HTML}/"
    if [ ! -e "${PUBLIC_HTML}/.user.ini" ] && [ -f "${RELEASE_DIR}/public_html/.user.ini" ]; then
      install -m 0644 "${RELEASE_DIR}/public_html/.user.ini" "${PUBLIC_HTML}/.user.ini"
    fi
    touch "${PUBLIC_HTML}/.postyar-deployed"
    ok "SPA deployed to ${PUBLIC_HTML} (fresh)"
  fi

  # Normalize permissions after rsync: public Vite assets must remain readable by LiteSpeed.
  local asset_root="${PUBLIC_HTML}/assets"
  [ -d "${asset_root}" ] && [ ! -L "${asset_root}" ] || die "Public asset directory is missing or unsafe: ${asset_root}"
  if find -P "${asset_root}" -type l -print -quit | grep -q .; then
    die "Symlink found in public assets; refusing permission normalization."
  fi
  find -P "${asset_root}" -type d -exec chmod 755 -- {} +
  find -P "${asset_root}" -type f -exec chmod 644 -- {} +
  ok "Public asset permissions normalized (directories 755, files 644)"

  # Keep the authenticated download archive outside public_html; never expose a direct public ZIP URL.
  install -m 0644 "${PLUGIN_ZIP_RELEASE}" "${APP_HOME}/wordpress-plugin/postyar-wordpress.zip"
  ok "Canonical WordPress plugin archive installed for entitlement-gated API download"

  # Backend build → postelrobbal/app
  rsync -a --delete "${RELEASE_DIR}/postelrobbal/app/dist/" "${APP_HOME}/app/dist/"
  ok "Backend dist deployed to ${APP_HOME}/app/dist"

  # Migrations must travel with the release (apply-existing-migrations policy).
  mkdir -p "${APP_HOME}/database"
  rsync -a --delete "${RELEASE_DIR}/postelrobbal/database/migrations/" "${APP_HOME}/database/migrations/"
  ok "Migrations synced to ${APP_HOME}/database/migrations"

  # Passenger/worker/scheduler entries are COMMITTED in the release tree and
  # resolve postelrobbal/app relative to themselves (§55). Deploy ALL entry
  # scripts, including the executable cron launchers; leaving an old launcher
  # behind is a production-footgun because its Node path or working directory
  # can silently strand the delivery queue.
  install -m 0644 "${RELEASE_DIR}/postelrobbal/api/app.js" "${APP_HOME}/api/app.js"
  install -m 0644 "${RELEASE_DIR}/postelrobbal/config/load-env.cjs" "${APP_HOME}/config/load-env.cjs"
  install -m 0644 "${RELEASE_DIR}/postelrobbal/workers/worker.js" "${APP_HOME}/workers/worker.js"
  install -m 0755 "${RELEASE_DIR}/postelrobbal/workers/run-worker.sh" "${APP_HOME}/workers/run-worker.sh"
  install -m 0644 "${RELEASE_DIR}/postelrobbal/scheduler/scheduler.js" "${APP_HOME}/scheduler/scheduler.js"
  install -m 0755 "${RELEASE_DIR}/postelrobbal/scheduler/run-scheduler.sh" "${APP_HOME}/scheduler/run-scheduler.sh"
  install -m 0755 "${RELEASE_DIR}/postelrobbal/scripts/activate-workers.sh" "${APP_HOME}/scripts/activate-workers.sh"
  ok "Entries deployed: Passenger, env loader, worker/scheduler launchers, activation script"

  # .env must be readable by the API process only.
  chmod 600 "${ENV_FILE}" 2>/dev/null || warn "could not chmod 600 ${ENV_FILE}"
}

# ---------------------------------------------------------- 4. Passenger restart
restart() {
  log "Passenger restart"
  # cPanel/Passenger supports restart-by-touch: <app root>/tmp/restart.txt
  mkdir -p "${APP_HOME}/api/tmp"
  touch "${APP_HOME}/api/tmp/restart.txt"
  if command -v passenger >/dev/null 2>&1; then
    passenger restart-app --ignore-app-not-running 2>/dev/null || true
  fi
  ok "Restart signaled (tmp/restart.txt)"
}

# ------------------------------------------------------------- 5. health check
health() {
  log "Health verification (5 tries x 3s)"
  LIVE="${API_URL%/}/health/live"
  READY="${API_URL%/}/health/ready"
  curl -fsS --retry 5 --retry-delay 3 --retry-connrefused "${LIVE}" >/dev/null \
    || die "GET ${LIVE} failed after retries."
  READY_BODY="$(curl -sS --retry 5 --retry-delay 3 --retry-connrefused "${READY}" 2>/dev/null || true)"
  if printf '%s' "${READY_BODY}" | grep -q '"status":"ready"'; then
    ok "GET ${READY} → ready"
  else
    die "GET ${READY} is not READY. Response: ${READY_BODY:-no response}"
  fi
  ok "Live endpoint answering: ${LIVE}"
}

# --------------------------------------------------- 6. worker/scheduler note
workers_note() {
  log "Worker / scheduler supervision (single-instance policy, §68)"
  mkdir -p "${APP_HOME}/run" "${APP_HOME}/logs"
  chmod 700 "${APP_HOME}/run" "${APP_HOME}/logs" 2>/dev/null || true

  local CRON_FILE="${HOME}/.postyar-cron"
  local CRON_TMP
  CRON_TMP="$(mktemp)"
  crontab -l 2>/dev/null | grep -v 'postelrobbal/.*/run-worker.sh\|postelrobbal/.*/run-scheduler.sh' > "${CRON_TMP}" || true
  {
    printf '%s\n' "*/1 * * * * /usr/bin/flock -n '${APP_HOME}/run/worker.lock' '${APP_HOME}/workers/run-worker.sh' >> '${APP_HOME}/logs/worker.log' 2>&1"
    printf '%s\n' "*/1 * * * * /usr/bin/flock -n '${APP_HOME}/run/scheduler.lock' '${APP_HOME}/scheduler/run-scheduler.sh' >> '${APP_HOME}/logs/scheduler.log' 2>&1"
  } >> "${CRON_TMP}"
  crontab "${CRON_TMP}"
  rm -f "${CRON_TMP}"

  # Start one worker immediately as well as installing the cron watchdog.
  # The same flock key guarantees that a cron invocation cannot create a
  # second delivery worker. This is critical because publishNow() deliberately
  # leaves durable PENDING targets until a real worker consumes them.
  mkdir -p "${APP_HOME}/run" "${APP_HOME}/logs"
  nohup /usr/bin/flock -n "${APP_HOME}/run/worker.lock" "${APP_HOME}/workers/run-worker.sh" \
    >> "${APP_HOME}/logs/worker.log" 2>&1 </dev/null &
  sleep 1
  /usr/bin/flock -n "${APP_HOME}/run/scheduler.lock" "${APP_HOME}/scheduler/run-scheduler.sh" \
    >> "${APP_HOME}/logs/scheduler.log" 2>&1 || true
  ok "Persistent user cron installed and one delivery worker started under flock."
}

preflight
# Apply committed, backward-compatible migrations before the new application
# artifacts are exposed. The existing process remains on the old code until
# the explicit restart below.
migrate
ship_artifacts
restart
health
workers_note

log "Deployment complete."
printf '  API   : %s\n' "${API_URL%/}/health/live"
printf '  SPA   : %s\n' "${APP_URL%/}/"
printf '  Home  : %s\n' "${APP_HOME}"
ok "SUCCESS"
