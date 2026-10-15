import { loadEnv } from './config/env.js';
process.title = 'postyar-worker';
import { createLogger } from './core/logger.js';
import { getRedis, closeRedis } from './queue/connection.js';
import { closeQueues } from './queue/queues.js';
import { initializeDbSessions, closeDb } from './db/client.js';
import { startDeliveryWorker } from './workers/delivery.worker.js';
import { startBotEventWorker } from './workers/botEvent.worker.js';
import { startAiWorker } from './workers/ai.worker.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { startMaintenanceWorker } from './workers/maintenance.worker.js';
import { startBotPollingWorker } from './workers/botPolling.worker.js';
import { runDeliveryRecoveryTick } from './workers/scheduler.tick.js';
import { relayOutbox } from './core/outbox.js';
import { outboxDispatcher } from './workers/dispatcher.js';

/**
 * Worker entry — single instance. Delivery recovery is also driven here every
 * 30 seconds so scheduled posts and due retries cannot remain stranded when a
 * cron scheduler tick is delayed or unavailable. All recovery transitions are
 * guarded in the database, so the worker and scheduler can safely overlap.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger('worker');
  await initializeDbSessions();
  await getRedis().ping();

  const workers = [
    startDeliveryWorker(),
    startBotEventWorker(),
    startAiWorker(),
    startNotificationWorker(),
    startMaintenanceWorker(),
    startBotPollingWorker(),
  ];

  let recoveryRunning = false;
  const runRecovery = async (reason: 'startup' | 'interval') => {
    if (recoveryRunning) return;
    recoveryRunning = true;
    try {
      const recovery = await runDeliveryRecoveryTick();
      const relayed = await relayOutbox(outboxDispatcher);
      if (recovery.scheduledPosts || recovery.retries || recovery.pendingRecoveries || relayed) {
        log.info({ reason, ...recovery, relayed }, 'delivery_recovery_tick_complete');
      }
    } catch (err) {
      log.error({ err, reason }, 'delivery_recovery_tick_failed');
    } finally {
      recoveryRunning = false;
    }
  };

  await runRecovery('startup');
  const recoveryTimer = setInterval(() => { void runRecovery('interval'); }, 30_000);
  recoveryTimer.unref();

  const shutdown = async (signal: string) => {
    clearInterval(recoveryTimer);
    log.info({ signal }, 'worker_shutdown_begin');
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeQueues();
      await closeRedis();
      await closeDb();
      log.info('worker_shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'worker_shutdown_error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info({ concurrency: env.WORKER_CONCURRENCY, recoveryIntervalSeconds: 30 }, 'worker_started');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
