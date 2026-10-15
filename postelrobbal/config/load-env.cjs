'use strict';

/**
 * Minimal dependency-free .env loader for Passenger/cron entry points.
 * Existing process.env values always win over file values.
 */
const fs = require('node:fs');
const path = require('node:path');

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function loadDotEnv(filePath) {
  const resolved = filePath || path.join(__dirname, '.env');
  if (!fs.existsSync(resolved)) return;
  const text = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = stripQuotes(rawValue);
    }
  }
}

loadDotEnv();
module.exports = { loadDotEnv };
