import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { asc, eq, count, countDistinct, gte } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { plans, aiUsageMonthly, posts, channels, bots, postTargets } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { and, ne, sql } from 'drizzle-orm';
import { getPlanContext, normalizePlanFeatures } from './plan.service.js';
import { createSubscriptionPayment } from '../payments/payment.service.js';
import { parseWith } from '../../core/validation.js';

function auth(req: FastifyRequest): { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

const checkoutSchema = z.object({
  planCode: z.string().min(1).max(40),
  months: z.coerce.number().int().min(1).max(12),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  // Public: plan catalog with Persian names (landing + dashboard)
  app.get('/subscriptions/plans', async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: plans.id,
        code: plans.code,
        nameFa: plans.nameFa,
        priceRial: plans.priceRial,
        periodDays: plans.periodDays,
        limitsJson: plans.limitsJson,
        featuresJson: plans.featuresJson,
        pricingJson: plans.pricingJson,
        sortOrder: plans.sortOrder,
      })
      .from(plans)
      .where(eq(plans.isActive, 1))
      .orderBy(asc(plans.sortOrder));
    return {
      success: true,
      data: {
        plans: rows.map((row) => ({ ...row, featuresJson: normalizePlanFeatures(row.featuresJson) })),
      },
    };
  });

  // Contract 14-contract item 6: current subscription + plan + server-computed
  // usage for the (re)built Subscription page.
  //   postsSent      → DISTINCT posts with ≥1 SENT delivery (post_targets
  //                    state='SENT', sent_at within the subscription period;
  //                    all-time when no subscription). "Delivered posts" — the
  //                    countable, honest state, unlike created-post counts.
  //   botsActive / channelsActive → tenant row counts. The schema has no
  //                    soft-delete marker (disconnect = status DISABLED, row
  //                    kept), matching §118 quota counting in plan.service.
  //   daysRemaining  → ceil((expiresAt − now)/day), 0 without a subscription.
  //   limits         → plan.limitsJson (max_posts / max_bots / max_channels);
  //                    0 means unlimited (documented product semantics).
  app.get('/subscriptions/current', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const tenantId = me.id;
    const ctx = await getPlanContext(tenantId);
    const db = getDb();

    const [planRow] = await db
      .select({ priceRial: plans.priceRial, periodDays: plans.periodDays })
      .from(plans)
      .where(eq(plans.id, ctx.planId))
      .limit(1);

    const sentConds = ctx.startedAt
      ? and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'SENT'), gte(postTargets.sentAt, ctx.startedAt))
      : and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'SENT'));
    const [postsRow] = await db
      .select({ value: countDistinct(postTargets.postId) })
      .from(postTargets)
      .where(sentConds);
    const [channelsRow] = await db.select({ value: count() }).from(channels).where(eq(channels.tenantId, tenantId));
    const [botsRow] = await db.select({ value: count() }).from(bots).where(eq(bots.tenantId, tenantId));

    const daysRemaining = ctx.expiresAt
      ? Math.max(0, Math.ceil((ctx.expiresAt.getTime() - Date.now()) / 86_400_000))
      : 0;

    return {
      success: true,
      data: {
        subscription:
          ctx.subscriptionId && ctx.state === 'ACTIVE'
            ? { id: ctx.subscriptionId, state: ctx.state, startedAt: ctx.startedAt, expiresAt: ctx.expiresAt }
            : null,
        plan: {
          id: ctx.planId,
          code: ctx.planCode,
          nameFa: ctx.planNameFa,
          priceRial: Number(planRow?.priceRial ?? 0),
          periodDays: Number(planRow?.periodDays ?? 30),
          limits: ctx.limits,
          features: ctx.features,
        },
        usage: {
          daysRemaining,
          postsSent: Number(postsRow?.value ?? 0),
          botsActive: Number(botsRow?.value ?? 0),
          channelsActive: Number(channelsRow?.value ?? 0),
          limits: {
            postsPerMonth: ctx.limits.max_posts,
            bots: ctx.limits.max_bots,
            channels: ctx.limits.max_channels,
          },
        },
      },
    };
  });

  // Current subscription + plan + limits + live usage summary
  app.get('/subscriptions/me', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const tenantId = me.id;
    const ctx = await getPlanContext(tenantId);
    const db = getDb();

    const startedAt = ctx.startedAt;
    const postConds = startedAt
      ? and(eq(posts.tenantId, tenantId), ne(posts.state, 'DRAFT'), ne(posts.state, 'CANCELLED'), sql`${posts.createdAt} >= ${startedAt}`)
      : and(eq(posts.tenantId, tenantId), ne(posts.state, 'DRAFT'), ne(posts.state, 'CANCELLED'));

    const [channelsRow] = await db.select({ value: count() }).from(channels).where(eq(channels.tenantId, tenantId));
    const [botsRow] = await db.select({ value: count() }).from(bots).where(eq(bots.tenantId, tenantId));
    const [postsRow] = await db.select({ value: count() }).from(posts).where(postConds);
    const [schedRow] = await db
      .select({ value: count() })
      .from(posts)
      .where(and(eq(posts.tenantId, tenantId), eq(posts.state, 'SCHEDULED')));
    const periodYm = new Date().toISOString().slice(0, 7);
    const [aiRow] = await db
      .select({ requestCount: aiUsageMonthly.requestCount })
      .from(aiUsageMonthly)
      .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm)))
      .limit(1);

    return {
      success: true,
      data: {
        subscription: {
          id: ctx.subscriptionId,
          state: ctx.state,
          startedAt: ctx.startedAt,
          expiresAt: ctx.expiresAt,
        },
        plan: {
          id: ctx.planId,
          code: ctx.planCode,
          nameFa: ctx.planNameFa,
          limits: ctx.limits,
          features: ctx.features,
        },
        usage: {
          channels: Number(channelsRow?.value ?? 0),
          bots: Number(botsRow?.value ?? 0),
          postsThisPeriod: Number(postsRow?.value ?? 0),
          scheduled: Number(schedRow?.value ?? 0),
          aiRequestsThisMonth: Number(aiRow?.requestCount ?? 0),
        },
      },
    };
  });

  // Checkout: create a gateway payment and return the redirect URL
  app.post('/subscriptions/checkout', { preHandler: [app.requireAuth] }, async (req) => {
    const input = parse(checkoutSchema, req.body);
    const result = await createSubscriptionPayment(auth(req).id, input.planCode, input.months);
    return { success: true, data: result };
  });
}
