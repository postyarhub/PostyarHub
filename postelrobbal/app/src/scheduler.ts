import { loadEnv } from './config/env.js';
process.title = 'postyar-scheduler';
import { createLogger } from './core/logger.js';
import { getRedis, closeRedis } from './queue/connection.js';
import { newToken } from './core/ids.js';
import { closeQueues, enqueue } from './queue/queues.js';
import { initializeDbSessions, closeDb, getDb } from './db/client.js';
import { relayOutbox } from './core/outbox.js';
import { outboxDispatcher } from './workers/dispatcher.js';
import { runSchedulerTick } from './workers/scheduler.tick.js';

/**
 * Scheduler entry — tick model (§126-127): invoked by cron every minute,
 * acquires a Redis lock, claims due work into queues, relays the outbox,
 * exits. Never spawns unbounded processes.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger('scheduler');
  await initializeDbSessions();
  const redis = getRedis();
  const lockValue = `${process.pid}:${newToken(16)}`;
  const lock = await redis.set(env.SCHEDULER_LOCK_KEY, lockValue, 'EX', 240, 'NX');
  if (lock !== 'OK') {
    // Another scheduler instance holds the tick — exit quietly (§68).
    await closeRedis();
    return;
  }

  let failed = false;
  try {
    const result = await runSchedulerTick();
    const relayed = await relayOutbox(outboxDispatcher);
    log.info({ relayed, ...result }, 'scheduler_tick_complete');
  } catch (err) {
    failed = true;
    log.error({ err }, 'scheduler_tick_failed');
  } finally {
    await closeQueues();
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      env.SCHEDULER_LOCK_KEY,
      lockValue
    ).catch(() => undefined);
    await closeRedis();
    await closeDb();
    void getDb; // keep import stable for future in-tick reads
    void enqueue;
    process.exit(failed ? 1 : 0);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[scheduler] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
