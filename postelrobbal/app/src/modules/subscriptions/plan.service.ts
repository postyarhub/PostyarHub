import { and, count, desc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { getDb, type Db } from '../../db/client.js';
import {
  plans,
  subscriptions,
  users,
  channels,
  bots,
  posts,
  aiUsageMonthly,
  type PlanLimits,
  type PlanFeatures,
  type PlanPricing,
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';

/** Transaction executor type (the callback parameter of db.transaction). */
type TxCallback = Parameters<Db['transaction']>[0];
export type Tx = Parameters<TxCallback>[0];

export interface PlanContext {
  subscriptionId: string | null;
  planId: string;
  planCode: string;
  planNameFa: string;
  state: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'FREE';
  startedAt: Date | null;
  expiresAt: Date | null;
  limits: PlanLimits;
  features: PlanFeatures;
}

/** Fallback free context when the seeded 'free' plan row is missing. */
const FREE_FALLBACK_LIMITS: PlanLimits = {
  max_channels: 2,
  max_posts: 10,
  max_bots: 0,
  max_schedules: 3,
  ai_monthly: 0,
  storage_mb: 50,
};
const FREE_FALLBACK_FEATURES: PlanFeatures = {
  gold_ticker: false,
  auto_responder: false,
  woocommerce: false,
  wordpress_campaigns: false,
  content_summarization: false,
};

/**
 * Allowlist plan feature data before it crosses a runtime/API boundary.
 * Legacy api_access and any unknown keys are intentionally discarded.
 * Missing wordpress_campaigns stays missing to preserve the existing, explicit
 * backward-compatibility rule for older plans.
 */
export function normalizePlanFeatures(raw: unknown): PlanFeatures {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const clean: PlanFeatures = {
    gold_ticker: source.gold_ticker === true,
    auto_responder: source.auto_responder === true,
    woocommerce: source.woocommerce === true,
  };
  if (typeof source.wordpress_campaigns === 'boolean') {
    clean.wordpress_campaigns = source.wordpress_campaigns;
  }
  if (typeof source.content_summarization === 'boolean') {
    clean.content_summarization = source.content_summarization;
  }
  return clean;
}

/** Round 19 defaults — a plan without pricing data behaves exactly like before. */
export const DEFAULT_PLAN_PRICING: PlanPricing = {
  renewalDiscountPercent: 0,
  durationDiscounts: {},
};

/** Coerces any stored/legacy shape into a valid PlanPricing (never throws). */
export function normalizePlanPricing(raw: unknown): PlanPricing {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const renewal = Number(src.renewalDiscountPercent);
  const durationSrc = (src.durationDiscounts && typeof src.durationDiscounts === 'object'
    ? src.durationDiscounts
    : {}) as Record<string, unknown>;
  const durationDiscounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(durationSrc)) {
    const months = Number(k);
    const pct = Number(v);
    if (Number.isInteger(months) && months >= 1 && months <= 36 && Number.isInteger(pct) && pct >= 0 && pct <= 90) {
      durationDiscounts[String(months)] = pct;
    }
  }
  return {
    renewalDiscountPercent:
      Number.isInteger(renewal) && renewal >= 0 && renewal <= 90 ? renewal : 0,
    durationDiscounts,
  };
}

/**
 * True when the tenant currently holds an ACTIVE subscription whose expiry is
 * still in the future. Registration seeds the free plan the same way (30 days,
 * state ACTIVE), so free-plan users qualify for the renewal/upgrade discount
 * until their free period ends — exactly the round-19 contract example.
 */
export async function hasUnexpiredSubscription(tenantId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.state, 'ACTIVE'),
        gt(subscriptions.expiresAt, new Date())
      )
    )
    .limit(1);
  return Boolean(row);
}

export interface SubscriptionPriceBreakdown {
  listAmountRial: number;
  durationDiscountPercent: number;
  renewalDiscountPercent: number;
  totalDiscountPercent: number;
  discountAmountRial: number;
  finalAmountRial: number;
}

/** Hard cap so stacked discounts can never exceed 90% of the list price. */
export const MAX_TOTAL_DISCOUNT_PERCENT = 90;

/**
 * Round 19 pricing engine — single source for every checkout path (online
 * gateway, card-to-card intent, legacy checkout route).
 *  - duration discount: plan.durationDiscounts[String(months)] ?? 0;
 *  - renewal/upgrade discount: plan.renewalDiscountPercent, only when the
 *    buyer has an unexpired subscription (hasUnexpiredSubscription);
 *  - the two add up, capped at MAX_TOTAL_DISCOUNT_PERCENT;
 *  - the discount amount floors (⌊list·pct/100⌋) so the final amount is an
 *    exact integer rial value.
 */
export function computeSubscriptionPrice(
  plan: { priceRial: number; pricingJson?: unknown },
  months: number,
  hasActive: boolean
): SubscriptionPriceBreakdown {
  const pricing = normalizePlanPricing(plan.pricingJson);
  const listAmountRial = Math.max(0, Math.floor(Number(plan.priceRial) || 0)) * Math.max(1, months);
  const durationDiscountPercent = pricing.durationDiscounts[String(months)] ?? 0;
  const renewalDiscountPercent = hasActive ? pricing.renewalDiscountPercent : 0;
  const totalDiscountPercent = Math.min(
    MAX_TOTAL_DISCOUNT_PERCENT,
    durationDiscountPercent + renewalDiscountPercent
  );
  const discountAmountRial = Math.floor((listAmountRial * totalDiscountPercent) / 100);
  return {
    listAmountRial,
    durationDiscountPercent,
    renewalDiscountPercent,
    totalDiscountPercent,
    discountAmountRial,
    finalAmountRial: listAmountRial - discountAmountRial,
  };
}

function freeContext(free?: { id: string; code: string; nameFa: string; limitsJson: PlanLimits; featuresJson: PlanFeatures; periodDays: number }): PlanContext {
  return {
    subscriptionId: null,
    planId: free?.id ?? 'free',
    planCode: free?.code ?? 'free',
    planNameFa: free?.nameFa ?? 'رایگان',
    state: 'FREE',
    startedAt: null,
    expiresAt: null,
    limits: free?.limitsJson ?? FREE_FALLBACK_LIMITS,
    features: free ? normalizePlanFeatures(free.featuresJson) : FREE_FALLBACK_FEATURES,
  };
}

/** Latest ACTIVE subscription joined with its plan; free plan when none exists. */
export async function getPlanContext(tenantId: string): Promise<PlanContext> {
  const db = getDb();
  const [row] = await db
    .select({
      subscriptionId: subscriptions.id,
      startedAt: subscriptions.startedAt,
      expiresAt: subscriptions.expiresAt,
      planId: plans.id,
      planCode: plans.code,
      planNameFa: plans.nameFa,
      limitsJson: plans.limitsJson,
      featuresJson: plans.featuresJson,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(
      eq(subscriptions.tenantId, tenantId),
      eq(subscriptions.state, 'ACTIVE'),
      gt(subscriptions.expiresAt, new Date()),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (row) {
    return {
      subscriptionId: row.subscriptionId,
      planId: row.planId,
      planCode: row.planCode,
      planNameFa: row.planNameFa,
      state: 'ACTIVE',
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      limits: row.limitsJson,
      features: normalizePlanFeatures(row.featuresJson),
    };
  }

  const [freePlan] = await db.select().from(plans).where(eq(plans.code, 'free')).limit(1);
  return freeContext(freePlan);
}

export type LimitKind = 'channels' | 'posts' | 'bots' | 'schedules' | 'ai_monthly';
export type PlanFeature = keyof PlanFeatures;

const QUOTA_LABELS: Record<Exclude<LimitKind, 'channels'>, string> = {
  posts: 'ارسال پست',
  bots: 'ربات',
  schedules: 'زمان‌بندی',
  ai_monthly: 'هوش مصنوعی',
};

async function countRows(tenantId: string): Promise<{ channels: number; bots: number }> {
  const db = getDb();
  const [c] = await db.select({ value: count() }).from(channels).where(eq(channels.tenantId, tenantId));
  const [b] = await db.select({ value: count() }).from(bots).where(eq(bots.tenantId, tenantId));
  return { channels: Number(c?.value ?? 0), bots: Number(b?.value ?? 0) };
}

/**
 * Plan quota enforcement (§118). channels/bots count all tenant rows;
 * posts count non-draft rows since the subscription period start;
 * schedules count SCHEDULED posts; ai_monthly checks the current period.
 * A zero limit means unlimited only for posts and schedules; `ai_monthly = 0` means AI is unavailable.
 */
export async function assertWithinLimit(tenantId: string, kind: LimitKind): Promise<void> {
  const ctx = await getPlanContext(tenantId);
  const db = getDb();

  if (kind === 'channels') {
    const { channels: used } = await countRows(tenantId);
    if (used >= ctx.limits.max_channels) throw new AppError(ERR.CHANNEL_LIMIT());
    return;
  }

  if (kind === 'bots') {
    const { bots: used } = await countRows(tenantId);
    if (used >= ctx.limits.max_bots) throw new AppError(ERR.QUOTA_EXCEEDED(QUOTA_LABELS.bots));
    return;
  }

  if (kind === 'posts') {
    if (ctx.limits.max_posts === 0) return; // unlimited
    const startedAt = ctx.startedAt;
    const conds = startedAt
      ? and(
          eq(posts.tenantId, tenantId),
          ne(posts.state, 'DRAFT'),
          ne(posts.state, 'CANCELLED'),
          sql`${posts.createdAt} >= ${startedAt}`
        )
      : and(eq(posts.tenantId, tenantId), ne(posts.state, 'DRAFT'), ne(posts.state, 'CANCELLED'));
    const [row] = await db.select({ value: count() }).from(posts).where(conds);
    if (Number(row?.value ?? 0) >= ctx.limits.max_posts) {
      throw new AppError(ERR.QUOTA_EXCEEDED(QUOTA_LABELS.posts));
    }
    return;
  }

  if (kind === 'schedules') {
    if (ctx.limits.max_schedules === 0) return; // unlimited
    const [row] = await db
      .select({ value: count() })
      .from(posts)
      .where(and(eq(posts.tenantId, tenantId), eq(posts.state, 'SCHEDULED')));
    if (Number(row?.value ?? 0) >= ctx.limits.max_schedules) {
      throw new AppError(ERR.QUOTA_EXCEEDED(QUOTA_LABELS.schedules));
    }
    return;
  }

  // ai_monthly: 0 is a hard entitlement block, not unlimited.
  if (ctx.limits.ai_monthly === 0) {
    throw new AppError(ERR.PLAN_FEATURE_REQUIRED('هوش مصنوعی'));
  }
  const periodYm = new Date().toISOString().slice(0, 7);
  const [row] = await db
    .select({ requestCount: aiUsageMonthly.requestCount })
    .from(aiUsageMonthly)
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm)))
    .limit(1);
  if (Number(row?.requestCount ?? 0) >= ctx.limits.ai_monthly) {
    throw new AppError(ERR.QUOTA_EXCEEDED(QUOTA_LABELS.ai_monthly));
  }
}


/** Authoritative plan-feature guard used by every feature boundary. */
export async function assertFeature(tenantId: string, feature: PlanFeature): Promise<PlanContext> {
  const ctx = await getPlanContext(tenantId);
  const features = (ctx.features ?? {}) as Partial<PlanFeatures>;
  // Backward compatibility: subscriptions created before the separate campaign
  // entitlement existed inherit the previous WooCommerce permission only while
  // the new flag is absent. An explicit false set by an administrator is final.
  const legacyCampaignAccess = feature === 'wordpress_campaigns'
    && typeof features.wordpress_campaigns !== 'boolean'
    && features.woocommerce === true;
  const enabled = features[feature] === true || legacyCampaignAccess;
  if (!enabled) {
    const labels: Record<PlanFeature, string> = {
      gold_ticker: 'ربات نرخ طلا و سکه',
      auto_responder: 'گردش‌کار و پاسخ‌گوی خودکار',
      woocommerce: 'اتصال وب‌سایت',
      wordpress_campaigns: 'کمپین‌های وب‌سایت',
      content_summarization: 'خلاصه‌سازی هوشمند محتوای سایت',
    };
    throw new AppError(ERR.PLAN_FEATURE_REQUIRED(labels[feature]));
  }
  return ctx;
}

export interface ActivatedSubscription {
  subscriptionId: string;
  planCode: string;
  startedAt: Date;
  expiresAt: Date;
  renewed: boolean;
}

/** Core activation logic — callable inside an existing transaction. */
export async function activateSubscriptionTx(
  tx: Tx,
  tenantId: string,
  planId: string,
  months: number
): Promise<ActivatedSubscription> {
  const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));

  // Serialize plan changes per tenant. This also establishes a shared lock
  // boundary with channel/bot/post quota-sensitive mutations.
  await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');

  const [active] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.state, 'ACTIVE')))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1)
    .for('update');

  const now = new Date();
  const base = active && active.expiresAt.getTime() > now.getTime() ? active.expiresAt : now;
  const startedAt = new Date(base);
  const expiresAt = new Date(base.getTime() + months * plan.periodDays * 86400_000);
  const id = newId();

  await tx.insert(subscriptions).values({
    id,
    tenantId,
    planId,
    state: 'ACTIVE',
    startedAt,
    expiresAt,
  });

  return { subscriptionId: id, planCode: plan.code, startedAt, expiresAt, renewed: Boolean(active) };
}

/**
 * Activation state machine (§118): extension base = max(now, current ACTIVE
 * expiry); new ACTIVE row inserted; event + audit emitted.
 */
export async function activateSubscription(
  tenantId: string,
  planId: string,
  months: number
): Promise<ActivatedSubscription> {
  const db = getDb();
  const result = await db.transaction((tx) => activateSubscriptionTx(tx, tenantId, planId, months));

  await emitEvent({
    name: result.renewed ? 'subscription.renewed' : 'subscription.created',
    tenantId,
    subjectType: 'subscription',
    subjectId: result.subscriptionId,
    props: { planCode: result.planCode, months },
  });
  await audit({
    action: 'subscription.activated',
    actorId: tenantId,
    subjectType: 'subscription',
    subjectId: result.subscriptionId,
    meta: { planCode: result.planCode, months, renewed: result.renewed },
  });
  return result;
}

/** ACTIVE + expired → EXPIRED, one event per row. Used by the scheduler. */
export async function expireDueSubscriptions(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const due = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .where(and(eq(subscriptions.state, 'ACTIVE'), lt(subscriptions.expiresAt, now)))
    .limit(200);

  let expired = 0;
  for (const sub of due) {
    const res = await db
      .update(subscriptions)
      .set({ state: 'EXPIRED' })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.state, 'ACTIVE')));
    const changed = Array.isArray(res) ? Number(res[0]?.affectedRows ?? 0) : Number((res as { affectedRows?: number })?.affectedRows ?? 0);
    if (changed > 0) {
      expired++;
      await emitEvent({
        name: 'subscription.expired',
        tenantId: sub.tenantId,
        subjectType: 'subscription',
        subjectId: sub.id,
      });
    }
  }
  return expired;
}
