import { and, count, desc, eq, gt, gte, inArray, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { getDb } from '../../db/client.js';
import {
  users,
  subscriptions,
  payments,
  postTargets,
  plans,
  auditLogs,
  systemSettings,
  channelRegistry,
  posts,
  channels,
  bots,
  media,
  tickets,
  walletAccounts,
  aiJobs,
  goldConfigs,
  goldSnapshots,
  workflows,
  botKeywords,
  botCommands,
  referrals,
  wordpressSites,
  wordpressProducts,
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { PlanLimits, PlanFeatures, PlanPricing } from '../../db/schema.js';
import { notifyTenant } from '../notifications/delivery.js';
import { activateSubscription, activateSubscriptionTx, normalizePlanFeatures } from '../subscriptions/plan.service.js';
import { moveMoneyTx } from '../wallet/wallet.service.js';
import { revokeAllUserSessions } from '../../security/sessions.js';
import { referralHookFirstPurchase } from '../payments/payment.service.js';
import { getPaymentSettings } from '../payments/payment-settings.service.js';

export interface AdminOverview {
  users: { total: number; active: number; suspended: number; new30d: number };
  channels: { total: number; active: number; telegram: number; bale: number; rubika: number; byPlatform: Record<'telegram'|'bale'|'rubika', { total: number; active: number; inactive: number }> };
  bots: { total: number; active: number; telegram: number; bale: number; rubika: number; byPlatform: Record<'telegram'|'bale'|'rubika', { total: number; active: number; inactive: number }> };
  gold: { configs: number; enabled: number; snapshots24h: number };
  posts: { total: number; scheduled: number; published30d: number; failed24h: number };
  payments: { verifiedCount30d: number; verifiedSum30d: number; verifiedSumTotal: number; pendingReview: number };
  subscriptions: { active: number; byPlan: Array<{ planName: string; count: number }> };
  usage: {
    aiJobs30d: number;
    mediaCount: number;
    mediaBytes: number;
    ticketsOpen: number;
    deliveries24h: number;
    deliveriesFailed24h: number;
  };
}

const num = (v: unknown): number => Number(v ?? 0);

type CountRow = { value: number };
type SumRow = { sum: string | number | null };
type MediaRow = { value: number; bytes: string | number | null };
type PlatformRow = { platform: string; value: number };
type PlanCountRow = { planName: string; value: number };

/** Runs thunks with bounded concurrency (pool: connectionLimit=DB_POOL_MAX=5,
 *  queueLimit=20 — an unbounded Promise.all of 27 queries overflows the queue
 *  and mysql2 aborts with "Queue limit reached"). */
async function mapLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      const task = tasks[i];
      if (task === undefined) break;
      results[i] = await task();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Dashboard overview (admin-panel v2 nested shape).
 * Semantics verified against the real schema enums:
 *  - channels/bots: status 'ACTIVE' = connected; platform counts cover all rows.
 *  - post_targets states: PENDING|PROCESSING|SENT|RETRYING|FAILED|CANCELLED —
 *    successful deliveries are state 'SENT' (there is no PUBLISHED target state).
 *  - tickets states: OPEN|ANSWERED|CLOSED — open = state != CLOSED.
 */
export async function getOverview(): Promise<AdminOverview> {
  const db = getDb();
  const since30d = new Date(Date.now() - 30 * 86400_000);
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const results = await mapLimit<unknown>([
    () => db.select({ value: count() }).from(users),
    () => db.select({ value: count() }).from(users).where(eq(users.status, 'ACTIVE')),
    () => db.select({ value: count() }).from(users).where(eq(users.status, 'SUSPENDED')),
    () => db.select({ value: count() }).from(users).where(gte(users.createdAt, since30d)),
    () => db.select({ value: count() }).from(channels),
    () => db.select({ value: count() }).from(channels).where(eq(channels.status, 'ACTIVE')),
    () => db.select({ platform: channels.platform, value: count() }).from(channels).groupBy(channels.platform),
    () => db.select({ value: count() }).from(bots),
    () => db.select({ value: count() }).from(bots).where(eq(bots.status, 'ACTIVE')),
    () => db.select({ platform: bots.platform, value: count() }).from(bots).groupBy(bots.platform),
    () => db.select({ value: count() }).from(goldConfigs),
    () => db.select({ value: count() }).from(goldConfigs).where(eq(goldConfigs.isEnabled, 1)),
    () => db.select({ value: count() }).from(goldSnapshots).where(gte(goldSnapshots.capturedAt, since24h)),
    () => db.select({ value: count() }).from(posts),
    () => db.select({ value: count() }).from(posts).where(eq(posts.state, 'SCHEDULED')),
    () => db.select({ value: count() }).from(posts).where(and(eq(posts.state, 'PUBLISHED'), gte(posts.publishedAt, since30d))),
    () => db.select({ value: count() }).from(postTargets).where(and(eq(postTargets.state, 'FAILED'), gte(postTargets.updatedAt, since24h))),
    () => db.select({ value: count() }).from(postTargets).where(and(eq(postTargets.state, 'SENT'), gte(postTargets.updatedAt, since24h))),
    () => db.select({ value: count() }).from(payments).where(and(eq(payments.state, 'VERIFIED'), gte(payments.verifiedAt, since30d))),
    () => db.select({ value: count() }).from(payments).where(eq(payments.state, 'PENDING_REVIEW')),
    () => db.select({ sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)` }).from(payments).where(and(eq(payments.state, 'VERIFIED'), gte(payments.verifiedAt, since30d))),
    () => db.select({ sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)` }).from(payments).where(eq(payments.state, 'VERIFIED')),
    () => db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.state, 'ACTIVE')),
    () => db
      .select({ planName: plans.nameFa, value: count() })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.state, 'ACTIVE'))
      .groupBy(plans.nameFa),
    () => db.select({ value: count() }).from(aiJobs).where(gte(aiJobs.createdAt, since30d)),
    () => db.select({ value: count(), bytes: sql<string | number | null>`COALESCE(SUM(${media.sizeBytes}), 0)` }).from(media),
    () => db.select({ value: count() }).from(tickets).where(ne(tickets.state, 'CLOSED')),
  ], 5);

  const channelPlatformStateRows = await db.select({ platform: channels.platform, status: channels.status, value: count() }).from(channels).groupBy(channels.platform, channels.status);
  const botPlatformStateRows = await db.select({ platform: bots.platform, status: bots.status, value: count() }).from(bots).groupBy(bots.platform, bots.status);

  const [
    userTotal, userActive, userSuspended, userNew30d,
    channelTotal, channelActive, channelPlatforms,
    botTotal, botActive, botPlatforms,
    goldConfigRows, goldEnabled, goldSnap24h,
    postTotal, postScheduled, postPublished30d, targetFailed24h, targetSent24h,
    payVerified30d, payPendingReview, paySum30d, paySumTotal,
    subsActive, subsByPlan,
    aiJobs30d, mediaRows, ticketOpen,
  ] = results as [
    CountRow[], CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], PlatformRow[],
    CountRow[], CountRow[], PlatformRow[],
    CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], SumRow[], SumRow[],
    CountRow[], PlanCountRow[],
    CountRow[], MediaRow[], CountRow[],
  ];

  const platformCounts = (
    rows: Array<{ platform: string; value: number }>
  ): { telegram: number; bale: number; rubika: number } => {
    const out = { telegram: 0, bale: 0, rubika: 0 };
    for (const r of rows) {
      if (r.platform === 'telegram' || r.platform === 'bale' || r.platform === 'rubika') out[r.platform] = num(r.value);
    }
    return out;
  };

  const platformState = (rows: Array<{ platform: string; status: string; value: number }>) => {
    const out = {
      telegram: { total: 0, active: 0, inactive: 0 },
      bale: { total: 0, active: 0, inactive: 0 },
      rubika: { total: 0, active: 0, inactive: 0 },
    };
    for (const row of rows) {
      if (!(row.platform in out)) continue;
      const item = out[row.platform as keyof typeof out];
      item.total += num(row.value);
      if (row.status === 'ACTIVE') item.active += num(row.value);
      else item.inactive += num(row.value);
    }
    return out;
  };
  const channelByPlatform = platformState(channelPlatformStateRows.map(r => ({ platform: r.platform, status: r.status, value: Number(r.value) })));
  const botByPlatform = platformState(botPlatformStateRows.map(r => ({ platform: r.platform, status: r.status, value: Number(r.value) })));

  return {
    users: {
      total: num(userTotal[0]?.value),
      active: num(userActive[0]?.value),
      suspended: num(userSuspended[0]?.value),
      new30d: num(userNew30d[0]?.value),
    },
    channels: {
      total: num(channelTotal[0]?.value),
      active: num(channelActive[0]?.value),
      ...platformCounts(channelPlatforms.map((r) => ({ platform: r.platform, value: Number(r.value) }))),
      byPlatform: channelByPlatform,
    },
    bots: {
      total: num(botTotal[0]?.value),
      active: num(botActive[0]?.value),
      ...platformCounts(botPlatforms.map((r) => ({ platform: r.platform, value: Number(r.value) }))),
      byPlatform: botByPlatform,
    },
    gold: {
      configs: num(goldConfigRows[0]?.value),
      enabled: num(goldEnabled[0]?.value),
      snapshots24h: num(goldSnap24h[0]?.value),
    },
    posts: {
      total: num(postTotal[0]?.value),
      scheduled: num(postScheduled[0]?.value),
      published30d: num(postPublished30d[0]?.value),
      failed24h: num(targetFailed24h[0]?.value),
    },
    payments: {
      verifiedCount30d: num(payVerified30d[0]?.value),
      verifiedSum30d: num(paySum30d[0]?.sum),
      verifiedSumTotal: num(paySumTotal[0]?.sum),
      pendingReview: num(payPendingReview[0]?.value),
    },
    subscriptions: {
      active: num(subsActive[0]?.value),
      byPlan: subsByPlan.map((r) => ({ planName: r.planName, count: num(r.value) })),
    },
    usage: {
      aiJobs30d: num(aiJobs30d[0]?.value),
      mediaCount: num(mediaRows[0]?.value),
      mediaBytes: num(mediaRows[0]?.bytes),
      ticketsOpen: num(ticketOpen[0]?.value),
      deliveries24h: num(targetSent24h[0]?.value),
      deliveriesFailed24h: num(targetFailed24h[0]?.value),
    },
  };
}

// ---------------------------------------------------------------------------
// Round 18 — «پروفایل ۳۶۰ درجه» (asovin user-profile-modal parity, extended)
// ---------------------------------------------------------------------------

const ULIDISH = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

export interface UserProfile360 {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    businessName: string;
    businessType: string;
    role: string;
    status: string;
    createdAt: Date;
    lastLoginAt: Date | null;
    avatarKind: string;
    avatarValue: string;
    avatarMediaId: string | null;
    referralCode: string | null;
  };
  subscription: { planNameFa: string; planCode: string; state: string; startedAt: Date; expiresAt: Date } | null;
  stats: {
    channels: { total: number; active: number };
    bots: { total: number; active: number };
    posts: { total: number; published: number };
    tickets: { total: number; open: number };
    payments: { verifiedCount: number; verifiedSumRial: number };
    walletBalanceRial: number;
  };
}

type ProfileCountRow = { total: number; active: number };

/**
 * 360° profile for one user: identity + active (or most recent) subscription
 * + bounded-concurrency stats. Missing/malformed ids are an indistinguishable
 * 404 (§180 no existence leak).
 */
export async function getUserProfile360(userId: string): Promise<UserProfile360> {
  if (!ULIDISH.test(userId)) throw new AppError(ERR.NOT_FOUND('کاربر'));
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobile: users.mobile,
      businessName: users.businessName,
      businessType: users.businessType,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      avatarKind: users.avatarKind,
      avatarValue: users.avatarValue,
      avatarMediaId: users.avatarMediaId,
      referralCode: users.referralCode,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AppError(ERR.NOT_FOUND('کاربر'));

  // Preferred: ACTIVE subscription (newest expiry); fallback: most recent row
  // of any state so admins always see the last known plan.
  const subRows = await db
    .select({
      planNameFa: plans.nameFa,
      planCode: plans.code,
      state: subscriptions.state,
      startedAt: subscriptions.startedAt,
      expiresAt: subscriptions.expiresAt,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, userId))
    .orderBy(
      // ACTIVE first, then newest expiry / most recently touched row.
      sql`CASE WHEN ${subscriptions.state} = 'ACTIVE' THEN 0 ELSE 1 END`,
      desc(subscriptions.expiresAt),
      desc(subscriptions.updatedAt)
    )
    .limit(1);
  const subscription = subRows[0] ?? null;

  const statResults = await mapLimit<unknown>(
    [
      () =>
        db
          .select({
            total: count(),
            active: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${channels.status} = 'ACTIVE' THEN 1 ELSE 0 END), 0)`,
          })
          .from(channels)
          .where(eq(channels.tenantId, userId)),
      () =>
        db
          .select({
            total: count(),
            active: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${bots.status} = 'ACTIVE' THEN 1 ELSE 0 END), 0)`,
          })
          .from(bots)
          .where(eq(bots.tenantId, userId)),
      () =>
        db
          .select({
            total: count(),
            active: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${posts.state} = 'PUBLISHED' THEN 1 ELSE 0 END), 0)`,
          })
          .from(posts)
          .where(eq(posts.tenantId, userId)),
      () =>
        db
          .select({
            total: count(),
            active: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${tickets.state} = 'OPEN' THEN 1 ELSE 0 END), 0)`,
          })
          .from(tickets)
          .where(eq(tickets.tenantId, userId)),
      () =>
        db
          .select({
            total: count(),
            sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)`,
          })
          .from(payments)
          .where(and(eq(payments.tenantId, userId), inArray(payments.state, ['VERIFIED', 'COMPLETED']))),
      () => db.select({ balance: walletAccounts.balanceRial }).from(walletAccounts).where(eq(walletAccounts.tenantId, userId)).limit(1),
    ],
    5
  ) as [
    ProfileCountRow[],
    ProfileCountRow[],
    ProfileCountRow[],
    ProfileCountRow[],
    Array<{ total: number; sum: string | number | null }>,
    Array<{ balance: number | string }>,
  ];

  const [channelRows, botRows, postRows, ticketRows, payRows, walletRows] = statResults;

  return {
    user,
    subscription: subscription
      ? {
          planNameFa: subscription.planNameFa,
          planCode: subscription.planCode,
          state: subscription.state,
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
        }
      : null,
    stats: {
      channels: { total: num(channelRows[0]?.total), active: num(channelRows[0]?.active) },
      bots: { total: num(botRows[0]?.total), active: num(botRows[0]?.active) },
      posts: { total: num(postRows[0]?.total), published: num(postRows[0]?.active) },
      tickets: { total: num(ticketRows[0]?.total), open: num(ticketRows[0]?.active) },
      payments: {
        verifiedCount: num(payRows[0]?.total),
        verifiedSumRial: num(payRows[0]?.sum),
      },
      walletBalanceRial: num(walletRows[0]?.balance),
    },
  };
}

export async function listUsers(
  search: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<{ id: string; firstName: string; lastName: string; email: string; mobile: string; businessName: string; role: string; status: string; avatarKind: string; avatarValue: string; createdAt: Date }>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = like
    ? or(sql`${users.email} LIKE ${like}`, sql`${users.mobile} LIKE ${like}`, sql`${users.businessName} LIKE ${like}`, sql`${users.firstName} LIKE ${like}`, sql`${users.lastName} LIKE ${like}`)
    : undefined;

  const [totalRow] = await db.select({ value: count() }).from(users).where(where);
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobile: users.mobile,
      businessName: users.businessName,
      role: users.role,
      status: users.status,
      // Round 17: lets the admin table render standard character avatars.
      avatarKind: users.avatarKind,
      avatarValue: users.avatarValue,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

export type AdminPlatform = 'telegram' | 'bale' | 'rubika';

export async function listChannels(
  search: string | undefined,
  platform: AdminPlatform | undefined,
  page: number,
  pageSize: number
): Promise<{
  items: Array<{ id: string; platform: string; channelRef: string; title: string; status: string; createdAt: Date; ownerEmail: string | null; ownerName: string }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    platform ? eq(channels.platform, platform) : undefined,
    like
      ? or(sql`${channels.title} LIKE ${like}`, sql`${channels.channelRef} LIKE ${like}`, sql`${users.email} LIKE ${like}`)
      : undefined
  );

  const ownerName = sql<string>`COALESCE(CONCAT_WS(' ', ${users.firstName}, ${users.lastName}), '')`;
  const [totalRow] = await db
    .select({ value: count() })
    .from(channels)
    .leftJoin(users, eq(users.id, channels.tenantId))
    .where(where);
  const rows = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      channelRef: channels.channelRef,
      title: channels.title,
      status: channels.status,
      createdAt: channels.createdAt,
      ownerEmail: users.email,
      ownerName,
    })
    .from(channels)
    .leftJoin(users, eq(users.id, channels.tenantId))
    .where(where)
    .orderBy(desc(channels.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

export async function listBots(
  search: string | undefined,
  platform: AdminPlatform | undefined,
  page: number,
  pageSize: number
): Promise<{
  items: Array<{ id: string; platform: string; username: string | null; title: string; status: string; mode: string; aiEnabled: boolean; createdAt: Date; ownerEmail: string | null }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    platform ? eq(bots.platform, platform) : undefined,
    like
      ? or(sql`${bots.title} LIKE ${like}`, sql`${bots.username} LIKE ${like}`, sql`${users.email} LIKE ${like}`)
      : undefined
  );

  const [totalRow] = await db
    .select({ value: count() })
    .from(bots)
    .leftJoin(users, eq(users.id, bots.tenantId))
    .where(where);
  // NOTE: tokens (token_encrypted/token_masked) are never selected here.
  const rows = await db
    .select({
      id: bots.id,
      platform: bots.platform,
      username: bots.username,
      title: bots.title,
      status: bots.status,
      mode: bots.mode,
      aiEnabled: bots.aiEnabled,
      createdAt: bots.createdAt,
      ownerEmail: users.email,
    })
    .from(bots)
    .leftJoin(users, eq(users.id, bots.tenantId))
    .where(where)
    .orderBy(desc(bots.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return {
    items: rows.map((r) => ({ ...r, aiEnabled: Number(r.aiEnabled) === 1 })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

async function assertAdminTargetMutable(targetId: string, operationFa: string): Promise<void> {
  const db = getDb();
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) throw new AppError(ERR.NOT_FOUND('کاربر'));
  if (target.role !== 'USER') {
    const label = target.role === 'SUPER_ADMIN' ? 'مدیر ارشد' : 'حساب مدیریتی';
    throw new AppError(ERR.CONFLICT(`${operationFa} برای ${label} مجاز نیست.`));
  }
}

export async function setUserSuspended(
  actorId: string,
  targetId: string,
  suspended: boolean
): Promise<void> {
  if (actorId === targetId) {
    throw new AppError(ERR.VALIDATION('نمی‌توانید حساب خودتان را تغییر وضعیت دهید.'));
  }
  const db = getDb();
  await assertAdminTargetMutable(targetId, 'تغییر وضعیت حساب');
  await db.update(users).set({ status: suspended ? 'SUSPENDED' : 'ACTIVE' }).where(eq(users.id, targetId));
  if (suspended) await revokeAllUserSessions(targetId);
}

export async function grantSubscription(tenantId: string, planCode: string, months: number): Promise<{ subscriptionId: string }> {
  const db = getDb();
  await assertAdminTargetMutable(tenantId, 'ویرایش حساب');
  const [plan] = await db.select().from(plans).where(and(eq(plans.code, planCode), eq(plans.isActive, 1))).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  const result = await activateSubscription(tenantId, plan.id, months);
  return { subscriptionId: result.subscriptionId };
}

const PAYMENT_STATES = [
  'CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'REFUNDED',
  'PENDING_REVIEW', 'REJECTED', 'COMPLETED',
] as const;
type PayState = (typeof PAYMENT_STATES)[number];

/** Current state of a payment (for audit meta); null when missing. */
export async function getPaymentState(paymentId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select({ state: payments.state }).from(payments).where(eq(payments.id, paymentId)).limit(1);
  return row?.state ?? null;
}

/** Alias for the reviewer join (a user row may appear as payer AND reviewer). */
const reviewer = alias(users, 'reviewer');

export async function listAdminPayments(
  state: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const where =
    state && (PAYMENT_STATES as readonly string[]).includes(state)
      ? eq(payments.state, state as PayState)
      : undefined;

  const [totalRow] = await db.select({ value: count() }).from(payments).where(where);
  const rows = await db
    .select({
      id: payments.id,
      tenantId: payments.tenantId,
      purpose: payments.purpose,
      planId: payments.planId,
      months: payments.months,
      amountRial: payments.amountRial,
      gateway: payments.gateway,
      gatewayRef: payments.gatewayRef,
      reference: payments.reference,
      state: payments.state,
      verifiedAt: payments.verifiedAt,
      metaJson: payments.metaJson,
      receiptMediaId: payments.receiptMediaId,
      receiptNote: payments.receiptNote,
      reviewedBy: payments.reviewedBy,
      reviewedAt: payments.reviewedAt,
      createdAt: payments.createdAt,
      // user (payer) summary
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      userMobile: users.mobile,
      // plan summary
      planCode: plans.code,
      planNameFa: plans.nameFa,
      // reviewer summary (round 19 payment popup)
      reviewedByName: sql<string | null>`NULLIF(CONCAT(${reviewer.firstName}, ' ', ${reviewer.lastName}), ' ')`,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.tenantId))
    .leftJoin(reviewer, eq(reviewer.id, payments.reviewedBy))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(size)
    .offset((p - 1) * size);

  return {
    items: rows.map((r) => ({ ...r, amountRial: Number(r.amountRial) })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

/**
 * Admin review of payments (contract 14-contract item 5).
 *
 * Two flavours share one settlement service:
 *  - PENDING_REVIEW (card-to-card receipt) → state COMPLETED + reviewed_by/at.
 *  - Online fallback (§117 manual verify: CREATED/REDIRECTED/FAILED) → state
 *    VERIFIED, exactly like before.
 *
 * Idempotency: approving an already-settled payment (VERIFIED/COMPLETED) is a
 * NO-OP SUCCESS (chosen over 409 so a double-click or retry never errors).
 * All financial side effects (subscription activation / wallet credit /
 * referral first-purchase hook) run in ONE transaction, mirroring the online
 * verify path.
 */
export async function approvePayment(
  actorId: string,
  paymentId: string,
  note?: string
): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));

  if (payment.state === 'VERIFIED' || payment.state === 'COMPLETED') {
    return { ok: true, message: 'این پرداخت پیش‌تر تأیید شده است.' };
  }
  if (payment.state === 'REJECTED' || payment.state === 'REFUNDED' || payment.state === 'CANCELLED') {
    throw new AppError(ERR.CONFLICT('این پرداخت قابل تأیید نیست.'));
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    // Re-read under lock: concurrent approvals must not double-settle.
    const [locked] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1).for('update');
    if (!locked) throw new AppError(ERR.NOT_FOUND('پرداخت'));
    if (locked.state === 'VERIFIED' || locked.state === 'COMPLETED') return; // settled concurrently → no-op
    if (locked.state === 'REJECTED' || locked.state === 'REFUNDED' || locked.state === 'CANCELLED') {
      throw new AppError(ERR.CONFLICT('این پرداخت قابل تأیید نیست.'));
    }

    const lockedTarget: PayState = locked.state === 'PENDING_REVIEW' ? 'COMPLETED' : 'VERIFIED';
    const metaJson: Record<string, unknown> = { ...(locked.metaJson ?? {}) };
    if (note && note.trim() !== '') metaJson.reviewNote = note.trim().slice(0, 500);

    await tx
      .update(payments)
      .set({
        state: lockedTarget,
        verifiedAt: now,
        reviewedBy: actorId,
        reviewedAt: now,
        metaJson,
      })
      .where(and(eq(payments.id, locked.id), eq(payments.state, locked.state)));

    if (locked.purpose === 'SUBSCRIPTION' && locked.planId) {
      await activateSubscriptionTx(tx, locked.tenantId, locked.planId, locked.months);
      await referralHookFirstPurchase(locked.tenantId, Number(locked.amountRial), tx);
    } else if (locked.purpose === 'WALLET_TOPUP') {
      await moveMoneyTx(tx, locked.tenantId, 'CREDIT', Number(locked.amountRial), { type: 'payment', id: locked.id }, 'شارژ کیف پول (تأیید دستی)');
    }
  });

  await emitPaymentCompleted(payment, actorId);
  return { ok: true, message: 'پرداخت با موفقیت تأیید و اعمال شد.' };
}

async function emitPaymentCompleted(
  payment: typeof payments.$inferSelect,
  actorId: string
): Promise<void> {
  await notifyTenant({
    tenantId: payment.tenantId,
    kind: 'PAYMENT_APPROVED',
    titleFa: 'پرداخت شما تأیید شد',
    bodyFa:
      payment.purpose === 'SUBSCRIPTION'
        ? 'رسید پرداخت شما تأیید شد و اشتراک شما فعال/تمدید گردید.'
        : 'پرداخت شما تأیید و کیف پول شما شارژ شد.',
  }).catch(() => undefined);
  void actorId;
}

/**
 * Rejects a PENDING_REVIEW card-to-card payment. Idempotent: rejecting an
 * already-REJECTED payment is a no-op success; other non-reviewable states
 * raise a stable CONFLICT.
 */
export async function rejectPayment(
  actorId: string,
  paymentId: string,
  reason: string
): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));
  if (payment.state === 'REJECTED') {
    return { ok: true, message: 'این پرداخت پیش‌تر رد شده است.' };
  }
  if (payment.state !== 'PENDING_REVIEW') {
    throw new AppError(ERR.CONFLICT('فقط پرداخت‌های در انتظار بررسی قابل رد هستند.'));
  }

  const metaJson: Record<string, unknown> = { ...(payment.metaJson ?? {}), rejectReason: reason.trim().slice(0, 500) };
  const now = new Date();
  const res = await db
    .update(payments)
    .set({ state: 'REJECTED', reviewedBy: actorId, reviewedAt: now, metaJson })
    .where(and(eq(payments.id, payment.id), eq(payments.state, 'PENDING_REVIEW')));
  const changed = Array.isArray(res) ? Number(res[0]?.affectedRows ?? 0) : Number((res as { affectedRows?: number })?.affectedRows ?? 0);
  if (changed === 0) {
    // Lost a race with approve/another reject — report the current truth.
    const [fresh] = await db.select({ state: payments.state }).from(payments).where(eq(payments.id, payment.id)).limit(1);
    if (fresh?.state === 'REJECTED') return { ok: true, message: 'این پرداخت پیش‌تر رد شده است.' };
    throw new AppError(ERR.CONFLICT('این پرداخت دیگر قابل رد نیست.'));
  }

  await notifyTenant({
    tenantId: payment.tenantId,
    kind: 'PAYMENT_REJECTED',
    titleFa: 'رسید پرداخت شما تأیید نشد',
    bodyFa: `رسید پرداخت شما تأیید نشد. دلیل: ${reason.trim().slice(0, 200)}`,
  }).catch(() => undefined);

  return { ok: true, message: 'پرداخت رد شد.' };
}

const AUDIT_ACTION_FA: Record<string, string> = {
  'admin.user_suspended':'تعلیق کاربر','admin.user_activated':'فعال‌سازی کاربر','admin.grant_subscription':'هدیهٔ اشتراک',
  'admin.payment_approved':'تأیید پرداخت','admin.payment_rejected':'رد پرداخت','admin.plan_created':'افزودن پلن','admin.plan_updated':'ویرایش پلن','admin.plan_deleted':'حذف پلن',
  'admin.settings_updated':'به‌روزرسانی تنظیمات','admin.broadcast':'ارسال پیام همگانی','admin.ticket_reply':'پاسخ مدیر به تیکت','admin.ticket_close':'بستن تیکت',
  'admin.channel_released':'آزادسازی کانال','admin.email_test':'آزمون ارسال ایمیل','admin.supporter_created':'افزودن نیروی پشتیبانی','admin.supporter_role_changed':'تغییر نقش نیروی پشتیبانی','admin.ticket_categories_updated':'به‌روزرسانی دسته‌بندی تیکت',
  'admin.ticket_created':'ایجاد تیکت از طرف مدیر','admin.ai_provider_saved':'ذخیرهٔ سرویس‌دهندهٔ هوش مصنوعی','admin.ai_provider_deleted':'حذف سرویس‌دهندهٔ هوش مصنوعی',
  'auth.login':'ورود به حساب','auth.logout':'خروج از حساب','auth.register':'ثبت‌نام','auth.password_reset':'بازیابی رمز عبور',
  'user.settings_updated':'ویرایش تنظیمات حساب','user.password_changed':'تغییر رمز عبور','user.avatar_updated':'به‌روزرسانی تصویر نمایه','user.avatar_removed':'حذف تصویر نمایه',
  'subscription.activated':'فعال‌سازی اشتراک','payment.verified':'تأیید پرداخت','payment.receipt_uploaded':'بارگذاری رسید پرداخت',
  'channel.connect':'اتصال کانال','channel.disconnect':'قطع کانال','channel.update':'ویرایش کانال','channel.verify':'بررسی کانال',
  'bot.connect':'اتصال ربات','bot.enable':'فعال‌سازی ربات','bot.disable':'غیرفعال‌سازی ربات','bot.verify':'بررسی ربات','bot.mode':'تغییر حالت ربات','bot.ai_settings':'تنظیمات هوش مصنوعی ربات',
  'bot.command.create':'افزودن دستور ربات','bot.command.update':'ویرایش دستور ربات','bot.command.delete':'حذف دستور ربات','bot.keyword.create':'افزودن کلیدواژه','bot.keyword.update':'ویرایش کلیدواژه','bot.keyword.delete':'حذف کلیدواژه',
  'workflow.create':'ساخت گردش‌کار','workflow.update':'ویرایش گردش‌کار','workflow.delete':'حذف گردش‌کار',
  'post.create':'ایجاد پست','post.publish':'انتشار پست','post.schedule':'زمان‌بندی پست','post.cancel':'لغو انتشار پست','post.target.retry':'تلاش دوباره برای انتشار',
  'media.upload':'بارگذاری فایل','media.delete':'حذف فایل','wordpress.connected':'اتصال سایت وردپرس','wordpress.disconnected':'قطع سایت وردپرس','wordpress.secret_rotated':'تغییر کلید اتصال وردپرس','wordpress.product_published':'انتشار محصول وردپرس',
  'sync_products':'همگام‌سازی محصولات','publish_product':'انتشار محصول','referral.first_purchase_reward':'پرداخت پاداش معرفی','referral.reward_failed':'ناموفق بودن پاداش معرفی',
}
const ROLE_FA_SERVER: Record<string,string> = { SUPER_ADMIN:'مدیر ارشد', SUPPORT:'پشتیبانی', USER:'کاربر', SYSTEM:'سامانه' };
const SUBJECT_FA: Record<string,string> = {
  user:'کاربر', workflow:'گردش‌کار', bot:'ربات', bot_command:'دستور ربات', bot_keyword:'کلیدواژه', channel:'کانال', media:'فایل رسانه‌ای', payment:'پرداخت', plan:'پلن', post:'پست', post_target:'هدف انتشار', referral:'معرفی', subscription:'اشتراک', ticket:'تیکت', ai_job:'درخواست هوش مصنوعی', ai_provider:'سرویس‌دهنده هوش مصنوعی', wordpress_product:'محصول وردپرس', wordpress_site:'سایت وردپرس'
};
const PLATFORM_FA_SERVER: Record<string,string> = { telegram:'تلگرام', bale:'بله', rubika:'روبیکا' };
const AI_PROVIDER_FA_SERVER: Record<string,string> = { openai:'اُپن‌ای‌آی', deepseek:'دیپ‌سیک', mistral:'میسترال', openrouter:'اوپن‌روتر', gemini:'جمینی گوگل', anthropic:'آنتروپیک کلود' };
const PURPOSE_FA_SERVER: Record<string,string> = { SUBSCRIPTION:'اشتراک', WALLET_TOPUP:'شارژ کیف پول', CAPTION:'تولید عنوان/متن', AUTO_REPLY:'پاسخ خودکار', CUSTOM:'سفارشی' };

export interface AdminAuditRow {
  id: string;
  actorLabel: string;
  actorRoleFa: string;
  actionFa: string;
  subjectTypeFa: string;
  subjectLabel: string;
  createdAt: Date;
}

export async function listAuditLogs(action: string | undefined, page: number, pageSize: number): Promise<{ items: AdminAuditRow[]; total: number; page: number; pageSize: number }> {
  const db=getDb(); const p=Math.max(1,page); const size=Math.min(100,Math.max(1,pageSize));
  const where=action?.trim()?eq(auditLogs.action,action.trim()):undefined;
  const [totalRow]=await db.select({value:count()}).from(auditLogs).where(where);
  const rows=await db.select({id:auditLogs.id,actorId:auditLogs.actorId,actorRole:auditLogs.actorRole,action:auditLogs.action,subjectType:auditLogs.subjectType,subjectId:auditLogs.subjectId,createdAt:auditLogs.createdAt}).from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(size).offset((p-1)*size);
  const idsByType=new Map<string,string[]>();
  const add=(type:string,id:string|null)=>{if(!id)return; const a=idsByType.get(type)||[]; if(!a.includes(id))a.push(id); idsByType.set(type,a)};
  for(const r of rows){add('user',r.actorId);add(r.subjectType||'',r.subjectId);}
  const ids=(t:string)=>idsByType.get(t)||[];
  const userRows=ids('user').length?await db.select({id:users.id,firstName:users.firstName,lastName:users.lastName,email:users.email}).from(users).where(inArray(users.id,ids('user'))):[];
  const workflowRows=ids('workflow').length?await db.select({id:workflows.id,nameFa:workflows.nameFa}).from(workflows).where(inArray(workflows.id,ids('workflow'))):[];
  const botRows=ids('bot').length?await db.select({id:bots.id,title:bots.title,platform:bots.platform}).from(bots).where(inArray(bots.id,ids('bot'))):[];
  const cmdRows=ids('bot_command').length?await db.select({id:botCommands.id,command:botCommands.command}).from(botCommands).where(inArray(botCommands.id,ids('bot_command'))):[];
  const kwRows=ids('bot_keyword').length?await db.select({id:botKeywords.id,keyword:botKeywords.keyword}).from(botKeywords).where(inArray(botKeywords.id,ids('bot_keyword'))):[];
  const channelRows=ids('channel').length?await db.select({id:channels.id,title:channels.title,platform:channels.platform}).from(channels).where(inArray(channels.id,ids('channel'))):[];
  const mediaRows=ids('media').length?await db.select({id:media.id,filename:media.filename}).from(media).where(inArray(media.id,ids('media'))):[];
  const paymentRows=ids('payment').length?await db.select({id:payments.id,purpose:payments.purpose,amountRial:payments.amountRial}).from(payments).where(inArray(payments.id,ids('payment'))):[];
  const planRows=ids('plan').length?await db.select({id:plans.id,nameFa:plans.nameFa}).from(plans).where(inArray(plans.id,ids('plan'))):[];
  const postRows=ids('post').length?await db.select({id:posts.id,title:posts.title}).from(posts).where(inArray(posts.id,ids('post'))):[];
  const targetRows=ids('post_target').length?await db.select({id:postTargets.id,channelId:postTargets.channelId}).from(postTargets).where(inArray(postTargets.id,ids('post_target'))):[];
  const ticketRows=ids('ticket').length?await db.select({id:tickets.id,subject:tickets.subject}).from(tickets).where(inArray(tickets.id,ids('ticket'))):[];
  const aiRows=ids('ai_job').length?await db.select({id:aiJobs.id,purpose:aiJobs.purpose,provider:aiJobs.provider}).from(aiJobs).where(inArray(aiJobs.id,ids('ai_job'))):[];
  const refRows=ids('referral').length?await db.select({id:referrals.id}).from(referrals).where(inArray(referrals.id,ids('referral'))):[];
  const wpSiteRows=ids('wordpress_site').length?await db.select({id:wordpressSites.id,siteUrl:wordpressSites.siteUrl}).from(wordpressSites).where(inArray(wordpressSites.id,ids('wordpress_site'))):[];
  const wpProductRows=ids('wordpress_product').length?await db.select({id:wordpressProducts.id,title:wordpressProducts.title}).from(wordpressProducts).where(inArray(wordpressProducts.id,ids('wordpress_product'))):[];
  const subRows=ids('subscription').length?await db.select({id:subscriptions.id,tenantId:subscriptions.tenantId,planId:subscriptions.planId}).from(subscriptions).where(inArray(subscriptions.id,ids('subscription'))):[];
  const mapBy=(arr:any[])=>new Map(arr.map(x=>[x.id,x]));
  const userMap=mapBy(userRows), wfMap=mapBy(workflowRows), botMap=mapBy(botRows), cmdMap=mapBy(cmdRows), kwMap=mapBy(kwRows), chMap=mapBy(channelRows), mediaMap=mapBy(mediaRows), payMap=mapBy(paymentRows), planMap=mapBy(planRows), postMap=mapBy(postRows), targetMap=mapBy(targetRows), ticketMap=mapBy(ticketRows), aiMap=mapBy(aiRows), wpSiteMap=mapBy(wpSiteRows), wpProductMap=mapBy(wpProductRows), subMap=mapBy(subRows);
  const labelUser=(id:string|null)=>{if(!id)return 'سامانه';const u=userMap.get(id);return u?(`${u.firstName} ${u.lastName}`.trim()||u.email):'کاربر سامانه';};
  const labelSubject=(t:string|null,id:string|null)=>{ if(!t)return '—'; if(t==='user')return labelUser(id); const x=id||'';
    if(t==='workflow')return wfMap.get(x)?.nameFa||'گردش‌کار'; if(t==='bot'){const b=botMap.get(x);return b?`${b.title} (${PLATFORM_FA_SERVER[b.platform]||'پلتفرم'})`:'ربات';}
    if(t==='bot_command')return cmdMap.get(x)?`دستور «${cmdMap.get(x).command}»`:'دستور ربات'; if(t==='bot_keyword')return kwMap.get(x)?`کلیدواژه «${kwMap.get(x).keyword}»`:'کلیدواژه';
    if(t==='channel'){const c=chMap.get(x);return c?`${c.title} — ${PLATFORM_FA_SERVER[c.platform]||'پلتفرم'}`:'کانال';} if(t==='media')return mediaMap.get(x)?.filename||'فایل رسانه‌ای';
    if(t==='payment'){const q=payMap.get(x);return q?`${PURPOSE_FA_SERVER[q.purpose]||'پرداخت'} — ${num(q.amountRial).toLocaleString('fa-IR')} ریال`:'پرداخت';}
    if(t==='plan')return planMap.get(x)?.nameFa||'پلن'; if(t==='post')return postMap.get(x)?.title||'پست بدون عنوان'; if(t==='post_target'){const tr=targetMap.get(x);const c=tr?chMap.get(tr.channelId):null;return c?`انتشار در «${c.title}»`:'هدف انتشار';}
    if(t==='ticket')return ticketMap.get(x)?.subject||'تیکت'; if(t==='ai_job'){const a=aiMap.get(x);return a?`${PURPOSE_FA_SERVER[a.purpose]||'درخواست هوش مصنوعی'} — ${AI_PROVIDER_FA_SERVER[a.provider]||'سرویس‌دهنده'}`:'درخواست هوش مصنوعی';}
    if(t==='wordpress_site')return 'سایت وردپرس'; if(t==='wordpress_product')return wpProductMap.get(x)?.title||'محصول وردپرس'; if(t==='subscription'){const ss=subMap.get(x);return ss?`اشتراک ${planMap.get(ss.planId)?.nameFa||''}`.trim():'اشتراک';}
    if(t==='ai_provider')return 'سرویس‌دهندهٔ هوش مصنوعی'; if(t==='referral')return 'رویداد معرفی'; return SUBJECT_FA[t]||'موضوع رویداد';
  };
  return {items:rows.map(r=>({id:r.id,actorLabel:labelUser(r.actorId),actorRoleFa:ROLE_FA_SERVER[r.actorRole||'']||'سامانه',actionFa:AUDIT_ACTION_FA[r.action]||'رویداد سامانه',subjectTypeFa:SUBJECT_FA[r.subjectType||'']||'رویداد سامانه',subjectLabel:labelSubject(r.subjectType,r.subjectId),createdAt:r.createdAt})),total:Number(totalRow?.value??0),page:p,pageSize:size};
}

export async function listPlans(): Promise<Array<Record<string, unknown>>> {
  const db = getDb();
  const rows = await db.select().from(plans).orderBy(plans.sortOrder);
  return rows.map((r) => ({
    ...r,
    priceRial: Number(r.priceRial),
    featuresJson: normalizePlanFeatures(r.featuresJson),
  }));
}

export interface PlanPatch {
  nameFa?: string;
  priceRial?: number;
  periodDays?: number;
  isActive?: boolean;
  limitsJson?: Record<string, unknown>;
  featuresJson?: Record<string, unknown>;
  pricingJson?: Record<string, unknown>;
}

const PLAN_LIMIT_KEYS = ['max_channels', 'max_posts', 'max_bots', 'max_schedules', 'ai_monthly', 'storage_mb'] as const;

const DEFAULT_PLAN_LIMITS: PlanLimits = {
  max_channels: 1,
  max_posts: 30,
  max_bots: 1,
  max_schedules: 10,
  ai_monthly: 50,
  storage_mb: 512,
};

const DEFAULT_PLAN_FEATURES: PlanFeatures = {
  gold_ticker: false,
  auto_responder: false,
  woocommerce: false,
  wordpress_campaigns: false,
  content_summarization: false,
};

const PLAN_FEATURE_KEYS = [
  'gold_ticker',
  'auto_responder',
  'woocommerce',
  'wordpress_campaigns',
  'content_summarization',
] as const;

/**
 * Only known plan flags may be stored. Ignore the retired api_access key from
 * stale admin tabs, but reject any other unexpected key. Unknown feature keys
 * must never become effective merely because they are supplied in JSON.
 */
function normalizePlanFeatureInput(
  raw: Record<string, unknown> | undefined,
  base: PlanFeatures = DEFAULT_PLAN_FEATURES,
): PlanFeatures {
  const source = raw ?? {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'api_access') continue; // retired, ignored for safe backward compatibility
    if (!(PLAN_FEATURE_KEYS as readonly string[]).includes(key)) {
      throw new AppError(ERR.VALIDATION('کلید ناشناخته در امکانات پلن مجاز نیست.'));
    }
    if (typeof value !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار امکانات پلن باید روشن یا خاموش باشد.'));
    }
  }
  const current = normalizePlanFeatures(base);
  const result: PlanFeatures = { ...current };
  for (const key of PLAN_FEATURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key] as boolean;
    }
  }
  return result;
}

function numericLimit(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.entries(record).every(([k, v]) => keys.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

/**
 * Round 19 — strict admin-input validation for the discount model.
 *  - renewalDiscountPercent: integer 0-90 (optional, default 0);
 *  - durationDiscounts: object months(1-36) → percent(0-90), ≤12 rows.
 * Throws a Persian 422 on the first offending field.
 */
function validatePlanPricingInput(raw: Record<string, unknown>): PlanPricing {
  const renewalRaw = raw.renewalDiscountPercent;
  const renewal = renewalRaw === undefined ? 0 : Number(renewalRaw);
  if (!Number.isInteger(renewal) || renewal < 0 || renewal > 90) {
    throw new AppError(ERR.VALIDATION('درصد تخفیف تمدید باید عددی بین ۰ تا ۹۰ باشد.'));
  }
  const durationSrc = raw.durationDiscounts;
  if (durationSrc !== undefined && (typeof durationSrc !== 'object' || durationSrc === null || Array.isArray(durationSrc))) {
    throw new AppError(ERR.VALIDATION('قالب تخفیف‌های مدت خرید معتبر نیست.'));
  }
  const durationDiscounts: Record<string, number> = {};
  const entries = Object.entries((durationSrc ?? {}) as Record<string, unknown>);
  if (entries.length > 12) {
    throw new AppError(ERR.VALIDATION('حداکثر ۱۲ ردیف تخفیف مدت خرید مجاز است.'));
  }
  for (const [k, v] of entries) {
    const months = Number(k);
    const pct = Number(v);
    if (!Number.isInteger(months) || months < 1 || months > 36) {
      throw new AppError(ERR.VALIDATION('مدت تخفیف باید عددی بین ۱ تا ۳۶ ماه باشد.'));
    }
    if (!Number.isInteger(pct) || pct < 0 || pct > 90) {
      throw new AppError(ERR.VALIDATION(`درصد تخفیف برای «${months} ماه» باید عددی بین ۰ تا ۹۰ باشد.`));
    }
    durationDiscounts[String(months)] = pct;
  }
  return { renewalDiscountPercent: renewal, durationDiscounts };
}

export async function createPlan(input: {
  code: string;
  nameFa: string;
  priceRial: number;
  periodDays: number;
  limitsJson?: Record<string, unknown>;
  featuresJson?: Record<string, unknown>;
  pricingJson?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const db = getDb();
  const code = input.code.trim();
  const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, code)).limit(1);
  if (existing) throw new AppError(ERR.VALIDATION('کد پلن تکراری است.'));

  const limits = { ...DEFAULT_PLAN_LIMITS, ...(input.limitsJson ?? {}) };
  if (!numericLimit(limits, PLAN_LIMIT_KEYS)) {
    throw new AppError(ERR.VALIDATION('قالب محدودیت‌های پلن معتبر نیست.'));
  }
  const features = normalizePlanFeatureInput(input.featuresJson);
  const pricing = validatePlanPricingInput(input.pricingJson ?? {});

  const id = newId();
  await db.insert(plans).values({
    id,
    code,
    nameFa: input.nameFa.trim().slice(0, 80),
    priceRial: Math.max(0, Math.floor(input.priceRial)),
    periodDays: Math.min(3650, Math.max(1, Math.floor(input.periodDays))),
    limitsJson: limits,
    featuresJson: features,
    pricingJson: pricing,
    sortOrder: 0,
    isActive: 1,
  });
  return { id };
}

export async function deletePlan(planId: string): Promise<void> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  // Any subscription row (ACTIVE, EXPIRED or CANCELLED) keeps the plan alive —
  // history must stay resolvable; deactivate the plan instead of deleting it.
  const [refRow] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.planId, planId));
  if (Number(refRow?.value ?? 0) > 0) {
    throw new AppError(ERR.VALIDATION('به این پلن اشتراک فعال متصل است؛ ابتدا آن اشتراک‌ها را بررسی کنید یا پلن را غیرفعال کنید.'));
  }
  await db.delete(plans).where(eq(plans.id, planId));
}

export async function updatePlan(planId: string, patch: PlanPatch): Promise<void> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id, featuresJson: plans.featuresJson }).from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  const update: Partial<{
    nameFa: string;
    priceRial: number;
    periodDays: number;
    isActive: number;
    limitsJson: PlanLimits;
    featuresJson: PlanFeatures;
    pricingJson: PlanPricing;
  }> = {};
  if (patch.nameFa !== undefined) update.nameFa = patch.nameFa.trim().slice(0, 80);
  if (patch.priceRial !== undefined) update.priceRial = Math.max(0, Math.floor(patch.priceRial));
  if (patch.periodDays !== undefined) update.periodDays = Math.min(3650, Math.max(1, Math.floor(patch.periodDays)));
  if (patch.isActive !== undefined) update.isActive = patch.isActive ? 1 : 0;
  if (patch.limitsJson !== undefined) {
    if (!numericLimit(patch.limitsJson, PLAN_LIMIT_KEYS)) {
      throw new AppError(ERR.VALIDATION('قالب محدودیت‌های پلن معتبر نیست.'));
    }
    update.limitsJson = patch.limitsJson as unknown as PlanLimits;
  }
  if (patch.featuresJson !== undefined) {
    update.featuresJson = normalizePlanFeatureInput(patch.featuresJson, normalizePlanFeatures(plan.featuresJson));
  }
  if (patch.pricingJson !== undefined) {
    update.pricingJson = validatePlanPricingInput(patch.pricingJson);
  }
  if (Object.keys(update).length === 0) return;
  await db.update(plans).set(update).where(eq(plans.id, planId));
}

const MAX_SETTINGS_KEYS = 100;

export async function getSettings(): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.select().from(systemSettings);
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.settingKey.startsWith('notif_pref:')) continue; // per-tenant data stays hidden
    if (r.settingKey === 'cardToCardCards') continue; // re-added below in coerced API shape
    map[r.settingKey] = r.valueJson;
  }
  // Payment gateway settings always surface in their contract shape
  // (contract 14-contract item 2), even if the 0003 seed rows are missing.
  const ps = await getPaymentSettings();
  map.paymentOnlineEnabled = ps.onlineEnabled;
  map.paymentCardToCardEnabled = ps.cardToCardEnabled;
  map.paymentProvider = ps.provider;
  map.cardToCardCards = ps.cards;
  return map;
}

export async function putSettings(map: Record<string, unknown>): Promise<number> {
  const db = getDb();
  const entries = Object.entries(map).filter(([k]) => k.length > 0 && k.length <= 80 && !k.startsWith('notif_pref:'));
  if (entries.length > MAX_SETTINGS_KEYS) {
    throw new AppError(ERR.VALIDATION('تعداد کلیدهای تنظیمات بیش از حد مجاز است.'));
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AppError(ERR.VALIDATION(`مقدار کلید «${key}» باید یک شیء JSON باشد.`));
    }
    await db
      .insert(systemSettings)
      .values({ settingKey: key, valueJson: value as Record<string, unknown> })
      .onDuplicateKeyUpdate({ set: { valueJson: value as Record<string, unknown> } });
  }
  return entries.length;
}

const BROADCAST_BATCH = 500;
const BROADCAST_MAX_BATCHES = 1000; // hard bound: 500k users

export type BroadcastTarget =
  | { kind: 'ALL' }
  | { kind: 'ROLE'; role: 'USER' | 'SUPPORT' | 'SUPER_ADMIN' }
  | { kind: 'PLAN'; planId: string }
  | { kind: 'USERS'; userIds: string[] };

async function notifyBatched(extraWhere: ReturnType<typeof eq> | undefined, titleFa: string, bodyFa: string): Promise<number> {
  const db = getDb();
  let notified = 0;
  let cursor = '';
  for (let batch = 0; batch < BROADCAST_MAX_BATCHES; batch++) {
    const conds = [
      eq(users.status, 'ACTIVE'),
      ...(extraWhere ? [extraWhere] : []),
      ...(cursor ? [sql`${users.id} > ${cursor}`] : []),
    ];
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(...conds))
      .orderBy(users.id)
      .limit(BROADCAST_BATCH);
    if (rows.length === 0) break;
    for (const r of rows) {
      await notifyTenant({ tenantId: r.id, kind: 'BROADCAST', titleFa, bodyFa });
      notified++;
    }
    const lastUser = rows[rows.length - 1];
    if (!lastUser) break;
    cursor = lastUser.id;
    if (rows.length < BROADCAST_BATCH) break;
  }
  return notified;
}

/**
 * Broadcast (§27, extended round 19): targeted notifications.
 *  - ALL: every ACTIVE user (original behavior);
 *  - ROLE: ACTIVE users with the given role (گروه کاربری);
 *  - PLAN: tenants with an ACTIVE subscription on the plan (گروه اشتراک);
 *  - USERS: explicit member list — sent regardless of status, because the
 *    admin deliberately picked each recipient (اعضای خاص).
 */
export async function broadcast(
  actorId: string,
  titleFa: string,
  bodyFa: string,
  target: BroadcastTarget = { kind: 'ALL' }
): Promise<number> {
  const db = getDb();
  let notified = 0;

  if (target.kind === 'USERS') {
    const ids = Array.from(new Set(target.userIds));
    for (const id of ids) {
      await notifyTenant({ tenantId: id, kind: 'BROADCAST', titleFa, bodyFa });
      notified++;
    }
    void actorId;
    return notified;
  }

  if (target.kind === 'PLAN') {
    // ACTIVE subscriptions on the plan, joined to ACTIVE users; paged by
    // cursor on subscriptions.id to stay within bounded batches.
    let cursor = '';
    for (let batch = 0; batch < BROADCAST_MAX_BATCHES; batch++) {
      const conds = [
        eq(subscriptions.planId, target.planId),
        eq(subscriptions.state, 'ACTIVE'),
        gt(subscriptions.expiresAt, new Date()),
        ...(cursor ? [sql`${subscriptions.id} > ${cursor}`] : []),
      ];
      const rows = await db
        .select({ subId: subscriptions.id, tenantId: subscriptions.tenantId, status: users.status })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.tenantId))
        .where(and(...conds))
        .orderBy(subscriptions.id)
        .limit(BROADCAST_BATCH);
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.status !== 'ACTIVE') continue;
        await notifyTenant({ tenantId: r.tenantId, kind: 'BROADCAST', titleFa, bodyFa });
        notified++;
      }
      const lastSub = rows[rows.length - 1];
      if (!lastSub) break;
      cursor = lastSub.subId;
      if (rows.length < BROADCAST_BATCH) break;
    }
    void actorId;
    return notified;
  }

  notified = await notifyBatched(
    target.kind === 'ROLE' ? eq(users.role, target.role) : undefined,
    titleFa,
    bodyFa
  );
  return notified;
}

/**
 * Round 19 — target-picker data for the broadcast page: ACTIVE-user counts per
 * role and per active plan (one grouped query each + the plan catalog).
 */
export async function getBroadcastTargets(): Promise<{
  roles: Array<{ role: string; count: number }>;
  plans: Array<{ id: string; nameFa: string; subscribers: number }>;
}> {
  const db = getDb();
  const roleRows = await db
    .select({ role: users.role, value: count() })
    .from(users)
    .where(eq(users.status, 'ACTIVE'))
    .groupBy(users.role);

  const planRows = await db.select({ id: plans.id, nameFa: plans.nameFa }).from(plans).where(eq(plans.isActive, 1)).orderBy(plans.sortOrder);
  const subRows = await db
    .select({ planId: subscriptions.planId, value: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.state, 'ACTIVE'), gt(subscriptions.expiresAt, new Date())))
    .groupBy(subscriptions.planId);
  const subByPlan = new Map(subRows.map((r) => [r.planId, Number(r.value)]));

  return {
    roles: roleRows.map((r) => ({ role: r.role, count: Number(r.value) })),
    plans: planRows.map((p) => ({ id: p.id, nameFa: p.nameFa, subscribers: subByPlan.get(p.id) ?? 0 })),
  };
}

export async function releaseChannel(actorId: string, platform: 'telegram' | 'bale' | 'rubika', channelRef: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ tenantId: channelRegistry.tenantId })
    .from(channelRegistry)
    .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال در دفتر ثبت کانال‌ها'));
  await db
    .update(channelRegistry)
    .set({ tenantId: null, releasedAt: new Date() })
    .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)));
  void actorId;
}
