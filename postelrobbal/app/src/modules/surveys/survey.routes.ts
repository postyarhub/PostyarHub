import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { surveys, surveyOptions, surveyVotes, surveyEvents, users } from '../../db/schema.js';
import { notifyTenant } from '../notifications/delivery.js';

const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, 'شناسه نظرسنجی معتبر نیست.');
const createSchema = z.object({
  question: z.string().trim().min(8).max(200),
  description: z.string().trim().max(500).optional().default(''),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(8),
}).superRefine((value, context) => {
  const normalized = value.options.map((item) => item.toLocaleLowerCase('fa-IR'));
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'گزینه‌های تکراری مجاز نیستند.' });
  }
});
const voteSchema = z.object({ optionId: idSchema });
const reviewSchema = z.object({ note: z.string().trim().max(500).optional().default('') });

type SurveyRow = typeof surveys.$inferSelect;
type OptionRow = typeof surveyOptions.$inferSelect;

function newId(): string {
  return ulid();
}
function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ success: false, error: { code, message } });
}
function visitorToken(req: FastifyRequest, reply: FastifyReply): string {
  let token = req.cookies?.py_survey_v1;
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    token = randomBytes(32).toString('base64url');
    reply.setCookie('py_survey_v1', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return token;
}
function visitorHash(req: FastifyRequest, reply: FastifyReply): string {
  return createHash('sha256').update(visitorToken(req, reply)).digest('hex');
}
function isSuperAdmin(req: FastifyRequest): boolean {
  return req.user?.role === 'SUPER_ADMIN';
}

async function withOptions(rows: SurveyRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const options = await getDb().select().from(surveyOptions)
    .where(inArray(surveyOptions.surveyId, ids))
    .orderBy(asc(surveyOptions.sortOrder), asc(surveyOptions.createdAt));
  const grouped = new Map<string, OptionRow[]>();
  for (const option of options) {
    const bucket = grouped.get(option.surveyId) ?? [];
    bucket.push(option);
    grouped.set(option.surveyId, bucket);
  }
  return rows.map((row) => ({ ...row, options: grouped.get(row.id) ?? [] }));
}

async function featuredSurvey(voter: string | null) {
  const rows = await getDb().select().from(surveys)
    .where(and(eq(surveys.status, 'APPROVED'), eq(surveys.isFeatured, 1)))
    .orderBy(desc(surveys.createdAt)).limit(1);
  const survey = rows[0];
  if (!survey) return null;
  const options = await getDb().select({
    id: surveyOptions.id,
    label: surveyOptions.label,
    sortOrder: surveyOptions.sortOrder,
    voteCount: count(surveyVotes.id),
  }).from(surveyOptions)
    .leftJoin(surveyVotes, eq(surveyVotes.optionId, surveyOptions.id))
    .where(eq(surveyOptions.surveyId, survey.id))
    .groupBy(surveyOptions.id, surveyOptions.label, surveyOptions.sortOrder)
    .orderBy(asc(surveyOptions.sortOrder));
  const normalizedOptions = options.map((item) => ({
    id: item.id,
    label: item.label,
    sortOrder: item.sortOrder,
    voteCount: Number(item.voteCount ?? 0),
  }));
  const totalVotes = normalizedOptions.reduce((total, item) => total + item.voteCount, 0);
  let hasVoted = false;
  if (voter) {
    const prior = await getDb().select({ id: surveyVotes.id }).from(surveyVotes)
      .where(and(eq(surveyVotes.surveyId, survey.id), eq(surveyVotes.voterHash, voter))).limit(1);
    hasVoted = prior.length > 0;
  }
  return {
    id: survey.id,
    question: survey.question,
    description: survey.description,
    createdAt: survey.createdAt,
    options: normalizedOptions,
    totalVotes,
    hasVoted,
  };
}

async function appendEvent(tx: any, surveyId: string, actorId: string | null, action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CLOSED', note: string | null = null) {
  await tx.insert(surveyEvents).values({ id: newId(), surveyId, actorId, action, note });
}

export async function registerSurveyRoutes(app: FastifyInstance): Promise<void> {
  // Public, read-only featured survey. The HttpOnly cookie is an opaque browser key; only its SHA-256 hash is stored with a vote.
  app.get('/surveys/featured', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const hash = visitorHash(req, reply);
    const survey = await featuredSurvey(hash);
    reply.header('Cache-Control', 'no-store, private');
    return { success: true, data: { survey } };
  });

  // Public, one vote per browser cookie and survey. Fastify's shared IP rate limiter adds a second, independent ceiling.
  app.post('/surveys/:id/vote', {
    config: { rateLimit: { max: 12, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const parsedId = idSchema.safeParse((req.params as Record<string, unknown>).id);
    const body = voteSchema.safeParse(req.body);
    if (!parsedId.success || !body.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'اطلاعات رأی معتبر نیست.');
    const rawToken = req.cookies?.py_survey_v1;
    if (!rawToken || !/^[A-Za-z0-9_-]{40,60}$/.test(rawToken)) {
      return sendError(reply, 400, 'SURVEY_VISITOR_REQUIRED', 'صفحه را تازه‌سازی کنید و دوباره رأی دهید.');
    }
    const id = parsedId.data;
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const db = getDb();
    const current = await db.select({ id: surveys.id }).from(surveys)
      .where(and(eq(surveys.id, id), eq(surveys.status, 'APPROVED'), eq(surveys.isFeatured, 1))).limit(1);
    if (!current.length) return sendError(reply, 404, 'SURVEY_NOT_FOUND', 'این نظرسنجی دیگر فعال نیست.');
    const option = await db.select({ id: surveyOptions.id }).from(surveyOptions)
      .where(and(eq(surveyOptions.id, body.data.optionId), eq(surveyOptions.surveyId, id))).limit(1);
    if (!option.length) return sendError(reply, 400, 'SURVEY_OPTION_INVALID', 'گزینه انتخاب‌شده معتبر نیست.');
    const prior = await db.select({ id: surveyVotes.id }).from(surveyVotes)
      .where(and(eq(surveyVotes.surveyId, id), eq(surveyVotes.voterHash, hash))).limit(1);
    if (prior.length) return sendError(reply, 409, 'SURVEY_ALREADY_VOTED', 'برای این نظرسنجی قبلاً رأی ثبت شده است.');
    try {
      await db.insert(surveyVotes).values({ id: newId(), surveyId: id, optionId: body.data.optionId, voterHash: hash });
    } catch (error) {
      const candidate = error as { code?: string; errno?: number };
      if (candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062) {
        return sendError(reply, 409, 'SURVEY_ALREADY_VOTED', 'برای این نظرسنجی قبلاً رأی ثبت شده است.');
      }
      throw error;
    }
    return { success: true, data: { survey: await featuredSurvey(hash) } };
  });

  // Signed-in users can submit a survey proposal; publication is impossible until a SUPER_ADMIN approves it.
  app.get('/surveys/mine', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!req.user) return sendError(reply, 401, 'AUTH_REQUIRED', 'برای مشاهدهٔ نظرسنجی‌ها وارد حساب شوید.');
    const rows = await getDb().select().from(surveys).where(eq(surveys.creatorId, req.user.id))
      .orderBy(desc(surveys.createdAt)).limit(50);
    return { success: true, data: { items: await withOptions(rows) } };
  });

  app.post('/surveys', { preHandler: [app.requireAuth], config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!req.user) return sendError(reply, 401, 'AUTH_REQUIRED', 'برای ثبت نظرسنجی وارد حساب شوید.');
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'سؤال باید حداقل ۸ نویسه و تعداد گزینه‌ها بین ۲ تا ۸ باشد؛ متن گزینه‌ها نیز باید یکتا باشد.');
    const db = getDb();
    const id = newId();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const outcome = await db.transaction(async (tx) => {
      // Serialize quota-sensitive submissions per user. Counting before the
      // transaction allowed parallel requests to exceed both moderation and
      // daily limits while every request saw the same old counts.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, req.user!.id)).limit(1).for('update');

      const pendingCount = await tx.select({ total: count() }).from(surveys)
        .where(and(eq(surveys.creatorId, req.user!.id), eq(surveys.status, 'PENDING')));
      if (Number(pendingCount[0]?.total ?? 0) >= 5) return { error: 'pending' as const };

      const recent = await tx.select({ total: count() }).from(surveys)
        .where(and(eq(surveys.creatorId, req.user!.id), gte(surveys.createdAt, cutoff)));
      if (Number(recent[0]?.total ?? 0) >= 3) return { error: 'daily' as const };

      await tx.insert(surveys).values({
        id,
        creatorId: req.user!.id,
        question: parsed.data.question,
        description: parsed.data.description || null,
        status: 'PENDING',
        isFeatured: 0,
      });
      for (const [index, label] of parsed.data.options.entries()) {
        await tx.insert(surveyOptions).values({ id: newId(), surveyId: id, label, sortOrder: index });
      }
      await appendEvent(tx, id, req.user!.id, 'SUBMITTED');
      return { id } as const;
    });
    if ('error' in outcome) {
      if (outcome.error === 'pending') {
        return sendError(reply, 429, 'SURVEY_PENDING_LIMIT', 'حداکثر ۵ نظرسنجی در انتظار بررسی مجاز است.');
      }
      return sendError(reply, 429, 'SURVEY_DAILY_LIMIT', 'حداکثر ۳ نظرسنجی در هر ۲۴ ساعت مجاز است.');
    }
    const created = await db.select().from(surveys).where(eq(surveys.id, outcome.id)).limit(1);
    return { success: true, data: { survey: (await withOptions(created))[0] } };
  });

  // These routes require the actual top-level administrator role, not merely an authenticated session.
  app.get('/surveys/admin', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!isSuperAdmin(req)) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const rows = await getDb().select().from(surveys).orderBy(desc(surveys.createdAt)).limit(100);
    return { success: true, data: { items: await withOptions(rows) } };
  });

  app.post('/surveys/admin/:id/approve', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!isSuperAdmin(req) || !req.user) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const parsedId = idSchema.safeParse((req.params as Record<string, unknown>).id);
    if (!parsedId.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'شناسه نظرسنجی معتبر نیست.');
    const id = parsedId.data;
    const db = getDb();
    const current = await db.select({
      id: surveys.id,
      status: surveys.status,
      creatorId: surveys.creatorId,
      question: surveys.question,
    }).from(surveys).where(eq(surveys.id, id)).limit(1);
    const currentSurvey = current[0];
    if (!currentSurvey) return sendError(reply, 404, 'SURVEY_NOT_FOUND', 'نظرسنجی پیدا نشد.');
    if (currentSurvey.status === 'CLOSED') return sendError(reply, 409, 'SURVEY_CLOSED', 'نظرسنجی بسته‌شده دوباره منتشر نمی‌شود.');
    if (currentSurvey.status === 'REJECTED') return sendError(reply, 409, 'SURVEY_ALREADY_REJECTED', 'نظرسنجی ردشده مستقیماً قابل تأیید نیست.');
    if (currentSurvey.status === 'PENDING') {
      await db.transaction(async (tx) => {
        // Lock the selected row and verify its state before changing the
        // featured survey, preventing concurrent approve/reject races.
        const locked = await tx.select({ id: surveys.id, status: surveys.status })
          .from(surveys).where(eq(surveys.id, id)).limit(1).for('update');
        if (!locked[0] || locked[0].status !== 'PENDING') {
          throw new Error('SURVEY_REVIEW_STATE_CHANGED');
        }
        await tx.update(surveys).set({ isFeatured: 0 }).where(eq(surveys.isFeatured, 1));
        await tx.update(surveys).set({ status: 'APPROVED', isFeatured: 1, reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: null })
          .where(and(eq(surveys.id, id), eq(surveys.status, 'PENDING')));
        await appendEvent(tx, id, req.user!.id, 'APPROVED');
      });
    }
    // Retry the idempotent insert even if the survey was approved earlier:
    // a transient notification DB failure must not permanently lose the notice.
    await notifyTenant({
      tenantId: currentSurvey.creatorId,
      kind: 'SURVEY_APPROVED',
      subjectId: id,
      titleFa: 'نظرسنجی شما تأیید شد',
      bodyFa: `نظرسنجی «${currentSurvey.question}» تأیید شد و در بخش نظرسنجی برجستهٔ پُست‌یار نمایش داده می‌شود.`,
    }).catch((error: unknown) => {
      req.log.warn({ surveyId: id, errorName: error instanceof Error ? error.name : 'Error' }, 'survey_approval_notification_failed');
    });
    return { success: true, data: { approved: true, featuredSurveyId: id } };
  });

  app.post('/surveys/admin/:id/reject', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!isSuperAdmin(req) || !req.user) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const parsedId = idSchema.safeParse((req.params as Record<string, unknown>).id);
    const body = reviewSchema.safeParse(req.body ?? {});
    if (!parsedId.success || !body.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'اطلاعات رد نظرسنجی معتبر نیست.');
    const id = parsedId.data;
    const current = await getDb().select({
      id: surveys.id,
      status: surveys.status,
      creatorId: surveys.creatorId,
      question: surveys.question,
      reviewNote: surveys.reviewNote,
    }).from(surveys).where(eq(surveys.id, id)).limit(1);
    const currentSurvey = current[0];
    if (!currentSurvey) return sendError(reply, 404, 'SURVEY_NOT_FOUND', 'نظرسنجی پیدا نشد.');
    if (currentSurvey.status === 'CLOSED') return sendError(reply, 409, 'SURVEY_CLOSED', 'نظرسنجی بسته‌شده قابل رد نیست.');
    if (currentSurvey.status === 'APPROVED') return sendError(reply, 409, 'SURVEY_ALREADY_APPROVED', 'نظرسنجی تأییدشده را نمی‌توان رد کرد؛ ابتدا وضعیت نمایش آن را مدیریت کنید.');
    if (currentSurvey.status === 'PENDING') {
      await getDb().transaction(async (tx) => {
        const locked = await tx.select({ id: surveys.id, status: surveys.status })
          .from(surveys).where(eq(surveys.id, id)).limit(1).for('update');
        if (!locked[0] || locked[0].status !== 'PENDING') {
          throw new Error('SURVEY_REVIEW_STATE_CHANGED');
        }
        await tx.update(surveys).set({ status: 'REJECTED', isFeatured: 0, reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: body.data.note || null })
          .where(and(eq(surveys.id, id), eq(surveys.status, 'PENDING')));
        await appendEvent(tx, id, req.user!.id, 'REJECTED', body.data.note || null);
      });
    }
    // If the first insert failed transiently, a repeated rejection request can
    // still complete the notification. The unique notification key prevents
    // sending the same result more than once.
    const note = body.data.note?.trim() || currentSurvey.reviewNote?.trim() || '';
    await notifyTenant({
      tenantId: currentSurvey.creatorId,
      kind: 'SURVEY_REJECTED',
      subjectId: id,
      titleFa: 'نظرسنجی شما رد شد',
      bodyFa: note
        ? `نظرسنجی «${currentSurvey.question}» تأیید نشد. دلیل ثبت‌شده: ${note}`
        : `نظرسنجی «${currentSurvey.question}» تأیید نشد و در صفحهٔ اصلی نمایش داده نمی‌شود.`,
    }).catch((error: unknown) => {
      req.log.warn({ surveyId: id, errorName: error instanceof Error ? error.name : 'Error' }, 'survey_rejection_notification_failed');
    });
    return { success: true, data: { rejected: true } };
  });

  app.post('/surveys/admin/:id/close', { preHandler: [app.requireAuth] }, async (req, reply) => {
    if (!isSuperAdmin(req) || !req.user) return sendError(reply, 403, 'FORBIDDEN', 'دسترسی مدیر ارشد لازم است.');
    const parsedId = idSchema.safeParse((req.params as Record<string, unknown>).id);
    if (!parsedId.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'شناسه نظرسنجی معتبر نیست.');
    const id = parsedId.data;
    const current = await getDb().select({
      id: surveys.id,
      status: surveys.status,
      creatorId: surveys.creatorId,
      question: surveys.question,
    }).from(surveys).where(eq(surveys.id, id)).limit(1);
    const currentSurvey = current[0];
    if (!currentSurvey) return sendError(reply, 404, 'SURVEY_NOT_FOUND', 'نظرسنجی پیدا نشد.');
    if (currentSurvey.status !== 'APPROVED' && currentSurvey.status !== 'CLOSED') return sendError(reply, 409, 'SURVEY_NOT_APPROVED', 'فقط نظرسنجی تأییدشده قابل توقف است.');
    if (currentSurvey.status === 'APPROVED') {
      await getDb().transaction(async (tx) => {
        const locked = await tx.select({ id: surveys.id, status: surveys.status })
          .from(surveys).where(eq(surveys.id, id)).limit(1).for('update');
        if (!locked[0] || locked[0].status !== 'APPROVED') {
          throw new Error('SURVEY_REVIEW_STATE_CHANGED');
        }
        await tx.update(surveys).set({ status: 'CLOSED', isFeatured: 0, reviewedBy: req.user!.id, reviewedAt: new Date() })
          .where(and(eq(surveys.id, id), eq(surveys.status, 'APPROVED')));
        await appendEvent(tx, id, req.user!.id, 'CLOSED');
      });
    }
    await notifyTenant({
      tenantId: currentSurvey.creatorId,
      kind: 'SURVEY_CLOSED',
      subjectId: id,
      titleFa: 'نمایش نظرسنجی شما متوقف شد',
      bodyFa: `نمایش نظرسنجی «${currentSurvey.question}» از صفحهٔ اصلی پُست‌یار متوقف شد.`,
    }).catch((error: unknown) => {
      req.log.warn({ surveyId: id, errorName: error instanceof Error ? error.name : 'Error' }, 'survey_close_notification_failed');
    });
    return { success: true, data: { closed: true } };
  });
}
