'use strict';

// Postyar Passenger entry. cPanel/Passenger treats postelrobbal/api as the
// Node application root. Keep the environment loader here and make both the
// cPanel-installed node_modules and the bundled app/node_modules visible.
const path = require('node:path');
const Module = require('node:module');

require('../config/load-env.cjs');

// POSTYAR-SEC03-PRODUCTION-ENTRY-GUARD-20261014-R1
if (process.env.NODE_ENV !== 'production') {
  console.error('[postyar] Passenger API refuses to start unless NODE_ENV is production.');
  process.exit(1);
}

const nodeModulePaths = [
  path.join(__dirname, 'node_modules'),
  path.join(__dirname, '..', 'app', 'node_modules'),
  process.env.NODE_PATH,
].filter(Boolean);
process.env.NODE_PATH = nodeModulePaths.join(path.delimiter);
Module._initPaths();

require(path.join(__dirname, '..', 'app', 'dist', 'server.js'));
