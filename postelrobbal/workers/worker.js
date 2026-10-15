// Postyar worker entry shim — started by cron (@reboot, flock-guarded, §68).
// Never auto-spawned by the API. Resolves postelrobbal/app relative to itself.
require('../config/load-env.cjs');
const path = require('path');
const Module = require('module');
const appRoot = path.join(__dirname, '..', 'app');
const runtimeNodeModules = path.join(__dirname, '..', 'api', 'node_modules');
const fallbackNodeModules = path.join(appRoot, 'node_modules');
const paths = [runtimeNodeModules, fallbackNodeModules, process.env.NODE_PATH].filter(Boolean);
process.env.NODE_PATH = paths.join(path.delimiter);
Module._initPaths();
process.chdir(appRoot);
require(path.join(appRoot, 'dist', 'worker.js'));
