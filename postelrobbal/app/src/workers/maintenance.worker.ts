import { Job } from 'bullmq';
import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { events, linkClicks, botEvents, mediaAccessTokens, idempotencyKeys, postTargets, posts, notificationOutbound, aiJobs } from '../db/schema.js';
import { refreshPostAggregate } from '../core/post-aggregate.js';
import { createWorker } from '../queue/connection.js';
import { createLogger } from '../core/logger.js';
import { sweepExpiredSessions } from '../security/sessions.js';

/**
 * Maintenance worker (§106-108): bounded retention sweeps. Every delete runs
 * in batches (LIMIT 1000) with a hard iteration cap so a large backlog can
 * never stall the worker or hold long table locks.
 */

const log = createLogger('maintenance-worker');

const BATCH = 1000;
const MAX_ITERATIONS = 20;
const RETENTION_DAYS_EVENTS = 180;
const RETENTION_DAYS_CLICKS = 180;
const RETENTION_DAYS_BOT_EVENTS = 90;

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

async function batchedDelete(table: typeof events | typeof linkClicks | typeof botEvents, where: SQL): Promise<number> {
  const db = getDb();
  let deleted = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await db.delete(table).where(where).limit(BATCH);
    const affected = affectedRowsOf(res);
    deleted += affected;
    if (affected < BATCH) break;
  }
  return deleted;
}

export async function runRetentionSweep(): Promise<Record<string, number>> {
  const now = Date.now();
  const db = getDb();

  const eventsDeleted = await batchedDelete(events, lt(events.createdAt, new Date(now - RETENTION_DAYS_EVENTS * 86400_000)));
  const clicksDeleted = await batchedDelete(linkClicks, lt(linkClicks.createdAt, new Date(now - RETENTION_DAYS_CLICKS * 86400_000)));
  const botEventsDeleted = await batchedDelete(
    botEvents,
    sql`${botEvents.state} = 'PROCESSED' AND ${botEvents.createdAt} < ${new Date(now - RETENTION_DAYS_BOT_EVENTS * 86400_000)}`
  );

  // Expired transient rows: single bounded pass per sweep.
  await db.delete(mediaAccessTokens).where(lt(mediaAccessTokens.expiresAt, new Date()));
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  await sweepExpiredSessions();

  // Safety reaper: external-side-effect jobs that remain PROCESSING for an
  // extended period are marked FAILED rather than auto-requeued. The provider
  // may have accepted the request before a worker crash; automatic replay could
  // create duplicate posts/messages. Manual retry can be an explicit operator
  // action after inspecting the provider state.
  const stuckCutoff = new Date(now - 30 * 60_000);
  const staleDeliveries = await db
    .select({ id: postTargets.id, postId: postTargets.postId, postState: posts.state })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.state, 'PROCESSING'), lt(postTargets.updatedAt, stuckCutoff)))
    .limit(100);
  let reapedCount = 0;
  for (const target of staleDeliveries) {
    const reaped = await db
      .update(postTargets)
      .set(target.postState === 'CANCELLED' || target.postState === 'DRAFT'
        ? { state: 'CANCELLED', nextRetryAt: null }
        : {
            state: 'FAILED',
            nextRetryAt: null,
            errorCode: 'WORKER_STALE',
            errorMessage: 'پردازش ارسال بیش از حد طولانی در وضعیت نامشخص مانده است؛ برای جلوگیری از ارسال تکراری، توقف داده شد. قبل از تلاش مجدد مقصد را بررسی کنید.',
          })
      .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'PROCESSING'), lt(postTargets.updatedAt, stuckCutoff)));
    const affected = affectedRowsOf(reaped);
    reapedCount += affected;
    if (affected > 0 && target.postState !== 'CANCELLED' && target.postState !== 'DRAFT') {
      await refreshPostAggregate(target.postId);
    }
  }

  const staleBotEvents = await db
    .select({ id: botEvents.id })
    .from(botEvents)
    .where(and(eq(botEvents.state, 'PROCESSING'), lt(botEvents.createdAt, stuckCutoff)))
    .limit(100);
  let botEventsReaped = 0;
  for (const event of staleBotEvents) {
    const result = await db
      .update(botEvents)
      .set({ state: 'FAILED', processedAt: new Date() })
      .where(and(eq(botEvents.id, event.id), eq(botEvents.state, 'PROCESSING'), lt(botEvents.createdAt, stuckCutoff)));
    botEventsReaped += affectedRowsOf(result);
  }

  const notifCutoff = new Date(now - 30 * 60_000);
  const staleNotificationOutbound = await db
    .select({ id: notificationOutbound.id })
    .from(notificationOutbound)
    .where(and(eq(notificationOutbound.state, 'PROCESSING'), lt(notificationOutbound.updatedAt, notifCutoff)))
    .limit(100);
  let notificationOutboundReaped = 0;
  for (const row of staleNotificationOutbound) {
    const result = await db
      .update(notificationOutbound)
      .set({ state: 'FAILED', lastError: 'پردازش اعلان در وضعیت نامشخص بیش از حد طولانی ماند؛ برای جلوگیری از ارسال تکراری، متوقف شد.' })
      .where(and(eq(notificationOutbound.id, row.id), eq(notificationOutbound.state, 'PROCESSING'), lt(notificationOutbound.updatedAt, notifCutoff)));
    notificationOutboundReaped += affectedRowsOf(result);
  }

  // AI calls are billable external side effects. A worker crash can leave a job
  // RUNNING forever; mark stale runs failed instead of replaying them silently.
  const aiCutoff = new Date(now - 30 * 60_000);
  const staleAiJobs = await db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(and(eq(aiJobs.status, 'RUNNING'), lt(aiJobs.createdAt, aiCutoff)))
    .limit(100);
  let aiJobsReaped = 0;
  for (const row of staleAiJobs) {
    const result = await db
      .update(aiJobs)
      .set({ status: 'FAILED', errorCode: 'AI_WORKER_STALE', finishedAt: new Date() })
      .where(and(eq(aiJobs.id, row.id), eq(aiJobs.status, 'RUNNING'), lt(aiJobs.createdAt, aiCutoff)));
    aiJobsReaped += affectedRowsOf(result);
  }

  return {
    events: eventsDeleted,
    linkClicks: clicksDeleted,
    botEvents: botEventsDeleted,
    stuckDeliveriesReaped: reapedCount,
    botEventsReaped,
    notificationOutboundReaped,
    aiJobsReaped,
  };
}

export function startMaintenanceWorker() {
  // createWorker's processor parameter resolves to `never` due to a broken
  // conditional type in queue/connection.ts — bridge it without losing typing.
  const processor = async (job: Job): Promise<void> => {
    if (job.name !== 'sweep') {
      log.warn({ jobName: job.name }, 'unknown_maintenance_job');
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await runRetentionSweep();
      log.info({ ...result, durationMs: Date.now() - startedAt }, 'maintenance_sweep_complete');
    } catch (err) {
      log.error({ err }, 'maintenance_sweep_failed');
      throw err; // BullMQ retry policy applies
    }
  };
  return createWorker('maintenance', processor as unknown as never, { concurrency: 1 });
}

/** Scheduler convenience: enqueue one sweep pass. */
export async function enqueueSweep(): Promise<void> {
  const { enqueue } = await import('../queue/queues.js');
  await enqueue('maintenance', 'sweep', {});
}
