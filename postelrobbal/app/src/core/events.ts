import { getDb } from '../db/client.js';
import { events, eventDaily } from '../db/schema.js';
import { newId } from './ids.js';
import { sql } from 'drizzle-orm';
import { recordAnalyticsEvent } from '../modules/analytics/analytics.service.js';
import { enqueue } from '../queue/queues.js';

/**
 * Analytics event emission (§24, §165). No credentials/tokens/secrets in props.
 * Aggregates into event_daily (read model §99) inside the same call — cheap
 * single upsert, bounded by event whitelist.
 */
export const ALLOWED_EVENTS = new Set<string>([
  'user.registration', 'user.login', 'user.logout',
  'channel.created', 'channel.connected', 'channel.disconnected', 'channel.updated',
  'post.created', 'post.scheduled', 'post.sent', 'post.failed',
  'bot.created', 'bot.enabled', 'bot.disabled', 'bot.message.received', 'bot.message.sent', 'bot.button.clicked',
  'workflow.started', 'workflow.completed', 'workflow.failed',
  'ai.requested', 'ai.completed', 'ai.failed',
  'wordpress.connected', 'wordpress.product.synced', 'wordpress.product.published', 'wordpress.content.published',
  'wordpress.campaign.created', 'wordpress.campaign.updated', 'wordpress.campaign.deleted',
  'wordpress.campaign.run.started', 'wordpress.campaign.run.completed', 'wordpress.campaign.run.failed',
  'link.clicked',
  'subscription.created', 'subscription.renewed', 'subscription.expiring', 'subscription.expired',
  'payment.created', 'payment.completed', 'payment.failed',
  'wallet.credit', 'wallet.debit', 'referral.created', 'referral.rewarded',
]);

const EMAIL_EVENT_NAMES = new Set(['user.registration', 'payment.completed', 'payment.failed', 'subscription.created', 'subscription.renewed', 'subscription.expiring', 'subscription.expired']);

export function sanitizeProps(props: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!props) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (/secret|token|password|key|credential/i.test(k)) continue; // never store credential-like keys
    if (typeof v === 'string' && v.length > 500) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string')) clean[k] = v;
  }
  return clean;
}

export async function emitEvent(input: {
  name: string;
  tenantId?: string | null;
  subjectType?: string;
  subjectId?: string;
  props?: Record<string, unknown>;
  analyticsDedupeKey?: string | null;
}): Promise<void> {
  if (!ALLOWED_EVENTS.has(input.name)) return;
  const db = getDb();
  const tenantId = input.tenantId ?? null;
  const eventId = newId();
  await db.insert(events).values({
    id: eventId,
    tenantId,
    name: input.name,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    propsJson: sanitizeProps(input.props),
  });

  // Enqueue a small event record only. Recipient lookup and SMTP delivery
  // happen in the notification worker and cannot hold a business request open.
  if (EMAIL_EVENT_NAMES.has(input.name)) {
    try {
      await enqueue('notifications', 'business-email-event', {
        eventId,
        name: input.name,
        tenantId,
        subjectId: input.subjectId,
        props: sanitizeProps(input.props) ?? {},
      }, { jobId: 'business-email-event:' + eventId });
    } catch (err) {
      const code = typeof (err as { code?: unknown })?.code === 'string'
        ? String((err as { code: string }).code).slice(0, 40) : 'QUEUE_ERROR';
      console.warn('[email-notifications] event enqueue failed', { eventName: input.name, reason: code });
    }
  }
  if (tenantId) {
    const day = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await db
      .insert(eventDaily)
      .values({ tenantId, day, eventName: input.name, eventCount: 1 })
      .onDuplicateKeyUpdate({ set: { eventCount: sql`${eventDaily.eventCount} + 1` } });
  }

  // The new analytics engine mirrors the legacy event bus instead of replacing it.
  // Analytics failure must never fail the business operation that emitted the event.
  try {
    const props = sanitizeProps(input.props) ?? {};
    const subjectType = input.subjectType ?? '';
    await recordAnalyticsEvent({
      userId: tenantId,
      eventType: input.name,
      postId: subjectType === 'post' ? input.subjectId : asString(props.postId),
      targetId: subjectType === 'post_target' || subjectType === 'target' ? input.subjectId : asString(props.targetId),
      channelId: subjectType === 'channel' ? input.subjectId : asString(props.channelId),
      campaignId: subjectType === 'wordpress_campaign' || subjectType === 'campaign' ? input.subjectId : asString(props.campaignId),
      linkId: subjectType === 'link' ? input.subjectId : asString(props.linkId),
      platform: asString(props.platform),
      source: asString(props.source),
      value:
        input.name === 'payment.completed'
          ? (asNumber(props.amountRial) ?? 1)
          : input.name === 'referral.rewarded'
            ? (asNumber(props.points) ?? 1)
            : (asNumber(props.value) ?? 1),
      metadata: props,
      dedupeKey: input.analyticsDedupeKey ?? asString(props.dedupeKey),
    });
  } catch (err) {
    // Keep legacy analytics authoritative for current dashboards if the new read model is unavailable.
    console.warn('[analytics] mirror failed', { event: input.name, tenantId, err });
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
