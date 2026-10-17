import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { normalizeButtonTargetValue } from '../../core/button-target.js';
import {
  createPost, publishNow, schedulePost, updateScheduledPost, listPosts, getPost, cancelPost, retryTarget,
  ActorMeta, PostState,
} from './post.service.js';

function actor(req: { user?: { id: string; role: string }; ip?: string }): ActorMeta & { tenantId: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { tenantId: req.user.id, actorId: req.user.id, actorRole: req.user.role, ip: req.ip };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

const buttonUrlSchema = z.string().trim().min(1).max(255).transform((value, ctx) => {
  try {
    return normalizeButtonTargetValue('URL', value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'آدرس دکمه باید یک لینک معتبر http یا https باشد.' });
    return z.NEVER;
  }
});

const buttonIdSchema = (type: 'TELEGRAM_ID' | 'BALE_ID' | 'RUBIKA_ID') => z.string().trim().min(1).max(190).transform((value, ctx) => {
  try {
    return normalizeButtonTargetValue(type, value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'شناسهٔ واردشده معتبر نیست.' });
    return z.NEVER;
  }
});

const buttonPhoneSchema = z.string().trim().min(1).max(32).transform((value, ctx) => {
  try {
    return normalizeButtonTargetValue('PHONE', value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'شمارهٔ تلفن واردشده معتبر نیست.' });
    return z.NEVER;
  }
});

const buttonLegacyUsernameSchema = z.string().trim().regex(/^@?[A-Za-z0-9_\u200c\u0600-\u06ff.]{2,190}$/);

const buttonTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), value: buttonUrlSchema }),
  z.object({ type: z.literal('PHONE'), value: buttonPhoneSchema }),
  z.object({ type: z.literal('TELEGRAM_ID'), value: buttonIdSchema('TELEGRAM_ID') }),
  z.object({ type: z.literal('BALE_ID'), value: buttonIdSchema('BALE_ID') }),
  z.object({ type: z.literal('RUBIKA_ID'), value: buttonIdSchema('RUBIKA_ID') }),
  // Legacy rows remain accepted and are normalized by the delivery worker.
  z.object({ type: z.literal('USERNAME'), value: buttonLegacyUsernameSchema }),
]);

const buttonItemSchema = z.object({
  label: z.string().min(1).max(64),
  target: buttonTargetSchema.optional(),
  url: buttonUrlSchema.optional(),
  callback: z.string().max(64).optional(),
});

const buttonsSchema = z.object({
  byChannel: z.record(
    z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/),
    z.array(buttonItemSchema).max(8),
  ).optional().refine((value) => !value || Object.keys(value).length <= 20, { message: 'حداکثر ۲۰ کانال مجاز است.' }),
  footerByChannel: z.record(
    z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/),
    z.string().trim().max(500),
  ).optional().refine((value) => !value || Object.keys(value).length <= 20, { message: 'حداکثر ۲۰ کانال مجاز است.' }),
  byPlatform: z
    .object({
      telegram: z.array(buttonItemSchema).max(8).optional(),
      bale: z.array(buttonItemSchema).max(8).optional(),
      rubika: z.array(buttonItemSchema).max(8).optional(),
    })
    .optional(),
  // Legacy shapes remain accepted so existing drafts/posts are not broken.
  inline: z.array(buttonItemSchema).max(8).optional(),
  links: z
    .array(z.object({ label: z.string().min(1).max(64), url: buttonUrlSchema }))
    .max(8)
    .optional(),
});

const createPostSchema = z.object({
  title: z.string().max(190).optional(),
  body: z.string().max(4000).optional(),
  parseMode: z.enum(['NONE', 'HTML', 'MARKDOWN']).optional(),
  mediaId: z.string().min(10).max(26).optional(),
  mediaIds: z.array(z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/)).max(10).optional(),
  buttons: buttonsSchema.optional(),
});

const publishSchema = z.object({ channelIds: z.array(z.string().min(10).max(26)).min(1).max(20) });

const scheduleSchema = publishSchema.extend({
  scheduledAt: z.coerce.date(),
});

const updateScheduledPostSchema = z.object({
  title: z.string().max(190).nullable().optional(),
  body: z.string().max(4000),
  parseMode: z.enum(['NONE', 'HTML', 'MARKDOWN']).optional(),
  mediaId: z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/).nullable(),
  mediaIds: z.array(z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/)).max(10).optional(),
  buttons: buttonsSchema.nullable(),
  channelIds: z.array(z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/)).min(1).max(20),
  scheduledAt: z.coerce.date(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  state: z
    .enum(['DRAFT', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  search: z.string().max(100).optional(),
  channelId: z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/).optional(),
});

export async function registerPostRoutes(app: FastifyInstance): Promise<void> {
  // Public phone bridge for providers whose inline URL contract only permits
  // HTTP(S). It validates the canonical phone representation and redirects
  // only to the tel: URI chosen by the user.
  app.get('/public/phone/:number', async (req, reply) => {
    const number = (req.params as { number?: unknown }).number;
    if (typeof number !== 'string') throw new AppError(ERR.NOT_FOUND('لینک'));
    let phone: string;
    try {
      phone = normalizeButtonTargetValue('PHONE', decodeURIComponent(number));
    } catch {
      throw new AppError(ERR.NOT_FOUND('لینک'));
    }
    void reply.code(302);
    void reply.header('location', `tel:${phone}`);
    void reply.header('cache-control', 'no-store');
    void reply.header('referrer-policy', 'no-referrer');
    return reply.send();
  });

  app.post('/posts', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const input = parse(createPostSchema, req.body);
    const post = await createPost(tenantId, input, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/:id/publish', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(publishSchema, req.body);
    const post = await publishNow(tenantId, id, input.channelIds, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/:id/schedule', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(scheduleSchema, req.body);
    const post = await schedulePost(tenantId, id, input.channelIds, input.scheduledAt, meta);
    return { success: true, data: { post } };
  });

  app.put('/posts/:id/schedule', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(updateScheduledPostSchema, req.body);
    const post = await updateScheduledPost(tenantId, id, input, meta);
    return { success: true, data: { post } };
  });

  app.get('/posts', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const query = parse(listQuerySchema, req.query);
    const result = await listPosts(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      state: query.state as PostState | undefined,
      search: query.search,
      channelId: query.channelId,
    });
    return { success: true, data: result };
  });

  app.get('/posts/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const { id } = req.params as { id: string };
    const result = await getPost(tenantId, id);
    return { success: true, data: result };
  });

  app.post('/posts/:id/cancel', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const post = await cancelPost(tenantId, id, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/targets/:targetId/retry', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { targetId } = req.params as { targetId: string };
    const result = await retryTarget(tenantId, targetId, meta);
    return { success: true, data: result };
  });
}
