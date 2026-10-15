#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_HOME="${POSTYAR_HOME:-${HOME}/postelrobbal}"
NODE_BIN="$(cat "${APP_HOME}/config/node.bin" 2>/dev/null || true)"
[ -n "${NODE_BIN}" ] || NODE_BIN="/opt/cpanel/ea-nodejs22/bin/node"
[ -x "${NODE_BIN}" ] || {
  echo "Postyar: Node.js 22 executable not found: ${NODE_BIN}" >&2
  exit 1
}

[ -f "${APP_HOME}/config/.env" ] || {
  echo "Postyar: missing ${APP_HOME}/config/.env" >&2
  exit 1
}

[ -f "${APP_HOME}/workers/run-worker.sh" ] || {
  echo "Postyar: workers/run-worker.sh is missing" >&2
  exit 1
}

[ -f "${APP_HOME}/scheduler/run-scheduler.sh" ] || {
  echo "Postyar: scheduler/run-scheduler.sh is missing" >&2
  exit 1
}

command -v crontab >/dev/null 2>&1 || {
  echo "Postyar: crontab is not available." >&2
  exit 1
}

[ -x /usr/bin/flock ] || {
  echo "Postyar: /usr/bin/flock is not available." >&2
  exit 1
}

mkdir -p "${APP_HOME}/run" "${APP_HOME}/logs"
chmod 700 "${APP_HOME}/run" "${APP_HOME}/logs"

TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

crontab -l 2>/dev/null |
  grep -v 'postelrobbal/.*/run-worker.sh\|postelrobbal/.*/run-scheduler.sh' \
  > "${TMP}" || true

{
  printf '%s\n' "*/1 * * * * POSTYAR_HOME='${APP_HOME}' /usr/bin/flock -n '${APP_HOME}/run/worker.lock' /bin/bash '${APP_HOME}/workers/run-worker.sh' >> '${APP_HOME}/logs/worker.log' 2>&1"
  printf '%s\n' "*/1 * * * * POSTYAR_HOME='${APP_HOME}' /usr/bin/flock -n '${APP_HOME}/run/scheduler.lock' /bin/bash '${APP_HOME}/scheduler/run-scheduler.sh' >> '${APP_HOME}/logs/scheduler.log' 2>&1"
} >> "${TMP}"

crontab "${TMP}"

mkdir -p "${APP_HOME}/api/tmp"
touch "${APP_HOME}/api/tmp/restart.txt"

printf '%s\n' "Postyar: worker/scheduler activation configuration installed."
