#!/usr/bin/env bash
set -euo pipefail
APP_HOME="${POSTYAR_HOME:-${HOME}/postelrobbal}"
NODE_BIN="$(cat "${APP_HOME}/config/node.bin" 2>/dev/null || true)"
[ -n "${NODE_BIN}" ] || NODE_BIN="/opt/cpanel/ea-nodejs22/bin/node"
if [ ! -x "${NODE_BIN}" ] && [ -x "/opt/cpanel/ea-nodejs22/bin/node" ]; then NODE_BIN="/opt/cpanel/ea-nodejs22/bin/node"; fi
[ -x "${NODE_BIN}" ] || { echo "Postyar: Node.js 22 executable not found at $NODE_BIN" >&2; exit 1; }
cd "${APP_HOME}"
exec "${NODE_BIN}" "${APP_HOME}/workers/worker.js" "$@"
