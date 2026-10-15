import { buildApp } from './app/buildApp.js';
import { registerApiRoutes } from './app/routes.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './core/logger.js';
import { initializeDbSessions, closeDb } from './db/client.js';
import { closeRedis } from './queue/connection.js';
import { closeCaptchaStore } from './security/captcha.js';

/** API entry — one process (§54). Passenger provides PORT. */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger('api');
  await initializeDbSessions();
  const app = await buildApp();
  await registerApiRoutes(app);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'graceful_shutdown_begin');
    try {
      await app.close();
      await closeDb();
      await closeRedis();
      await closeCaptchaStore();
      log.info('graceful_shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown_error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info({ port: env.PORT }, 'api_started');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
