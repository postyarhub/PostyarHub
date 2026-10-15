import { and, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { goldConfigs, outboxEvents, plans, postTargets, posts, subscriptions } from '../db/schema.js';
import { outboxRow } from '../core/outbox.js';
import { enqueue } from '../queue/queues.js';
import { emitEvent } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { createExpiryWarning } from '../modules/notifications/delivery.js';
import { refreshPostAggregate } from '../core/post-aggregate.js';
import { runGoldCheck } from '../modules/gold/gold.service.js';
import { runDueCampaigns } from '../modules/wordpress/campaign.service.js';

/**
 * Scheduler tick (§126-127): claim due work into queues, then exit. Every
 * section is bounded (LIMIT 500) and idempotent — state flips are guarded by
 * a WHERE clause so a re-run tick can never double-claim.
 */

const log = createLogger('scheduler-tick');
const SECTION_LIMIT = 500;

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

export interface SchedulerTickResult {
  scheduledPosts: number;
  retries: number;
  goldRuns: number;
  expiryChecks: number;
  campaignRuns: number;
}

export interface DeliveryRecoveryTickResult {
  scheduledPosts: number;
  retries: number;
  pendingRecoveries: number;
}

/**
 * Delivery-lane recovery is independent from maintenance-heavy scheduler work.
 * The worker runs it every 30 seconds as a safety net; the scheduler runs it
 * once per minute as the normal clock. Every state transition is conditional
 * so overlapping ticks converge without double-claiming.
 */
export async function runDeliveryRecoveryTick(now = new Date()): Promise<DeliveryRecoveryTickResult> {
  const db = getDb();
  let scheduledPosts = 0;
  let retries = 0;
  let pendingRecoveries = 0;

  // Due scheduled posts → QUEUED + outbox row (relayed to per-target jobs).
  const duePosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.state, 'SCHEDULED'), lte(posts.scheduledAt, now)))
    .limit(SECTION_LIMIT);
  for (const due of duePosts) {
    await db.transaction(async (tx) => {
      const flipped = await tx
        .update(posts)
        .set({ state: 'QUEUED' })
        .where(and(eq(posts.id, due.id), eq(posts.state, 'SCHEDULED')));
      if (affectedRowsOf(flipped) === 0) return false;
      await tx.insert(outboxEvents).values(
        outboxRow({ aggregateType: 'post', aggregateId: due.id, eventType: 'post.publish', payload: {} })
      );
      return true;
    }).then(async (claimed) => {
      if (claimed) {
        scheduledPosts++;
        // If every scheduled destination was already SENT, there is no delivery
        // work to queue; restore the aggregate instead of leaving QUEUED forever.
        const [pendingTarget] = await db
          .select({ id: postTargets.id })
          .from(postTargets)
          .where(and(eq(postTargets.postId, due.id), eq(postTargets.state, 'PENDING')))
          .limit(1);
        if (!pendingTarget) await refreshPostAggregate(due.id);
      }
    });
  }


  // Recovery lane: every tick re-enqueues undelivered targets of queued or
  // partially-started posts. This is deliberately DB-driven, so an interrupted
  // Redis enqueue/outbox relay cannot strand a post in «در انتظار ارسال».
  const queuedTargets = await db
    .select({ id: postTargets.id, updatedAt: postTargets.updatedAt })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(
      and(
        inArray(posts.state, ['QUEUED', 'PUBLISHING']),
        inArray(postTargets.state, ['PENDING'])
      )
    )
    .limit(SECTION_LIMIT);
  for (const target of queuedTargets) {
    try {
      await enqueue('delivery', 'deliver', { targetId: target.id }, { jobId: `recover:${target.id}:${target.updatedAt.getTime()}` });
      pendingRecoveries++;
    } catch (err) {
      log.warn({ err, targetId: target.id }, 'pending_delivery_enqueue_failed');
    }
  }

  // Due retries → PENDING + immediate delivery job.
  const dueRetries = await db
    .select({ id: postTargets.id, postId: postTargets.postId, postState: posts.state })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.state, 'RETRYING'), or(isNull(postTargets.nextRetryAt), lte(postTargets.nextRetryAt, now))))
    .limit(SECTION_LIMIT);
  for (const target of dueRetries) {
    if (!['QUEUED', 'PUBLISHING', 'SCHEDULED'].includes(target.postState)) {
      const cancelled = await db
        .update(postTargets)
        .set({ state: 'CANCELLED', nextRetryAt: null })
        .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'RETRYING')));
      if (affectedRowsOf(cancelled) > 0) await refreshPostAggregate(target.postId);
      continue;
    }
    const claimed = await db
      .update(postTargets)
      .set({ state: 'PENDING' })
      .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'RETRYING')));
    if (affectedRowsOf(claimed) > 0) {
      try {
        await enqueue('delivery', 'deliver', { targetId: target.id }, { jobId: `retry:${target.id}:${now.getTime()}` });
        retries++;
      } catch (err) {
        // Redis may fail after the DB claim. Put the target back into the retry
        // lane so a later scheduler tick can recover it instead of stranding it.
        await db.update(postTargets)
          .set({ state: 'RETRYING', nextRetryAt: new Date(Date.now() + 60_000) })
          .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'PENDING')));
        log.warn({ err, targetId: target.id }, 'retry_enqueue_failed_requeued');
      }
    }
  }


  return { scheduledPosts, retries, pendingRecoveries };
}

export async function runSchedulerTick(): Promise<SchedulerTickResult> {
  const db = getDb();
  const now = new Date();
  const deliveryRecovery = await runDeliveryRecoveryTick(now);
  const scheduledPosts = deliveryRecovery.scheduledPosts;
  const retries = deliveryRecovery.retries;
  let goldRuns = 0;
  let expiryChecks = 0;
  let campaignRuns = 0;

  // 2) Stale PROCESSING recovery: a worker crash after the atomic claim can
  // otherwise leave a target forever unqueueable. We do NOT auto-requeue it,
  // because the external provider may already have accepted the message.
  // Marking it FAILED makes the condition visible and requires an explicit,
  // human-approved retry that can be reconciled for duplicates.
  const processingCutoff = new Date(now.getTime() - 10 * 60_000);
  const staleProcessing = await db
    .select({ id: postTargets.id, postId: postTargets.postId, attempts: postTargets.attempts, postState: posts.state })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.state, 'PROCESSING'), lte(postTargets.updatedAt, processingCutoff)))
    .limit(SECTION_LIMIT);
  for (const target of staleProcessing) {
    const cancelledParent = target.postState === 'CANCELLED' || target.postState === 'DRAFT';
    const repaired = await db
      .update(postTargets)
      .set(cancelledParent
        ? { state: 'CANCELLED', nextRetryAt: null }
        : {
            state: 'FAILED',
            attempts: target.attempts + 1,
            nextRetryAt: null,
            errorCode: 'WORKER_STALE',
            errorMessage: 'پردازش ارسال بیش از حد طولانی در وضعیت نامشخص مانده است؛ برای جلوگیری از ارسال تکراری، توقف داده شد. قبل از تلاش مجدد مقصد را بررسی کنید.',
          })
      .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'PROCESSING'), lte(postTargets.updatedAt, processingCutoff)));
    if (affectedRowsOf(repaired) > 0 && !cancelledParent) {
      await refreshPostAggregate(target.postId);
    }
  }

  // 4) Maintenance: enqueue at most one bounded retention/reaper sweep per UTC day.
  // A durable BullMQ job keeps cleanup alive without spawning a process from the scheduler.
  const maintenanceDay = now.toISOString().slice(0, 10);
  try {
    await enqueue('maintenance', 'sweep', {}, { jobId: `maintenance-${maintenanceDay}` });
  } catch (err) {
    log.warn({ err }, 'maintenance_enqueue_failed');
  }

  // 5) Gold ticker: enabled configs past their frequency window.
  const goldRows = await db.select().from(goldConfigs).where(eq(goldConfigs.isEnabled, 1)).limit(SECTION_LIMIT);
  for (const config of goldRows) {
    const due = !config.lastRunAt || now.getTime() - config.lastRunAt.getTime() >= config.frequencyMinutes * 60_000;
    if (!due) continue;
    try {
      const result = await runGoldCheck(config.id);
      if (result.ok) goldRuns++;
    } catch (err) {
      // Per-config isolation: one broken source must not starve other sections.
      log.warn({ err, configId: config.id }, 'gold_tick_failed');
    }
  }

  // 6) WordPress/WooCommerce campaigns: each campaign is internally isolated.
  // A failure in one campaign never aborts the scheduler lanes below.
  try {
    campaignRuns = await runDueCampaigns();
  } catch (err) {
    log.warn({ err }, 'wordpress_campaign_tick_failed');
  }

  // 6a) Expiring subscriptions: T-7d warning, exactly-once via unique key.
  const warningHorizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const expiring = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.state, 'ACTIVE'),
        // Free-plan subscribers must never receive paid-expiry renewal warnings.
        // The scheduler warning is only meaningful for a paid plan.
        // `plans.code` is the canonical stable discriminator.
        ne(plans.code, 'free'),
        lte(subscriptions.expiresAt, warningHorizon),
        gt(subscriptions.expiresAt, now),
        sql`NOT EXISTS (
          SELECT 1
          FROM subscriptions newer
          WHERE newer.tenant_id = ${subscriptions.tenantId}
            AND newer.state = 'ACTIVE'
            AND newer.expires_at > ${now}
            AND newer.created_at > ${subscriptions.createdAt}
        )`
      )
    )
    .limit(SECTION_LIMIT);
  for (const subscription of expiring) {
    await createExpiryWarning({ id: subscription.id, tenantId: subscription.tenantId, expiresAt: subscription.expiresAt }).catch(
      () => undefined
    );
    expiryChecks++;
  }

  // 5b) Lapsed subscriptions → EXPIRED + event.
  const lapsed = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .where(and(eq(subscriptions.state, 'ACTIVE'), lt(subscriptions.expiresAt, now)))
    .limit(SECTION_LIMIT);
  for (const subscription of lapsed) {
    const expired = await db
      .update(subscriptions)
      .set({ state: 'EXPIRED' })
      .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.state, 'ACTIVE')));
    if (affectedRowsOf(expired) > 0) {
      await emitEvent({
        name: 'subscription.expired',
        tenantId: subscription.tenantId,
        subjectType: 'subscription',
        subjectId: subscription.id,
      });
      expiryChecks++;
    }
  }

  return { scheduledPosts, retries, goldRuns, expiryChecks, campaignRuns };
}
