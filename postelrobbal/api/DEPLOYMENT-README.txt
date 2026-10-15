Postyar Node application root: this directory (postelrobbal/api).

cPanel / CloudLinux:
- Node.js version: 22.x
- Application root: postelrobbal/api
- Startup file: app.js
- Run NPM Install: supported here because package.json is present in this directory.

The application code is compiled under ../app/dist and resolves runtime dependencies
from api/node_modules first. The worker and scheduler shims use the same runtime dependency
directory, with app/node_modules retained only as a local-development fallback.

Keep the real environment file at ../config/.env and never replace it with the release archive's .env.example.

After replacing the release, restart the Node application and then run:
  cd "$HOME/postelrobbal"
  ./workers/restart-worker.sh

The scheduler is tick-based and should continue to run from the existing cron entry:
  * * * * * /path/to/postelrobbal/scheduler/run-scheduler.sh

Do not run npm install in ../app. The cPanel Node application's package.json lives in ../api.
