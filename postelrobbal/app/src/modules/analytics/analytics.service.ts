import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { analyticsEvents, analyticsLinkClicks, analyticsLinks, channels, posts, postTargets, wordpressCampaigns, wordpressSites } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';

const ANALYTICS_MAX_DAYS = 90;

// The summary needs metadata for financial/automation events and failed events,
// but not every event row. Keep this fetch bounded to event types that feed those
// calculations; total event count is computed by SQL below.
const ANALYTICS_SUMMARY_EVENT_TYPES: string[] = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'subscription.created',
  'subscription.renewed',
  'subscription.expired',
  'referral.created',
  'referral.rewarded',
  'ai.requested',
  'ai.completed',
  'ai.failed',
  'workflow.started',
  'workflow.completed',
  'workflow.failed',
];
const META_MAX_BYTES = 8192;
const LINK_TOKEN_BYTES = 18;
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,96}$/;

function toFiniteInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length > 800 ? value.slice(0, 800) : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => cleanMetadata(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|token|password|credential|authorization|cookie|api[_-]?key/i.test(key)) continue;
      out[key.slice(0, 80)] = cleanMetadata(item, depth + 1);
      if (Object.keys(out).length >= 100) break;
    }
    return out;
  }
  return null;
}

function metadataJson(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  try {
    const raw = JSON.stringify(cleanMetadata(metadata));
    if (!raw) return null;
    return Buffer.byteLength(raw, 'utf8') > META_MAX_BYTES ? raw.slice(0, META_MAX_BYTES) : raw;
  } catch {
    return null;
  }
}

function safeWindow(days: number): number {
  return Math.min(ANALYTICS_MAX_DAYS, Math.max(1, Math.trunc(days || 30)));
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - safeWindow(days) * 86_400_000);
}

interface RevenueSummary {
  paymentsCreated: number;
  paymentsCompleted: number;
  paymentsCompletedRial: number;
  subscriptionRevenueRial: number;
  walletTopupRial: number;
  paymentsFailed: number;
  subscriptionsCreated: number;
  subscriptionsRenewed: number;
  subscriptionsExpired: number;
  referralsCreated: number;
  referralRewardEvents: number;
  referralRewardPoints: number;
}


export interface AutomationAnalyticsSummary {
  ai: {
    requested: number;
    completed: number;
    failed: number;
    successRate: number | null;
    tokens: number;
    avgDurationMs: number | null;
  };
  workflows: {
    started: number;
    completed: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number | null;
  };
  errors: Array<{ eventType: string; errorCode: string; count: number }>;
}

function summarizeAutomationRows(rows: Array<{ eventType: string; value: unknown; metadataJson?: unknown }>): AutomationAnalyticsSummary {
  let aiRequested = 0;
  let aiCompleted = 0;
  let aiFailed = 0;
  let aiTokens = 0;
  let aiDurationTotal = 0;
  let aiDurationCount = 0;
  let workflowStarted = 0;
  let workflowCompleted = 0;
  let workflowFailed = 0;
  let workflowDurationTotal = 0;
  let workflowDurationCount = 0;
  const errors = new Map<string, { eventType: string; errorCode: string; count: number }>();

  for (const row of rows) {
    const meta = parseMetadata(row.metadataJson);
    const durationMs = numeric(meta.durationMs);
    const errorCode = typeof meta.errorCode === 'string' && meta.errorCode ? meta.errorCode : '';
    switch (row.eventType) {
      case 'ai.requested':
        aiRequested += 1;
        break;
      case 'ai.completed':
        aiCompleted += 1;
        aiTokens += numeric(meta.tokenCount) || numeric(row.value);
        if (durationMs > 0) { aiDurationTotal += durationMs; aiDurationCount += 1; }
        break;
      case 'ai.failed':
        aiFailed += 1;
        if (errorCode) {
          const key = `ai.failed:${errorCode}`;
          const prev = errors.get(key);
          errors.set(key, prev ? { ...prev, count: prev.count + 1 } : { eventType: row.eventType, errorCode, count: 1 });
        }
        break;
      case 'workflow.started':
        workflowStarted += 1;
        break;
      case 'workflow.completed':
        workflowCompleted += 1;
        if (durationMs > 0) { workflowDurationTotal += durationMs; workflowDurationCount += 1; }
        break;
      case 'workflow.failed':
        workflowFailed += 1;
        if (errorCode) {
          const key = `workflow.failed:${errorCode}`;
          const prev = errors.get(key);
          errors.set(key, prev ? { ...prev, count: prev.count + 1 } : { eventType: row.eventType, errorCode, count: 1 });
        }
        break;
      default:
        if (row.eventType.endsWith('.failed') && errorCode) {
          const key = `${row.eventType}:${errorCode}`;
          const prev = errors.get(key);
          errors.set(key, prev ? { ...prev, count: prev.count + 1 } : { eventType: row.eventType, errorCode, count: 1 });
        }
    }
  }

  const errorList = Array.from(errors.values())
    .sort((a, b) => b.count - a.count || a.errorCode.localeCompare(b.errorCode))
    .slice(0, 12);

  return {
    ai: {
      requested: aiRequested,
      completed: aiCompleted,
      failed: aiFailed,
      successRate: aiRequested > 0 ? aiCompleted / aiRequested : null,
      tokens: aiTokens,
      avgDurationMs: aiDurationCount > 0 ? Math.round(aiDurationTotal / aiDurationCount) : null,
    },
    workflows: {
      started: workflowStarted,
      completed: workflowCompleted,
      failed: workflowFailed,
      successRate: workflowStarted > 0 ? workflowCompleted / workflowStarted : null,
      avgDurationMs: workflowDurationCount > 0 ? Math.round(workflowDurationTotal / workflowDurationCount) : null,
    },
    errors: errorList,
  };
}

export function summarizeAutomationEvents(rows: Array<{ eventType: string; value: unknown; metadataJson?: unknown }>): AutomationAnalyticsSummary {
  return summarizeAutomationRows(rows);
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function summarizeRevenue(rows: Array<{ eventType: string; value: unknown; metadataJson?: unknown }>): RevenueSummary {
  const out: RevenueSummary = {
    paymentsCreated: 0,
    paymentsCompleted: 0,
    paymentsCompletedRial: 0,
    subscriptionRevenueRial: 0,
    walletTopupRial: 0,
    paymentsFailed: 0,
    subscriptionsCreated: 0,
    subscriptionsRenewed: 0,
    subscriptionsExpired: 0,
    referralsCreated: 0,
    referralRewardEvents: 0,
    referralRewardPoints: 0,
  };
  for (const row of rows) {
    const value = numeric(row.value);
    const meta = parseMetadata(row.metadataJson);
    switch (row.eventType) {
      case 'payment.created':
        out.paymentsCreated += 1;
        break;
      case 'payment.completed': {
        out.paymentsCompleted += 1;
        out.paymentsCompletedRial += value;
        const purpose = typeof meta.purpose === 'string' ? meta.purpose : '';
        if (purpose === 'SUBSCRIPTION') out.subscriptionRevenueRial += value;
        if (purpose === 'WALLET_TOPUP') out.walletTopupRial += value;
        break;
      }
      case 'payment.failed':
        out.paymentsFailed += 1;
        break;
      case 'subscription.created':
        out.subscriptionsCreated += 1;
        break;
      case 'subscription.renewed':
        out.subscriptionsRenewed += 1;
        break;
      case 'subscription.expired':
        out.subscriptionsExpired += 1;
        break;
      case 'referral.created':
        out.referralsCreated += 1;
        break;
      case 'referral.rewarded':
        out.referralRewardEvents += 1;
        out.referralRewardPoints += numeric(meta.points) || value;
        break;
    }
  }
  return out;
}

function ipHash(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex');
}

function randomToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString('base64url');
}

export interface RecordAnalyticsEventInput {
  userId?: string | null;
  eventType: string;
  occurredAt?: Date;
  postId?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  campaignId?: string | null;
  linkId?: string | null;
  platform?: string | null;
  source?: string | null;
  value?: number | bigint;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

export async function recordAnalyticsEvent(input: RecordAnalyticsEventInput): Promise<void> {
  const db = getDb();
  const normalizedValue = typeof input.value === 'bigint'
    ? input.value
    : BigInt(Math.max(-9_000_000_000_000_000, Math.min(9_000_000_000_000_000, toFiniteInt(input.value, 1))));
  await db.insert(analyticsEvents).values({
    id: newId(),
    userId: input.userId ?? null,
    eventType: input.eventType.slice(0, 64),
    occurredAt: input.occurredAt ?? new Date(),
    postId: input.postId ?? null,
    targetId: input.targetId ?? null,
    channelId: input.channelId ?? null,
    campaignId: input.campaignId ?? null,
    linkId: input.linkId ?? null,
    platform: input.platform?.slice(0, 24) ?? null,
    source: input.source?.slice(0, 32) ?? null,
    value: normalizedValue,
    metadataJson: metadataJson(input.metadata),
    dedupeKey: input.dedupeKey?.slice(0, 191) ?? null,
  });
}

function emptyPlatformMap() {
  return { telegram: { sent: 0, failed: 0 }, bale: { sent: 0, failed: 0 }, rubika: { sent: 0, failed: 0 }, wordpress: { sent: 0, failed: 0 } };
}

function errorKey(name: string): string {
  return name.replace(/^post\./, '').replace(/^wordpress\./, 'wordpress.');
}

export async function getTenantAnalytics(tenantId: string, days = 30) {
  const windowDays = safeWindow(days);
  const since = sinceDate(windowDays);
  const db = getDb();

  const [eventRows, dailyRows, postRows, campaignRows, totalRows] = await Promise.all([
    db.select({ eventType: analyticsEvents.eventType, value: analyticsEvents.value, metadataJson: analyticsEvents.metadataJson })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.userId, tenantId),
        gte(analyticsEvents.occurredAt, since),
        or(
          inArray(analyticsEvents.eventType, ANALYTICS_SUMMARY_EVENT_TYPES),
          like(analyticsEvents.eventType, '%.failed'),
        ),
      )),
    db.select({ day: sql<string>`DATE(${analyticsEvents.occurredAt})`, eventName: analyticsEvents.eventType, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since))).groupBy(sql`DATE(${analyticsEvents.occurredAt})`, analyticsEvents.eventType).orderBy(asc(sql`DATE(${analyticsEvents.occurredAt})`)),
    db.select({ postId: analyticsEvents.postId, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), sql`${analyticsEvents.postId} IS NOT NULL`)).groupBy(analyticsEvents.postId).orderBy(desc(sql`COUNT(*)`)).limit(10),
    db.select({ campaignId: analyticsEvents.campaignId, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), sql`${analyticsEvents.campaignId} IS NOT NULL`)).groupBy(analyticsEvents.campaignId).orderBy(desc(sql`COUNT(*)`)).limit(10),
    db.select({ count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since))),
  ]);
  const [linkRows, platformRows, errorRows] = await Promise.all([
    db.select({ clicks: sql<number>`COALESCE(SUM(${analyticsLinks.clickCount}), 0)` }).from(analyticsLinks).where(eq(analyticsLinks.userId, tenantId)),
    db.select({ platform: analyticsEvents.platform, eventType: analyticsEvents.eventType, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.eventType, ['post.sent', 'post.failed']))).groupBy(analyticsEvents.platform, analyticsEvents.eventType),
    db.select({ eventType: analyticsEvents.eventType, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.eventType, ['post.failed', 'wordpress.campaign.run.failed', 'wordpress.product.failed', 'wordpress.content.failed']))).groupBy(analyticsEvents.eventType).orderBy(desc(sql`COUNT(*)`)).limit(8),
  ]);

  // `value` is semantic payload (for example Rial or points), not an event count.
  // Event KPIs must therefore count rows rather than summing value.
  const totalEvents = toFiniteInt(totalRows[0]?.count);
  const automation = summarizeAutomationRows(eventRows);
  const platforms = emptyPlatformMap();
  let sent = 0;
  let failed = 0;
  for (const row of platformRows) {
    const count = toFiniteInt(row.count);
    if (row.eventType === 'post.sent') sent += count;
    else if (row.eventType === 'post.failed') failed += count;

    const platform = String(row.platform ?? '');
    if (!(platform in platforms)) continue;
    const key = row.eventType === 'post.sent' ? 'sent' : 'failed';
    const bucket = (platforms as Record<string, Record<string, number>>)[platform];
    if (bucket) bucket[key] = count;
  }

  const topPostIds = postRows.map((r) => r.postId).filter((v): v is string => Boolean(v));
  const topCampaignIds = campaignRows.map((r) => r.campaignId).filter((v): v is string => Boolean(v));

  const [topPosts, topCampaigns] = await Promise.all([
    topPostIds.length
      ? db.select({ id: posts.id, title: posts.title, count: sql<number>`COUNT(${analyticsEvents.id})` })
        .from(analyticsEvents)
        .innerJoin(posts, eq(posts.id, analyticsEvents.postId))
        .where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.postId, topPostIds)))
        .groupBy(posts.id, posts.title)
        .orderBy(desc(sql`COUNT(${analyticsEvents.id})`))
        .limit(10)
      : Promise.resolve([]),
    topCampaignIds.length
      ? db.select({ id: wordpressCampaigns.id, name: wordpressCampaigns.name, count: sql<number>`COUNT(${analyticsEvents.id})` })
        .from(analyticsEvents)
        .innerJoin(wordpressCampaigns, eq(wordpressCampaigns.id, analyticsEvents.campaignId))
        .where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.campaignId, topCampaignIds)))
        .groupBy(wordpressCampaigns.id, wordpressCampaigns.name)
        .orderBy(desc(sql`COUNT(${analyticsEvents.id})`))
        .limit(10)
      : Promise.resolve([]),
  ]);

  const revenue = summarizeRevenue(eventRows);

  return {
    days: windowDays,
    from: since.toISOString(),
    to: new Date().toISOString(),
    events: { total: totalEvents, sent, failed },
    successRate: sent + failed > 0 ? Math.round((sent / (sent + failed)) * 10000) / 100 : null,
    daily: dailyRows.map((row) => ({ day: String(row.day).slice(0, 10), eventName: row.eventName, count: toFiniteInt(row.count) })),
    platforms,
    topPosts: topPosts.map((row) => ({ id: row.id, title: row.title ?? 'پست بدون عنوان', events: toFiniteInt(row.count) })),
    topCampaigns: topCampaigns.map((row) => ({ id: row.id, name: row.name, events: toFiniteInt(row.count) })),
    errors: errorRows.map((row) => ({ eventType: errorKey(row.eventType), count: toFiniteInt(row.count) })),
    links: { clicks: toFiniteInt(linkRows[0]?.clicks) },
    revenue,
    automation,
  };
}

export async function getPostAnalytics(tenantId: string, postId: string, days = 30) {
  const db = getDb();
  const since = sinceDate(days);
  const events = await db.select({
    eventType: analyticsEvents.eventType,
    platform: analyticsEvents.platform,
    count: sql<number>`COUNT(*)`,
    value: sql<number>`COALESCE(SUM(${analyticsEvents.value}), 0)`,
  }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, tenantId), eq(analyticsEvents.postId, postId), gte(analyticsEvents.occurredAt, since))).groupBy(analyticsEvents.eventType, analyticsEvents.platform);
  return { days: safeWindow(days), postId, events: events.map((r) => ({ eventType: r.eventType, platform: r.platform, count: toFiniteInt(r.count), value: toFiniteInt(r.value) })) };
}

export async function getCampaignAnalytics(tenantId: string, campaignId: string, days = 30) {
  const db = getDb();
  const windowDays = safeWindow(days);
  const since = sinceDate(windowDays);
  const [campaign] = await db.select({ id: wordpressCampaigns.id, name: wordpressCampaigns.name, siteId: wordpressCampaigns.siteId, itemType: wordpressCampaigns.itemType, isEnabled: wordpressCampaigns.isEnabled, lastRunAt: wordpressCampaigns.lastRunAt, lastResultJson: wordpressCampaigns.lastResultJson })
    .from(wordpressCampaigns).where(and(eq(wordpressCampaigns.id, campaignId), eq(wordpressCampaigns.tenantId, tenantId))).limit(1);
  if (!campaign) throw new AppError(ERR.NOT_FOUND('کمپین'));
  const [events, recent] = await Promise.all([
    db.select({ eventType: analyticsEvents.eventType, platform: analyticsEvents.platform, count: sql<number>`COUNT(*)`, value: sql<number>`COALESCE(SUM(${analyticsEvents.value}), 0)` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, tenantId), eq(analyticsEvents.campaignId, campaignId), gte(analyticsEvents.occurredAt, since)))
      .groupBy(analyticsEvents.eventType, analyticsEvents.platform),
    db.select({
      id: analyticsEvents.id,
      occurredAt: analyticsEvents.occurredAt,
      eventType: analyticsEvents.eventType,
      platform: analyticsEvents.platform,
      postId: analyticsEvents.postId,
      targetId: analyticsEvents.targetId,
      channelId: analyticsEvents.channelId,
      value: analyticsEvents.value,
      metadataJson: analyticsEvents.metadataJson,
      postTitle: posts.title,
      channelTitle: channels.title,
      targetState: postTargets.state,
      attempts: postTargets.attempts,
      errorCode: postTargets.errorCode,
      errorMessage: postTargets.errorMessage,
      sentAt: postTargets.sentAt,
    })
      .from(analyticsEvents)
      .leftJoin(posts, eq(analyticsEvents.postId, posts.id))
      .leftJoin(channels, eq(analyticsEvents.channelId, channels.id))
      .leftJoin(postTargets, eq(analyticsEvents.targetId, postTargets.id))
      .where(and(eq(analyticsEvents.userId, tenantId), eq(analyticsEvents.campaignId, campaignId), gte(analyticsEvents.occurredAt, since)))
      .orderBy(desc(analyticsEvents.occurredAt))
      .limit(100),
  ]);
  return {
    days: windowDays,
    campaignId,
    campaign: { ...campaign, isEnabled: Boolean(campaign.isEnabled) },
    events: events.map((r) => ({ eventType: r.eventType, platform: r.platform, count: toFiniteInt(r.count), value: toFiniteInt(r.value) })),
    recent: recent.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      eventType: r.eventType,
      platform: r.platform,
      postId: r.postId,
      postTitle: r.postTitle,
      targetId: r.targetId,
      channelId: r.channelId,
      channelTitle: r.channelTitle,
      targetState: r.targetState,
      attempts: toFiniteInt(r.attempts),
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      sentAt: r.sentAt,
      metadata: parseMetadata(r.metadataJson),
    })),
  };
}

export async function getWordPressAnalytics(tenantId: string, days = 30) {
  const db = getDb();
  const windowDays = safeWindow(days);
  const since = sinceDate(windowDays);
  const types = [
    'wordpress.product.synced', 'wordpress.product.published', 'wordpress.product.failed',
    'wordpress.content.synced', 'wordpress.content.published', 'wordpress.content.failed',
    'wordpress.campaign.run.started', 'wordpress.campaign.run.completed', 'wordpress.campaign.run.failed',
    'wordpress.campaign.items.queued',
  ];
  const [eventRows, siteRows, campaigns, campaignEventRows, deliveryRows] = await Promise.all([
    db.select({ eventType: analyticsEvents.eventType, value: sql<number>`COALESCE(SUM(${analyticsEvents.value}), 0)`, count: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.eventType, types)))
      .groupBy(analyticsEvents.eventType),
    db.select({ status: wordpressSites.status, count: sql<number>`COUNT(*)` })
      .from(wordpressSites)
      .where(eq(wordpressSites.tenantId, tenantId))
      .groupBy(wordpressSites.status),
    db.select({ id: wordpressCampaigns.id, name: wordpressCampaigns.name, enabled: wordpressCampaigns.isEnabled, lastRunAt: wordpressCampaigns.lastRunAt })
      .from(wordpressCampaigns)
      .where(eq(wordpressCampaigns.tenantId, tenantId))
      .orderBy(desc(wordpressCampaigns.updatedAt))
      .limit(50),
    db.select({ campaignId: analyticsEvents.campaignId, eventType: analyticsEvents.eventType, value: sql<number>`COALESCE(SUM(${analyticsEvents.value}), 0)` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), sql`${analyticsEvents.campaignId} IS NOT NULL`, inArray(analyticsEvents.eventType, ['wordpress.campaign.run.completed', 'wordpress.campaign.run.failed', 'wordpress.campaign.items.queued'])))
      .groupBy(analyticsEvents.campaignId, analyticsEvents.eventType),
    db.select({ campaignId: analyticsEvents.campaignId, platform: analyticsEvents.platform, eventType: analyticsEvents.eventType, count: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, tenantId), gte(analyticsEvents.occurredAt, since), sql`${analyticsEvents.campaignId} IS NOT NULL`, inArray(analyticsEvents.eventType, ['post.delivery.sent', 'post.delivery.failed'])))
      .groupBy(analyticsEvents.campaignId, analyticsEvents.platform, analyticsEvents.eventType),
  ]);
  const metric = (type: string) => { const row = eventRows.find((x) => x.eventType === type); return { count: toFiniteInt(row?.count), value: toFiniteInt(row?.value) }; };
  const deliveryMap = new Map<string, { sent: number; failed: number }>();
  const campaignMap = new Map<string, { runs: number; failedRuns: number; queued: number; delivered: number; failedDelivery: number }>();
  for (const row of deliveryRows) {
    const platform = String(row.platform ?? 'unknown');
    const bucket = deliveryMap.get(platform) ?? { sent: 0, failed: 0 };
    if (row.eventType === 'post.delivery.sent') bucket.sent += toFiniteInt(row.count); else bucket.failed += toFiniteInt(row.count);
    deliveryMap.set(platform, bucket);
    if (row.campaignId) {
      const c = campaignMap.get(row.campaignId) ?? { runs: 0, failedRuns: 0, queued: 0, delivered: 0, failedDelivery: 0 };
      if (row.eventType === 'post.delivery.sent') c.delivered += toFiniteInt(row.count); else c.failedDelivery += toFiniteInt(row.count);
      campaignMap.set(row.campaignId, c);
    }
  }
  for (const row of campaignEventRows) {
    if (!row.campaignId) continue;
    const c = campaignMap.get(row.campaignId) ?? { runs: 0, failedRuns: 0, queued: 0, delivered: 0, failedDelivery: 0 };
    if (row.eventType === 'wordpress.campaign.run.completed') c.runs += Math.max(1, toFiniteInt(row.value));
    else if (row.eventType === 'wordpress.campaign.run.failed') c.failedRuns += Math.max(1, toFiniteInt(row.value));
    else c.queued += Math.max(0, toFiniteInt(row.value));
    campaignMap.set(row.campaignId, c);
  }
  return {
    days: windowDays,
    from: since.toISOString(),
    to: new Date().toISOString(),
    sites: { total: siteRows.reduce((n, r) => n + toFiniteInt(r.count), 0), active: toFiniteInt(siteRows.find((r) => r.status === 'ACTIVE')?.count) },
    products: { synced: metric('wordpress.product.synced').value, published: metric('wordpress.product.published').value, failed: metric('wordpress.product.failed').value },
    contents: { synced: metric('wordpress.content.synced').value, published: metric('wordpress.content.published').value, failed: metric('wordpress.content.failed').value },
    campaigns: {
      total: campaigns.length,
      active: campaigns.filter((r) => Boolean(r.enabled)).length,
      runs: metric('wordpress.campaign.run.completed').value,
      failedRuns: metric('wordpress.campaign.run.failed').value,
      queued: metric('wordpress.campaign.items.queued').value,
      items: campaigns.map((r) => ({ id: r.id, name: r.name, enabled: Boolean(r.enabled), lastRunAt: r.lastRunAt, ...(campaignMap.get(r.id) ?? { runs: 0, failedRuns: 0, queued: 0, delivered: 0, failedDelivery: 0 }) })),
    },
    delivery: Object.fromEntries(deliveryMap.entries()),
  };
}

export async function getAdminAnalytics(days = 30) {
  const db = getDb();
  const since = sinceDate(days);
  const [events, users, links, platforms, revenueRows] = await Promise.all([
    db.select({ eventType: analyticsEvents.eventType, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(gte(analyticsEvents.occurredAt, since)).groupBy(analyticsEvents.eventType).orderBy(desc(sql`COUNT(*)`)).limit(20),
    db.select({ userId: analyticsEvents.userId, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(gte(analyticsEvents.occurredAt, since), sql`${analyticsEvents.userId} IS NOT NULL`)).groupBy(analyticsEvents.userId).orderBy(desc(sql`COUNT(*)`)).limit(20),
    db.select({ clicks: sql<number>`COALESCE(SUM(${analyticsLinks.clickCount}), 0)` }).from(analyticsLinks),
    db.select({ platform: analyticsEvents.platform, eventType: analyticsEvents.eventType, count: sql<number>`COUNT(*)` }).from(analyticsEvents).where(and(gte(analyticsEvents.occurredAt, since), inArray(analyticsEvents.eventType, ['post.sent', 'post.failed']))).groupBy(analyticsEvents.platform, analyticsEvents.eventType),
    db.select({ eventType: analyticsEvents.eventType, value: analyticsEvents.value, metadataJson: analyticsEvents.metadataJson }).from(analyticsEvents).where(gte(analyticsEvents.occurredAt, since)),
  ]);
  const platformSummary = emptyPlatformMap();
  for (const row of platforms) {
    const platform = String(row.platform ?? '');
    if (!(platform in platformSummary)) continue;
    const key = row.eventType === 'post.sent' ? 'sent' : 'failed';
    const bucket = (platformSummary as Record<string, Record<string, number>>)[platform];
    if (bucket) bucket[key] = toFiniteInt(row.count);
  }
  const revenue = summarizeRevenue(revenueRows);
  const automation = summarizeAutomationRows(revenueRows);
  return {
    days: safeWindow(days),
    events: events.map((r) => ({ eventType: r.eventType, count: toFiniteInt(r.count) })),
    topUsers: users.map((r) => ({ userId: r.userId, count: toFiniteInt(r.count) })),
    links: { clicks: toFiniteInt(links[0]?.clicks) },
    platforms: platformSummary,
    revenue,
    automation,
  };
}

export async function createTrackedLink(input: {
  userId: string;
  destinationUrl: string;
  postId?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  campaignId?: string | null;
  source?: string | null;
}) {
  const url = input.destinationUrl.trim();
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported destination protocol');
  const db = getDb();
  const id = newId();
  const token = randomToken();
  await db.insert(analyticsLinks).values({
    id,
    userId: input.userId,
    postId: input.postId ?? null,
    targetId: input.targetId ?? null,
    channelId: input.channelId ?? null,
    campaignId: input.campaignId ?? null,
    token,
    destinationUrl: url,
    clickCount: 0,
    lastClickedAt: null,
  });
  return { id, token, destinationUrl: url, source: input.source ?? null };
}

export async function getLinkStats(userId: string, id: string) {
  const db = getDb();
  const [link] = await db.select().from(analyticsLinks).where(and(eq(analyticsLinks.id, id), eq(analyticsLinks.userId, userId))).limit(1);
  if (!link) return null;
  const rows = await db.select({ day: sql<string>`DATE(${analyticsLinkClicks.clickedAt})`, count: sql<number>`COUNT(*)` })
    .from(analyticsLinkClicks)
    .where(and(eq(analyticsLinkClicks.linkId, id), gte(analyticsLinkClicks.clickedAt, sinceDate(30))))
    .groupBy(sql`DATE(${analyticsLinkClicks.clickedAt})`)
    .orderBy(asc(sql`DATE(${analyticsLinkClicks.clickedAt})`));
  return { ...link, daily: rows.map((r) => ({ day: String(r.day).slice(0, 10), count: toFiniteInt(r.count) })) };
}

export async function resolveTrackedLink(token: string) {
  if (!LINK_TOKEN_PATTERN.test(token)) return null;
  const db = getDb();
  const [link] = await db.select().from(analyticsLinks).where(eq(analyticsLinks.token, token)).limit(1);
  return link ?? null;
}

export async function recordTrackedLinkClick(link: typeof analyticsLinks.$inferSelect, input: {
  platform?: string | null;
  source?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}) {
  const db = getDb();
  const clickedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(analyticsLinkClicks).values({
      id: newId(),
      linkId: link.id,
      clickedAt,
      platform: input.platform?.slice(0, 24) ?? null,
      source: input.source?.slice(0, 32) ?? null,
      referrer: input.referrer?.slice(0, 500) ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      ipHash: ipHash(input.ip ?? undefined),
      metadataJson: null,
    });
    await tx.update(analyticsLinks).set({ clickCount: sql`${analyticsLinks.clickCount} + 1`, lastClickedAt: clickedAt }).where(eq(analyticsLinks.id, link.id));
  });
  await recordAnalyticsEvent({
    userId: link.userId,
    eventType: 'link.clicked',
    occurredAt: clickedAt,
    postId: link.postId,
    targetId: link.targetId,
    channelId: link.channelId,
    campaignId: link.campaignId,
    linkId: link.id,
    platform: input.platform,
    source: input.source,
    value: 1,
    dedupeKey: null,
  });
}
