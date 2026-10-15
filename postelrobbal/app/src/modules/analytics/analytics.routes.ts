import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { aiUsageMonthly, bots, channels, events, posts, postTargets, walletAccounts } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import {
  createTrackedLink,
  getAdminAnalytics,
  getCampaignAnalytics,
  getLinkStats,
  getPostAnalytics,
  getTenantAnalytics,
  getWordPressAnalytics,
  recordTrackedLinkClick,
  resolveTrackedLink,
} from './analytics.service.js';

function requireTenant(req: { user?: { id: string } }): string {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user.id;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const eventsQuerySchema = z.object({
  cursor: z.string().min(10).max(26).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const dailyQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
const daysQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const trackLinkSchema = z.object({
  destinationUrl: z.string().url().max(2000),
  postId: z.string().max(26).nullable().optional(),
  targetId: z.string().max(26).nullable().optional(),
  channelId: z.string().max(26).nullable().optional(),
  campaignId: z.string().max(26).nullable().optional(),
  source: z.string().max(32).nullable().optional(),
});

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/analytics/overview', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const db = getDb();
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const periodYm = new Date().toISOString().slice(0, 7);
    const [channelRows, botRows, postRows, sentRows, failedRows, walletRows, aiRows] = await Promise.all([
      db.select({ status: channels.status, count: sql<number>`count(*)` }).from(channels).where(eq(channels.tenantId, tenantId)).groupBy(channels.status),
      db.select({ status: bots.status, count: sql<number>`count(*)` }).from(bots).where(eq(bots.tenantId, tenantId)).groupBy(bots.status),
      db.select({ state: posts.state, count: sql<number>`count(*)` }).from(posts).where(eq(posts.tenantId, tenantId)).groupBy(posts.state),
      db.select({ count: sql<number>`count(*)` }).from(postTargets).where(and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'SENT'), gte(postTargets.sentAt, since30d))),
      db.select({ count: sql<number>`count(*)` }).from(postTargets).where(and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'FAILED'), gte(postTargets.updatedAt, since30d))),
      db.select({ balanceRial: walletAccounts.balanceRial }).from(walletAccounts).where(eq(walletAccounts.tenantId, tenantId)).limit(1),
      db.select({ requestCount: aiUsageMonthly.requestCount, tokenCount: aiUsageMonthly.tokenCount }).from(aiUsageMonthly).where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm))).limit(1),
    ]);
    let analytics: Awaited<ReturnType<typeof getTenantAnalytics>> | null = null;
    try { analytics = await getTenantAnalytics(tenantId, 30); } catch { /* legacy overview remains available */ }
    const countBy = (rows: Array<{ status?: string; state?: string; count: unknown }>, value: string): number => rows.filter((r) => (r.status ?? r.state) === value).reduce((acc, r) => acc + num(r.count), 0);
    return {
      success: true,
      data: {
        channels: { total: channelRows.reduce((acc, r) => acc + num(r.count), 0), active: countBy(channelRows, 'ACTIVE') },
        bots: { total: botRows.reduce((acc, r) => acc + num(r.count), 0), active: countBy(botRows, 'ACTIVE') },
        posts: { total: postRows.reduce((acc, r) => acc + num(r.count), 0), published: countBy(postRows, 'PUBLISHED') + countBy(postRows, 'PARTIAL') },
        deliveries: { sent30d: num(sentRows[0]?.count), failed30d: num(failedRows[0]?.count) },
        wallet: { balanceRial: num(walletRows[0]?.balanceRial ?? 0) },
        ai: { periodYm, requestCount: num(aiRows[0]?.requestCount ?? 0), tokenCount: num(aiRows[0]?.tokenCount ?? 0) },
        analytics,
      },
    };
  });

  app.get('/analytics/summary', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    return { success: true, data: await getTenantAnalytics(tenantId, query.data.days) };
  });

  app.get('/analytics/automation', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    const data = await getTenantAnalytics(tenantId, query.data.days);
    return { success: true, data: { days: data.days, automation: data.automation } };
  });

  app.get('/analytics/wordpress', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    return { success: true, data: await getWordPressAnalytics(tenantId, query.data.days) };
  });

  app.get('/analytics/revenue', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    const data = await getTenantAnalytics(tenantId, query.data.days);
    return { success: true, data: { days: data.days, revenue: data.revenue } };
  });

  app.get('/analytics/posts/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const id = String((req.params as { id?: string }).id ?? '');
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    return { success: true, data: await getPostAnalytics(tenantId, id, query.data.days) };
  });

  app.get('/analytics/campaigns/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const id = String((req.params as { id?: string }).id ?? '');
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    return { success: true, data: await getCampaignAnalytics(tenantId, id, query.data.days) };
  });

  app.get('/analytics/events', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const parsed = eventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new AppError(ERR.VALIDATION('پارامترهای صفحه‌بندی معتبر نیست.'));
    const db = getDb();
    const conditions = [eq(events.tenantId, tenantId)];
    if (parsed.data.cursor) conditions.push(lt(events.id, parsed.data.cursor));
    const rows = await db.select().from(events).where(and(...conditions)).orderBy(sql`${events.id} DESC`).limit(parsed.data.limit);
    return { success: true, data: { events: rows.map((e) => ({ id: e.id, name: e.name, subjectType: e.subjectType, subjectId: e.subjectId, props: e.propsJson, createdAt: e.createdAt })), nextCursor: rows.length === parsed.data.limit ? (rows[rows.length - 1]?.id ?? null) : null } };
  });

  app.get('/analytics/daily', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const parsed = dailyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new AppError(ERR.VALIDATION('پارامتر بازهٔ زمانی معتبر نیست.'));
    const analytics = await getTenantAnalytics(tenantId, parsed.data.days);
    return { success: true, data: { days: parsed.data.days, series: analytics.daily, summary: analytics } };
  });

  app.post('/analytics/links', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const parsed = trackLinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(ERR.VALIDATION('اطلاعات لینک معتبر نیست.'));
    try {
      return { success: true, data: await createTrackedLink({ userId: tenantId, ...parsed.data }) };
    } catch {
      throw new AppError(ERR.VALIDATION('آدرس مقصد معتبر نیست.'));
    }
  });

  app.get('/analytics/links/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const id = String((req.params as { id?: string }).id ?? '');
    const data = await getLinkStats(tenantId, id);
    if (!data) throw new AppError(ERR.NOT_FOUND('لینک تحلیلی'));
    return { success: true, data };
  });

  app.get('/r/:token', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = String((req.params as { token?: string }).token ?? '');
    const link = await resolveTrackedLink(token);
    if (!link) throw new AppError(ERR.NOT_FOUND('لینک'));
    const q = (req.query ?? {}) as Record<string, unknown>;
    await recordTrackedLinkClick(link, {
      platform: typeof q.platform === 'string' ? q.platform : null,
      source: typeof q.source === 'string' ? q.source : null,
      referrer: req.headers.referer ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip,
    });
    return reply.redirect(link.destinationUrl);
  });

  app.get('/admin/analytics/overview', { preHandler: [app.requirePermission('admin.access')] }, async (req) => {
    const query = daysQuerySchema.safeParse(req.query ?? {});
    if (!query.success) throw new AppError(ERR.VALIDATION('بازهٔ تحلیل معتبر نیست.'));
    return { success: true, data: await getAdminAnalytics(query.data.days) };
  });
}
