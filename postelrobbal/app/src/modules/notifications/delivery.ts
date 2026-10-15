import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { notifications, notificationOutbound, users, channels } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { enqueue } from '../../queue/queues.js';
import { getProvider } from '../../providers/index.js';
import { decryptSecret } from '../../security/encryption.js';
import { emitEvent } from '../../core/events.js';

/**
 * Notification orchestration (§27) — separate from provider adapters.
 * In-app rows are created synchronously (cheap); channel/email/SMS sends are
 * enqueued. The in-app 7-day expiry warning is protected by a DB unique key
 * on (tenant_id, kind, subject_id); channel delivery has its own outbound/job
 * idempotency keys — exactly-once per subscription (§26).
 */
export async function notifyTenant(input: {
  tenantId: string;
  kind: string;
  titleFa: string;
  bodyFa: string;
  subjectId?: string;
}): Promise<boolean> {
  const db = getDb();
  try {
    await db.insert(notifications).values({
      id: newId(),
      tenantId: input.tenantId,
      kind: input.kind,
      subjectId: input.subjectId ?? null,
      titleFa: input.titleFa,
      bodyFa: input.bodyFa,
    });
    return true;
  } catch (err) {
    const e = err as { code?: string; errno?: number; message?: string };
    if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062 || /Duplicate entry/i.test(String(e.message ?? ''))) return false;
    throw err;
  }
}

export async function enqueuePasswordResetDelivery(userId: string, token: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select({ email: users.email, mobile: users.mobile }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  await enqueue('notifications', 'password-reset', {
    kind: 'PASSWORD_RESET',
    tenantId: userId,
    email: user.email,
    mobile: user.mobile,
    token,
  });
}

/**
 * Seven-day subscription expiry warning (§26): durable, idempotent.
 * Creates an idempotent in-app row and durable outbound records; the unique
 * keys guarantee the same logical warning is not duplicated for one subscription.
 */
export async function createExpiryWarning(subscription: {
  id: string;
  tenantId: string;
  expiresAt: Date;
}): Promise<void> {
  const db = getDb();
  const title = 'اشتراک شما به‌زودی منقضی می‌شود';
  const body = `اشتراک شما در پُست‌یار تا تاریخ انقضا به پایان می‌رسد. برای جلوگیری از وقفه در سرویس، اشتراک خود را تمدید کنید.`;

  // In-app delivery is idempotent by (tenant_id, kind, subject_id);
  // channel delivery has independent outbound/job idempotency keys.
  await notifyTenant({
    tenantId: subscription.tenantId,
    kind: 'SUBSCRIPTION_EXPIRY_7D',
    subjectId: subscription.id,
    titleFa: title,
    bodyFa: body,
  });
  // Message destinations: publish through the tenant's active channels once each
  const tenantChannels = await db
    .select({ id: channels.id, platform: channels.platform, channelRef: channels.channelRef, status: channels.status })
    .from(channels)
    .where(and(eq(channels.tenantId, subscription.tenantId), eq(channels.status, 'ACTIVE')));

  for (const ch of tenantChannels) {
    const destination = ch.platform.toUpperCase() as 'TELEGRAM' | 'BALE' | 'RUBIKA';
    await db
      .insert(notificationOutbound)
      .values({
        id: newId(),
        kind: 'SUBSCRIPTION_EXPIRY_7D',
        subjectId: subscription.id,
        tenantId: subscription.tenantId,
        channelId: ch.id,
        destination,
        state: 'PENDING',
      })
      .onDuplicateKeyUpdate({ set: { subjectId: subscription.id } });
    await enqueue('notifications', 'expiry-warning', {
      outboundKind: 'SUBSCRIPTION_EXPIRY_7D',
      subjectId: subscription.id,
      destination,
      platform: ch.platform,
      channelId: ch.id,
      channelRef: ch.channelRef,
      tenantId: subscription.tenantId,
      title,
      body,
    }, { jobId: `expw:${subscription.id}:${ch.id}` });
  }
  await emitEvent({ name: 'subscription.expiring', tenantId: subscription.tenantId, subjectType: 'subscription', subjectId: subscription.id });
}

/** Used by the notifications worker to actually deliver channel messages. */
export async function deliverChannelNotification(job: {
  platform: 'telegram' | 'bale' | 'rubika';
  channelId: string;
  channelRef: string;
  tenantId: string;
  title: string;
  body: string;
  outboundKind: string;
  subjectId: string;
  destination: string;
}): Promise<void> {
  const db = getDb();
  const provider = getProvider(job.platform);
  const { bots } = await import('../../db/schema.js');
  const [channel] = await db
    .select({ id: channels.id, channelRef: channels.channelRef, botId: channels.botId, platform: channels.platform })
    .from(channels)
    .where(and(eq(channels.id, job.channelId), eq(channels.tenantId, job.tenantId), eq(channels.platform, job.platform), eq(channels.status, 'ACTIVE')))
    .limit(1);
  if (!channel) return;

  const [bot] = await db
    .select()
    .from(bots)
    .where(and(eq(bots.id, channel.botId ?? ''), eq(bots.tenantId, job.tenantId), eq(bots.platform, job.platform), eq(bots.status, 'ACTIVE')))
    .limit(1);
  const row = await db
    .select()
    .from(notificationOutbound)
    .where(and(eq(notificationOutbound.kind, job.outboundKind), eq(notificationOutbound.subjectId, job.subjectId), eq(notificationOutbound.channelId, channel.id), eq(notificationOutbound.destination, job.destination as 'TELEGRAM')))
    .limit(1);

  const outboundRow = row[0];
  if (!outboundRow) return;

  // Claim atomically before any provider side effect. Without a durable claim,
  // duplicate BullMQ jobs can deliver the same notification more than once.
  const claimed = await db
    .update(notificationOutbound)
    .set({ state: 'PROCESSING', attempts: sql`${notificationOutbound.attempts} + 1` })
    .where(and(eq(notificationOutbound.id, outboundRow.id), eq(notificationOutbound.state, 'PENDING')));
  const claimedRows = Array.isArray(claimed)
    ? Number((claimed[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0)
    : Number((claimed as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  if (claimedRows === 0) return;

  const markFailed = async (err: string) => {
    await db
      .update(notificationOutbound)
      .set({ state: 'FAILED', lastError: err.slice(0, 250) })
      .where(and(eq(notificationOutbound.id, outboundRow.id), eq(notificationOutbound.state, 'PROCESSING')));
  };
  const markSent = async () => {
    await db
      .update(notificationOutbound)
      .set({ state: 'SENT', sentAt: new Date() })
      .where(and(eq(notificationOutbound.id, outboundRow.id), eq(notificationOutbound.state, 'PROCESSING')));
  };

  if (!bot) {
    await markFailed('ربات فعال برای این پلتفرم یافت نشد.');
    return;
  }
  try {
    const token = decryptSecret(bot.tokenEncrypted);
    await provider.sendText(token, { chatRef: channel.channelRef, text: `${job.title}\n\n${job.body}` });
    await markSent();
  } catch (err) {
    await markFailed((err as Error).message);
  }
}
