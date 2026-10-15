#!/usr/bin/env bash
set -euo pipefail
APP_HOME="${POSTYAR_HOME:-${HOME}/postelrobbal}"
NODE_BIN="$(cat "${APP_HOME}/config/node.bin" 2>/dev/null || true)"
[ -n "${NODE_BIN}" ] || NODE_BIN="/opt/cpanel/ea-nodejs22/bin/node"
[ -x "${NODE_BIN}" ] || { echo "Postyar: Node.js 22 executable not found: ${NODE_BIN}" >&2; exit 1; }
[ -f "${APP_HOME}/workers/run-worker.sh" ] || { echo "Postyar: worker launcher missing: ${APP_HOME}/workers/run-worker.sh" >&2; exit 1; }
[ -f "${APP_HOME}/workers/worker.js" ] || { echo "Postyar: worker entry missing: ${APP_HOME}/workers/worker.js" >&2; exit 1; }
mkdir -p "${APP_HOME}/logs" "${APP_HOME}/run"
chmod 700 "${APP_HOME}/logs" "${APP_HOME}/run" 2>/dev/null || true
PIDS="$(pgrep -u "$(id -u)" -x postyar-worker 2>/dev/null || true)"
[ -z "${PIDS}" ] || kill -TERM ${PIDS} 2>/dev/null || true
for _ in $(seq 1 40); do
  PIDS="$(pgrep -u "$(id -u)" -x postyar-worker 2>/dev/null || true)"
  [ -z "${PIDS}" ] && break
  sleep 0.25
done
PIDS="$(pgrep -u "$(id -u)" -x postyar-worker 2>/dev/null || true)"
[ -z "${PIDS}" ] || kill -KILL ${PIDS} 2>/dev/null || true
rm -f "${APP_HOME}/run/worker.pid"
nohup env POSTYAR_HOME="${APP_HOME}" /usr/bin/flock -n "${APP_HOME}/run/worker.lock" bash "${APP_HOME}/workers/run-worker.sh" >> "${APP_HOME}/logs/worker.log" 2>&1 </dev/null &
sleep 3
PIDS="$(pgrep -u "$(id -u)" -x postyar-worker 2>/dev/null || true)"
COUNT="$(printf '%s\n' "${PIDS}" | awk 'NF{n++} END{print n+0}')"
[ "${COUNT}" -eq 1 ] || { echo "Postyar: expected exactly one worker, found ${COUNT}: ${PIDS}" >&2; exit 1; }
PID="$(printf '%s\n' "${PIDS}" | head -n1)"
printf '%s\n' "${PID}" > "${APP_HOME}/run/worker.pid"
if /usr/bin/flock -n "${APP_HOME}/run/worker.lock" -c ':' >/dev/null 2>&1; then
  echo "Postyar: worker.lock is not held." >&2
  exit 1
fi
echo "Postyar worker restarted: PID ${PID}"
