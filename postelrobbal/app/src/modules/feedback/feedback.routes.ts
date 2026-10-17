import { ulid } from 'ulid';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { userFeedback } from '../../db/schema.js';

const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
const submitSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  message: z.string().trim().min(30).max(2000),
  showOnHomepage: z.boolean(),
});
const reviewSchema = z.object({ note: z.string().trim().max(500).optional().default('') });
type FeedbackStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED';

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ success: false, error: { code, message } });
}
function isSuperAdmin(req: FastifyRequest): boolean {
  return req.user?.role === 'SUPER_ADMIN';
}
function newId(): string { return ulid(); }
function statusLabel(status: FeedbackStatus): string {
  return ({ PENDING: 'در انتظار بررسی', APPROVED: 'تأیید شده', REJECTED: 'رد شده', CLOSED: 'از نمایش خارج شده' })[status];
}

export async function registerFeedbackRoutes(app: FastifyInstance): Promise<void> {
  // Only feedback with explicit display consent and administrator approval can appear publicly.
  app.get('/feedback/public', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const rows = await getDb().select({
      id: userFeedback.id,
      displayName: userFeedback.displayName,
      message: userFeedback.message,
      createdAt: userFeedback.createdAt,
    }).from(userFeedback)
      .where(and(eq(userFeedback.status, 'APPROVED'), eq(userFeedback.showOnHomepage, 1)))
      .orderBy(desc(userFeedback.updatedAt), desc(userFeedback.createdAt)).limit(6);
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return { success: true, data: { items: rows } };
  });

  app.get('/feedback/mine', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!req.user) return sendError(reply, 401, 'AUTH_REQUIRED', 'برای مشاهدهٔ نظرات ثبت‌شده وارد حساب شوید.');
    const rows = await getDb().select({
      id: userFeedback.id,
      displayName: userFeedback.displayName,
      message: userFeedback.message,
      showOnHomepage: userFeedback.showOnHomepage,
      status: userFeedback.status,
      reviewNote: userFeedback.reviewNote,
      createdAt: userFeedback.createdAt,
      updatedAt: userFeedback.updatedAt,
    }).from(userFeedback).where(eq(userFeedback.userId, req.user.id))
      .orderBy(desc(userFeedback.createdAt)).limit(50);
    return { success: true, data: { items: rows.map((item) => ({ ...item, statusLabel: statusLabel(item.status as FeedbackStatus) })) } };
  });

  app.post('/feedback', { preHandler: [app.requireAuth], config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!req.user) return sendError(reply, 401, 'AUTH_REQUIRED', 'برای ثبت نظر وارد حساب شوید.');
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'نام نمایشی معتبر و متن نظر بین ۳۰ تا ۲۰۰۰ نویسه لازم است.');
    const db = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db.select({ total: count() }).from(userFeedback)
      .where(and(eq(userFeedback.userId, req.user.id), gte(userFeedback.createdAt, since)));
    if (Number(recent[0]?.total ?? 0) >= 3) return sendError(reply, 429, 'FEEDBACK_DAILY_LIMIT', 'حداکثر ۳ نظر در هر ۲۴ ساعت مجاز است.');
    const id = newId();
    await db.insert(userFeedback).values({
      id,
      userId: req.user.id,
      displayName: parsed.data.displayName,
      message: parsed.data.message,
      showOnHomepage: parsed.data.showOnHomepage ? 1 : 0,
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    });
    reply.code(201);
    return { success: true, data: { id, status: 'PENDING', message: 'نظر شما برای بررسی مدیر ثبت شد.' } };
  });

  app.get('/feedback/admin', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!isSuperAdmin(req)) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const db = getDb();
    const rows = await db.select({
      id: userFeedback.id,
      userId: userFeedback.userId,
      displayName: userFeedback.displayName,
      message: userFeedback.message,
      showOnHomepage: userFeedback.showOnHomepage,
      status: userFeedback.status,
      reviewedBy: userFeedback.reviewedBy,
      reviewedAt: userFeedback.reviewedAt,
      reviewNote: userFeedback.reviewNote,
      createdAt: userFeedback.createdAt,
      updatedAt: userFeedback.updatedAt,
    }).from(userFeedback).orderBy(desc(userFeedback.createdAt)).limit(500);
    const grouped = await db.select({ status: userFeedback.status, total: count() })
      .from(userFeedback).groupBy(userFeedback.status);
    const stats = { total: 0, pending: 0, approved: 0, rejected: 0, closed: 0, public: 0 };
    for (const item of grouped) {
      const n = Number(item.total ?? 0);
      stats.total += n;
      if (item.status === 'PENDING') stats.pending = n;
      else if (item.status === 'APPROVED') stats.approved = n;
      else if (item.status === 'REJECTED') stats.rejected = n;
      else if (item.status === 'CLOSED') stats.closed = n;
    }
    const publicCount = await db.select({ total: count() }).from(userFeedback)
      .where(and(eq(userFeedback.status, 'APPROVED'), eq(userFeedback.showOnHomepage, 1)));
    stats.public = Number(publicCount[0]?.total ?? 0);
    return { success: true, data: { items: rows, stats } };
  });

  const review = async (req: FastifyRequest, reply: FastifyReply, action: 'APPROVED' | 'REJECTED' | 'CLOSED') => {
    if (!isSuperAdmin(req) || !req.user) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const params = req.params as Record<string, unknown>;
    const parsedId = idSchema.safeParse(params.id);
    const parsedBody = action === 'REJECTED' ? reviewSchema.safeParse(req.body ?? {}) : reviewSchema.safeParse(req.body ?? {});
    if (!parsedId.success || !parsedBody.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'اطلاعات بررسی نظر معتبر نیست.');
    const current = await getDb().select({ id: userFeedback.id }).from(userFeedback)
      .where(eq(userFeedback.id, parsedId.data)).limit(1);
    if (!current.length) return sendError(reply, 404, 'FEEDBACK_NOT_FOUND', 'نظر پیدا نشد.');
    await getDb().update(userFeedback).set({
      status: action,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      reviewNote: parsedBody.data.note || null,
      updatedAt: new Date(),
    }).where(eq(userFeedback.id, parsedId.data));
    return { success: true, data: { id: parsedId.data, status: action } };
  };

  app.post('/feedback/admin/:id/approve', { preHandler: [app.requireAuth] }, (req, reply) => review(req, reply, 'APPROVED'));
  app.post('/feedback/admin/:id/reject', { preHandler: [app.requireAuth] }, (req, reply) => review(req, reply, 'REJECTED'));
  app.post('/feedback/admin/:id/hide', { preHandler: [app.requireAuth] }, (req, reply) => review(req, reply, 'CLOSED'));
}
