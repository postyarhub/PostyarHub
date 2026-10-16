import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { Permission } from '../../security/permissions.js';
import { audit } from '../../core/audit.js';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

import {
  getOverview,
  listUsers,
  getUserProfile360,
  setUserSuspended,
  grantSubscription,
  listAdminPayments,
  approvePayment,
  rejectPayment,
  listAuditLogs,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getSettings,
  putSettings,
  getPaymentState,
  broadcast,
  getBroadcastTargets,
  type BroadcastTarget,
  releaseChannel,
  listChannels,
  listBots,
  type AdminPlatform,
} from './admin.service.js';
import { getAdminBellSnapshot, markAdminBellSeen } from './admin-bell.service.js';
import {
  adminListTickets,
  adminGetTicket,
  adminAddTicketMessage,
  adminCloseTicket,
  adminCreateTicket,
  getTicketCategories,
  putTicketCategories,
  listSupportTeam,
  createSupporter,
  setSupporterRole,
} from '../support/support.service.js';
import { uploadMedia } from '../media/media.service.js';
import {
  getPaymentSettings,
  putPaymentSettings,
  PAYMENT_SETTING_KEYS,
  type PaymentSettingsPatch,
  type GatewayPatch,
} from '../payments/payment-settings.service.js';
import {
  getSmsSettings,
  putSmsSettings,
  getEmailSettings,
  putEmailSettings,
  sendTestEmail,
  getGeneralSettings,
  putGeneralSettings,
  getAiSettings,
  putAiSettings,
  upsertAiProvider,
  deleteAiProvider,
  getReferralSettings,
  putReferralSettings,
  getSecuritySettings,
  putSecuritySettings,
  getGoldSettings,
  putGoldSettings,
} from './system-settings.service.js';

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function auth(req: FastifyRequest): { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

function paramId(req: FastifyRequest): string {
  const { id } = req.params as { id: string };
  return id;
}

function paging(query: Record<string, string | undefined>): { page: number; pageSize: number } {
  const page = Number.parseInt(query.page ?? '1', 10) || 1;
  const pageSize = Number.parseInt(query.pageSize ?? '20', 10) || 20;
  return { page, pageSize };
}

function platformQuery(value: string | undefined): AdminPlatform | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'telegram' || value === 'bale' || value === 'rubika') return value;
  throw new AppError(ERR.VALIDATION('مقدار انتخابی معتبر نیست.'));
}

const grantSchema = z.object({
  planCode: z.string().min(1).max(40),
  months: z.coerce.number().int().min(1).max(12),
});
const planPatchSchema = z.object({
  nameFa: z.string().min(1).max(80).optional(),
  priceRial: z.coerce.number().int().min(0).optional(),
  periodDays: z.coerce.number().int().min(1).max(3650).optional(),
  isActive: z.boolean().optional(),
  limitsJson: z.record(z.unknown()).optional(),
  featuresJson: z.record(z.unknown()).optional(),
  pricingJson: z.record(z.unknown()).optional(),
});
const planCreateSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/),
  nameFa: z.string().min(2).max(80),
  priceRial: z.coerce.number().int().min(0),
  periodDays: z.coerce.number().int().min(1).max(3650).default(30),
  limitsJson: z.record(z.unknown()).optional(),
  featuresJson: z.record(z.unknown()).optional(),
  pricingJson: z.record(z.unknown()).optional(),
});
const settingsSchema = z
  .record(z.unknown())
  .refine((r) => Object.keys(r).length > 0, { message: 'بدنهٔ تنظیمات خالی است.' });

// Payment gateway settings (contract 14-contract item 2). cardToCardCards is
// validated strictly: 0..5 cards, cardNumber 16..24 digits, non-empty names.
const paymentCardSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  bankName: z.string().min(1).max(80),
  cardNumber: z.string().regex(/^\d{16,24}$/),
  holderName: z.string().min(1).max(80),
});

// Per-provider gateway credentials (admin-panel v2). Strict: numbers never
// coerce to strings; unknown keys/providers are rejected.
const gatewaysPatchSchema = z
  .object({
    zibal: z
      .object({ merchantId: z.string().max(128).optional(), sandbox: z.boolean().optional() })
      .strict()
      .optional(),
    zarinpal: z
      .object({ merchantId: z.string().max(128).optional(), sandbox: z.boolean().optional() })
      .strict()
      .optional(),
    idpay: z
      .object({ apiKey: z.string().max(128).optional(), sandbox: z.boolean().optional() })
      .strict()
      .optional(),
    winapay: z
      .object({ merchantId: z.string().max(128).optional() })
      .strict()
      .optional(),
  })
  .strict();

// Dedicated payment-settings PUT body (new admin UI contract).
const paymentSettingsPutSchema = z
  .object({
    onlineEnabled: z.boolean().optional(),
    cardToCardEnabled: z.boolean().optional(),
    provider: z.enum(['zibal', 'zarinpal', 'idpay', 'winapay']).optional(),
    gateways: gatewaysPatchSchema.optional(),
    cards: paymentCardSchema.array().min(0).max(5).optional(),
  })
  .strict();
const approvePaymentSchema = z.object({
  note: z.string().min(1).max(500).optional(),
});
const rejectPaymentSchema = z.object({
  reason: z.string().min(3).max(500),
});
const broadcastSchema = z.object({
  titleFa: z.string().min(2).max(190),
  bodyFa: z.string().min(2).max(5000),
  // Round 19: recipient targeting. Default (absent) = ALL, so the original
  // single-audience clients keep working.
  target: z
    .union([
      z.object({ kind: z.literal('ALL') }).strict(),
      z.object({ kind: z.literal('ROLE'), role: z.enum(['USER', 'SUPPORT', 'SUPER_ADMIN']) }).strict(),
      z.object({ kind: z.literal('PLAN'), planId: z.string().min(1).max(26) }).strict(),
      z.object({ kind: z.literal('USERS'), userIds: z.array(z.string().min(1).max(26)).min(1).max(500) }).strict(),
    ])
    .optional(),
});
const releaseSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  channelRef: z.string().min(1).max(190),
});

// ---- sms / email settings (system-settings.service) ----
const smsirConfigSchema = z
  .object({ apiKey: z.string().max(128).optional(), line: z.string().max(128).optional(), otpTemplateId: z.string().max(20).optional() })
  .strict();
const melipayamakConfigSchema = z
  .object({ username: z.string().max(128).optional(), password: z.string().max(128).optional(), from: z.string().max(128).optional() })
  .strict();
const kavenegarConfigSchema = z
  .object({ apiKey: z.string().max(128).optional(), from: z.string().max(128).optional() })
  .strict();
const ghasedakConfigSchema = z
  .object({ apiKey: z.string().max(128).optional(), line: z.string().max(128).optional() })
  .strict();
const smsPutSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.enum(['smsir', 'melipayamak', 'kavenegar', 'ghasedak']).optional(),
    configs: z
      .object({
        smsir: smsirConfigSchema.optional(),
        melipayamak: melipayamakConfigSchema.optional(),
        kavenegar: kavenegarConfigSchema.optional(),
        ghasedak: ghasedakConfigSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const emailPutSchema = z
  .object({
    enabled: z.boolean().optional(),
    host: z.string().max(190).optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    user: z.string().max(190).optional(),
    pass: z.string().max(190).optional(),
    fromName: z.string().max(80).optional(),
    fromEmail: z
      .string()
      .max(190)
      .refine((v) => v === '' || v.includes('@'), { message: 'ایمیل معتبر نیست.' })
      .optional(),
  })
  .strict();
const emailTestSchema = z.object({
  to: z.string().min(3).max(190).email(),
});

// ---- general / ai / referral / security settings (round 17, form-shaped) ----
const generalPutSchema = z
  .object({
    siteNameFa: z.string().min(1).max(60).optional(),
    siteTaglineFa: z.string().max(120).optional(),
    supportEmail: z
      .string()
      .max(190)
      .refine((v) => v === '' || v.includes('@'), { message: 'ایمیل معتبر نیست.' })
      .optional(),
    supportPhone: z.string().max(20).optional(),
    supportTelegramUrl: z
      .string()
      .max(190)
      .refine((v) => v === '' || v.startsWith('https://'), {
        message: 'آدرس تلگرام باید با https:// شروع شود.',
      })
      .optional(),
    supportBaleUrl: z
      .string()
      .max(190)
      .refine((v) => v === '' || v.startsWith('https://'), {
        message: 'آدرس بله باید با https:// شروع شود.',
      })
      .optional(),
    termsNoteFa: z.string().max(300).optional(),
    maintenanceEnabled: z.boolean().optional(),
    maintenanceMessageFa: z.string().max(300).optional(),
  })
  .strict();
const aiPutSchema = z.object({ default_provider: z.string().min(2).max(40).optional() }).strict();
const aiProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).optional(),
  title: z.string().min(2).max(100),
  kind: z.enum(['openai-compatible', 'gemini', 'anthropic']),
  baseUrl: z.string().url().max(190).refine((v) => v.startsWith('https://'), { message: 'آدرس سرویس‌دهنده باید با https:// شروع شود.' }),
  models: z.array(z.string().regex(/^\S{1,120}$/)).min(1).max(100),
  selectedModel: z.string().regex(/^\S{1,120}$/),
  apiKey: z.string().max(190).optional(),
}).strict();
const referralPutSchema = z
  .object({
    registerRewardPoints: z.number().int().min(0).max(100000).optional(),
    enabled: z.boolean().optional(),
    firstPurchasePercent: z.number().int().min(0).max(50).optional(),
  })
  .strict();
const securityPutSchema = z
  .object({
    registrationEnabled: z.boolean().optional(),
    captchaEnabled: z.boolean().optional(),
  })
  .strict();
// Gold ticker bot defaults (round 18) — admin PUT validates the https://
// scheme only; the full SSRF check stays on the user-side save paths.
const goldPutSchema = z
  .object({
    defaultSourceUrl: z
      .string()
      .max(190)
      .refine((v) => v === '' || v.startsWith('https://'), {
        message: 'آدرس منبع پیش‌فرض باید با https:// شروع شود.',
      })
      .optional(),
    defaultFrequencyMinutes: z.number().int().min(15).max(1440).optional(),
    defaultTemplateFa: z.string().max(2000).optional(),
  })
  .strict();

// ---- admin support tickets (round 18) ----
const adminTicketsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    state: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(),
    search: z.string().max(190).optional(),
  })
  .strict();
const adminTicketReplySchema = z
  .object({ body: z.string().min(1).max(5000) })
  .strict();
const adminTicketCreateSchema = z
  .object({
    tenantId: z.string().min(1).max(26),
    subject: z.string().min(3).max(190),
    category: z.string().min(1).max(80).optional(),
    body: z.string().min(1).max(5000),
  })
  .strict();
const categoriesPutSchema = z
  .object({ categories: z.array(z.object({ key: z.string(), labelFa: z.string() }).strict()).min(1).max(20) })
  .strict();
const supporterCreateSchema = z
  .object({
    firstName: z.string().min(2).max(80),
    lastName: z.string().min(2).max(80),
    email: z.string().min(3).max(190),
    mobile: z.string().min(4).max(20),
    password: z.string().min(8).max(128),
  })
  .strict();
const supporterRoleSchema = z
  .object({ role: z.enum(['SUPPORT', 'USER']) })
  .strict();

/**
 * Round 19 — shared multipart parser for the two admin ticket-writing routes:
 * text fields + one optional "file" (image/*|pdf ≤10MB, magic-byte re-checked
 * by uploadMedia). JSON bodies stay accepted for API-only callers.
 */
const ADMIN_TICKET_ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const ADMIN_TICKET_ATTACHMENT_MAX = 10 * 1024 * 1024;

async function parseTicketWriteBody(
  req: FastifyRequest
): Promise<{ fields: Record<string, string>; file?: { buffer: Buffer; mime: string; fileName: string } }> {
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; mime: string; fileName: string } | undefined;
  if (req.isMultipart()) {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (file) continue; // one attachment per message — defensive
        const mime = part.mimetype.toLowerCase();
        if (!ADMIN_TICKET_ATTACHMENT_MIME.has(mime)) {
          throw new AppError(ERR.VALIDATION('فرمت فایل مجاز نیست. تصویر (JPG، PNG، WebP، GIF) یا PDF ارسال کنید.'));
        }
        let buffer: Buffer;
        try {
          buffer = await part.toBuffer();
        } catch {
          throw new AppError(ERR.VALIDATION('حجم فایل بیش از حد مجاز است.'));
        }
        const fileName = (part.filename ?? 'file').trim().slice(0, 255) || 'file';
        file = { buffer, mime, fileName };
      } else if (part.type === 'field' && typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } else if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (typeof v === 'string') fields[k] = v;
    }
  }
  return { fields, file };
}

async function uploadTicketAttachment(
  tenantId: string,
  file: { buffer: Buffer; mime: string; fileName: string }
): Promise<{ mediaId: string; fileName: string; sizeBytes: number; mime: string }> {
  const uploaded = await uploadMedia(tenantId, {
    buffer: file.buffer,
    mimeType: file.mime,
    maxBytes: ADMIN_TICKET_ATTACHMENT_MAX,
  });
  return { mediaId: uploaded.id, fileName: file.fileName, sizeBytes: uploaded.sizeBytes, mime: uploaded.mime };
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Every admin route requires admin.access; sensitive groups declare a finer permission.
  const access = { preHandler: [app.requirePermission('admin.access')] };
  const usersRead = { preHandler: [app.requirePermission('admin.users.read')] };
  const paymentsRead = { preHandler: [app.requirePermission('admin.payments.read')] };
  const auditRead = { preHandler: [app.requirePermission('admin.audit.read')] };
  const platformRead = { preHandler: [app.requirePermission('admin.platform.read')] };
  const plansRead = { preHandler: [app.requirePermission('admin.plans.read')] };
  const usersManage = { preHandler: [app.requirePermission('admin.users.manage')] };
  const paymentsReview = { preHandler: [app.requirePermission('admin.payments.review')] };
  const plansManage = { preHandler: [app.requirePermission('admin.plans.manage')] };
  const settingsManage = { preHandler: [app.requirePermission('admin.settings.manage')] };

  app.get('/admin/overview', platformRead, async () => {
    const data = await getOverview();
    return { success: true, data };
  });

  // ---- admin bell (round 18, asovin «اعلان‌های سیستمی مدیر» parity) ----
  app.get('/admin/notifications/bell', access, async (req) => {
    const me = auth(req);
    const data = await getAdminBellSnapshot(me.id);
    if (me.role === 'SUPPORT') {
      // Support staff should see ticket activity only. Never include payment
      // amounts, payer email or new-user details in the support bell response.
      data.pendingPayments = { count: 0, unread: 0, latest: [] };
      data.pendingSurveys = { count: 0, unread: 0, latest: [] };
      data.newUsers = { count: 0, unread: 0, latest: [] };
      data.unreadTotal = data.openTickets.unread;
    }
    return { success: true, data };
  });

  app.post('/admin/notifications/bell/seen', access, async (req) => {
    // No audit: this is a high-frequency UI marker (opening the bell popup),
    // not a state change — an audit row per popup would flood audit_logs.
    const me = auth(req);
    const data = await markAdminBellSeen(me.id);
    return { success: true, data };
  });

  // ---- channels / bots (admin-panel v2 list endpoints) ----
  app.get('/admin/channels', platformRead, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const platform = platformQuery(q.platform);
    const data = await listChannels(q.search, platform, page, pageSize);
    return { success: true, data };
  });

  app.get('/admin/bots', platformRead, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const platform = platformQuery(q.platform);
    const data = await listBots(q.search, platform, page, pageSize);
    return { success: true, data };
  });

  // ---- users ----
  app.get('/admin/users', usersRead, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listUsers(q.search, page, pageSize);
    return { success: true, data };
  });

  // ---- user 360° profile (round 18, asovin «پروفایل ۳۶۰ درجه» parity) ----
  app.get('/admin/users/:id/profile360', usersRead, async (req) => {
    const data = await getUserProfile360(paramId(req));
    return { success: true, data };
  });

  // ---- admin support tickets (round 18; extended round 19) ----
  app.get('/admin/support/tickets', access, async (req) => {
    const input = parse(adminTicketsQuerySchema, req.query ?? {});
    const data = await adminListTickets({
      state: input.state,
      search: input.search,
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
    });
    return { success: true, data: { ...data, categories: await getTicketCategories() } };
  });

  // Round 19: staff-initiated ticket for a specific user (تیکت از سمت مدیر).
  app.post('/admin/support/tickets', access, async (req) => {
    const me = auth(req);
    const { fields, file } = await parseTicketWriteBody(req);
    const input = parse(adminTicketCreateSchema, {
      tenantId: fields.tenantId ?? '',
      subject: fields.subject ?? '',
      category: fields.category ?? 'GENERAL',
      body: fields.body ?? '',
    });
    const attachment = file ? await uploadTicketAttachment(input.tenantId, file) : undefined;
    const data = await adminCreateTicket(
      input.tenantId,
      { id: me.id, role: me.role as 'SUPER_ADMIN' | 'SUPPORT' },
      { subject: input.subject, category: input.category ?? 'GENERAL', body: input.body },
      attachment
    );
    await audit({ action: 'admin.ticket_created', actorId: me.id, actorRole: me.role, subjectType: 'ticket', subjectId: data.id, ip: req.ip, meta: { tenantId: input.tenantId } });
    return { success: true, data };
  });

  app.get('/admin/support/tickets/:id', access, async (req) => {
    const data = await adminGetTicket(paramId(req));
    return { success: true, data };
  });

  app.post('/admin/support/tickets/:id/messages', access, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    // Round 19: multipart with optional "file" — staff can attach receipts,
    // screenshots or documents to their reply (parity with the user path).
    const { fields, file } = await parseTicketWriteBody(req);
    const input = parse(adminTicketReplySchema, { body: fields.body ?? '' });
    const attachment = file ? await uploadTicketAttachment(me.id, file) : undefined;
    await adminAddTicketMessage(
      id,
      { id: me.id, role: me.role as 'SUPER_ADMIN' | 'SUPPORT' },
      input.body,
      attachment
    );
    await audit({ action: 'admin.ticket_reply', actorId: me.id, actorRole: me.role, subjectType: 'ticket', subjectId: id, ip: req.ip, meta: { hasAttachment: Boolean(attachment) } });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/support/tickets/:id/close', access, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await adminCloseTicket(id, { id: me.id, role: me.role as 'SUPER_ADMIN' | 'SUPPORT' });
    await audit({ action: 'admin.ticket_close', actorId: me.id, actorRole: me.role, subjectType: 'ticket', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  // ---- ticket categories manager (round 19) ----
  app.get('/admin/support/categories', access, async () => {
    const data = await getTicketCategories();
    return { success: true, data };
  });

  app.put('/admin/support/categories', usersManage, async (req) => {
    const me = auth(req);
    const input = parse(categoriesPutSchema, req.body);
    const data = await putTicketCategories(input.categories);
    await audit({ action: 'admin.ticket_categories_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { count: data.length } });
    return { success: true, data };
  });

  // ---- support team (پشتیبان‌ها, round 19) ----
  app.get('/admin/support/team', usersRead, async () => {
    const data = await listSupportTeam();
    return { success: true, data };
  });

  app.post('/admin/support/team', usersManage, async (req) => {
    const me = auth(req);
    const input = parse(supporterCreateSchema, req.body);
    const data = await createSupporter(input);
    await audit({ action: 'admin.supporter_created', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: data.id, ip: req.ip });
    return { success: true, data };
  });

  app.patch('/admin/support/team/:id', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(supporterRoleSchema, req.body);
    await setSupporterRole(id, input.role);
    await audit({ action: 'admin.supporter_role_changed', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip, meta: { role: input.role } });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/suspend', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, true);
    await audit({ action: 'admin.user_suspended', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/activate', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, false);
    await audit({ action: 'admin.user_activated', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  // Legacy-client safety: user deletion/editing is not an exposed admin capability.
  // Explicit deny routes ensure an old/stale UI can never accidentally delete or
  // mutate the immutable SUPER_ADMIN account.
  app.delete('/admin/users/:id', usersManage, async (req) => {
    const id = paramId(req);
    const db = getDb();
    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw new AppError(ERR.NOT_FOUND('کاربر'));
    if (target.role === 'SUPER_ADMIN') throw new AppError(ERR.CONFLICT('حذف مدیر ارشد مجاز نیست.'));
    throw new AppError(ERR.FORBIDDEN());
  });

  app.patch('/admin/users/:id', usersManage, async (req) => {
    const id = paramId(req);
    const db = getDb();
    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw new AppError(ERR.NOT_FOUND('کاربر'));
    if (target.role === 'SUPER_ADMIN') throw new AppError(ERR.CONFLICT('ویرایش مدیر ارشد مجاز نیست.'));
    throw new AppError(ERR.FORBIDDEN());
  });

  app.put('/admin/users/:id', usersManage, async (req) => {
    const id = paramId(req);
    const db = getDb();
    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw new AppError(ERR.NOT_FOUND('کاربر'));
    if (target.role === 'SUPER_ADMIN') throw new AppError(ERR.CONFLICT('ویرایش مدیر ارشد مجاز نیست.'));
    throw new AppError(ERR.FORBIDDEN());
  });

  app.post('/admin/users/:id/grant-subscription', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(grantSchema, req.body);
    const data = await grantSubscription(id, input.planCode, input.months);
    await audit({
      action: 'admin.grant_subscription',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'user',
      subjectId: id,
      ip: req.ip,
      meta: { planCode: input.planCode, months: input.months, subscriptionId: data.subscriptionId },
    });
    return { success: true, data };
  });

  // ---- payments ----
  app.get('/admin/payments', paymentsRead, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    // "status" per contract; legacy callers may still send "state".
    const data = await listAdminPayments(q.status ?? q.state, page, pageSize);
    return { success: true, data };
  });

  app.post('/admin/payments/:id/approve', paymentsReview, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(approvePaymentSchema, (req.body ?? {}) as unknown);
    const before = await getPaymentState(id);
    const data = await approvePayment(me.id, id, input.note);
    await audit({
      action: 'admin.payment_approved',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'payment',
      subjectId: id,
      ip: req.ip,
      meta: { previousState: before, note: input.note ?? null },
    });
    return { success: true, data };
  });

  app.post('/admin/payments/:id/reject', paymentsReview, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(rejectPaymentSchema, req.body);
    const before = await getPaymentState(id);
    const data = await rejectPayment(me.id, id, input.reason);
    await audit({
      action: 'admin.payment_rejected',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'payment',
      subjectId: id,
      ip: req.ip,
      meta: { previousState: before, reason: input.reason.slice(0, 200) },
    });
    return { success: true, data };
  });

  // ---- audit logs (admin.access) ----
  app.get('/admin/audit-logs', auditRead, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listAuditLogs(q.action, page, pageSize);
    return { success: true, data };
  });

  // ---- plans ----
  app.get('/admin/plans', plansRead, async () => {
    const data = await listPlans();
    return { success: true, data: { plans: data } };
  });

  app.post('/admin/plans', plansManage, async (req) => {
    const me = auth(req);
    const input = parse(planCreateSchema, req.body);
    const data = await createPlan(input);
    await audit({
      action: 'admin.plan_created',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'plan',
      subjectId: data.id,
      ip: req.ip,
      meta: { code: input.code },
    });
    return { success: true, data };
  });

  app.put('/admin/plans/:id', plansManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(planPatchSchema, req.body);
    await updatePlan(id, input);
    await audit({
      action: 'admin.plan_updated',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'plan',
      subjectId: id,
      ip: req.ip,
      meta: { fields: Object.keys(input) },
    });
    return { success: true, data: { ok: true } };
  });

  app.delete('/admin/plans/:id', plansManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await deletePlan(id);
    await audit({
      action: 'admin.plan_deleted',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'plan',
      subjectId: id,
      ip: req.ip,
    });
    return { success: true, data: { ok: true } };
  });

  // ---- system settings ----
  app.get('/admin/settings', settingsManage, async () => {
    const data = await getSettings();
    return { success: true, data };
  });

  app.put('/admin/settings', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(settingsSchema, req.body) as Record<string, unknown>;

    // Split payment-gateway keys from the generic object-valued settings.
    // Non-conforming payment payloads (e.g. the legacy admin page round-trips
    // every key as {}) are skipped harmlessly; conforming payloads validate
    // strictly via zod and persist.
    const paymentRaw: Record<string, unknown> = {};
    const generic: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if ((PAYMENT_SETTING_KEYS as readonly string[]).includes(k)) paymentRaw[k] = v;
      else generic[k] = v;
    }

    let updated = 0;
    const updatedKeys: string[] = [];
    if (Object.keys(paymentRaw).length > 0) {
      const patch = paymentRaw as {
        paymentOnlineEnabled?: unknown;
        paymentCardToCardEnabled?: unknown;
        paymentProvider?: unknown;
        paymentGateways?: unknown;
        cardToCardCards?: unknown;
      };
      const coerced: {
        paymentOnlineEnabled?: boolean;
        paymentCardToCardEnabled?: boolean;
        paymentProvider?: 'zibal' | 'zarinpal' | 'idpay' | 'winapay';
        paymentGateways?: GatewayPatch;
        cardToCardCards?: Array<{ id?: string; bankName: string; cardNumber: string; holderName: string }>;
      } = {};
      if (typeof patch.paymentOnlineEnabled === 'boolean') coerced.paymentOnlineEnabled = patch.paymentOnlineEnabled;
      if (typeof patch.paymentCardToCardEnabled === 'boolean') coerced.paymentCardToCardEnabled = patch.paymentCardToCardEnabled;
      if (patch.paymentProvider === 'zibal' || patch.paymentProvider === 'zarinpal' || patch.paymentProvider === 'idpay' || patch.paymentProvider === 'winapay') coerced.paymentProvider = patch.paymentProvider;
      if (
        patch.paymentGateways !== undefined &&
        typeof patch.paymentGateways === 'object' &&
        !Array.isArray(patch.paymentGateways)
      ) {
        coerced.paymentGateways = parse(gatewaysPatchSchema, patch.paymentGateways);
      }
      if (Array.isArray(patch.cardToCardCards)) coerced.cardToCardCards = parse(paymentCardSchema.array().min(0).max(5), patch.cardToCardCards);
      if (Object.keys(coerced).length > 0) {
        const keys = await putPaymentSettings(coerced);
        updated += keys.length;
        updatedKeys.push(...keys);
      }
    }
    if (Object.keys(generic).length > 0) {
      updated += await putSettings(generic);
      updatedKeys.push(...Object.keys(generic));
    }

    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys: updatedKeys },
    });
    return { success: true, data: { updated } };
  });

  // ---- dedicated payment-gateway settings (admin-panel v2) ----
  app.get('/admin/settings/payments', settingsManage, async () => {
    const data = await getPaymentSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/payments', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(paymentSettingsPutSchema, req.body);
    const patch: PaymentSettingsPatch = {};
    if (input.onlineEnabled !== undefined) patch.paymentOnlineEnabled = input.onlineEnabled;
    if (input.cardToCardEnabled !== undefined) patch.paymentCardToCardEnabled = input.cardToCardEnabled;
    if (input.provider !== undefined) patch.paymentProvider = input.provider;
    if (input.gateways !== undefined) patch.paymentGateways = input.gateways;
    if (input.cards !== undefined) patch.cardToCardCards = input.cards;
    const keys = await putPaymentSettings(patch);
    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys },
    });
    return { success: true, data: { updated: keys.length } };
  });

  // ---- sms settings (admin-panel v2) ----
  app.get('/admin/settings/sms', settingsManage, async () => {
    const data = await getSmsSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/sms', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(smsPutSchema, req.body);
    const keys = await putSmsSettings(input);
    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys },
    });
    return { success: true, data: { updated: keys.length } };
  });

  // ---- email (SMTP) settings (admin-panel v2) ----
  app.get('/admin/settings/email', settingsManage, async () => {
    const data = await getEmailSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/email', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(emailPutSchema, req.body);
    const keys = await putEmailSettings(input);
    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys },
    });
    return { success: true, data: { updated: keys.length } };
  });

  app.post('/admin/settings/email/test', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(emailTestSchema, req.body);
    const data = await sendTestEmail(me.id, input.to);
    return { success: true, data };
  });

  // ---- general settings (round 17): PUT is a partial patch → full snapshot ----
  app.get('/admin/settings/general', settingsManage, async () => {
    const data = await getGeneralSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/general', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(generalPutSchema, req.body);
    const keys = await putGeneralSettings(input);
    await audit({ action: 'admin.settings_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { keys } });
    const data = await getGeneralSettings();
    return { success: true, data };
  });

  // ---- ai settings (round 17): default provider ----
  app.get('/admin/settings/ai', settingsManage, async () => {
    const data = await getAiSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/ai', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(aiPutSchema, req.body);
    const keys = await putAiSettings(input);
    await audit({ action: 'admin.settings_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { keys } });
    const data = await getAiSettings();
    return { success: true, data };
  });

  app.post('/admin/settings/ai/providers', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(aiProviderSchema, req.body);
    const data = await upsertAiProvider(input);
    await audit({ action: 'admin.ai_provider_saved', actorId: me.id, actorRole: me.role, ip: req.ip, subjectType: 'ai_provider', subjectId: input.id ?? undefined });
    return { success: true, data };
  });

  app.delete('/admin/settings/ai/providers/:id', settingsManage, async (req) => {
    const me = auth(req);
    const id = String((req.params as { id: string }).id || '').trim().toLowerCase();
    const data = await deleteAiProvider(id);
    await audit({ action: 'admin.ai_provider_deleted', actorId: me.id, actorRole: me.role, ip: req.ip, subjectType: 'ai_provider', subjectId: id });
    return { success: true, data };
  });

  // ---- referral settings (round 17): register reward points ----
  app.get('/admin/settings/referral', settingsManage, async () => {
    const data = await getReferralSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/referral', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(referralPutSchema, req.body);
    const keys = await putReferralSettings(input);
    await audit({ action: 'admin.settings_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { keys } });
    const data = await getReferralSettings();
    return { success: true, data };
  });

  // ---- security settings (round 17): registration + captcha toggles ----
  app.get('/admin/settings/security', settingsManage, async () => {
    const data = await getSecuritySettings();
    return { success: true, data };
  });

  app.put('/admin/settings/security', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(securityPutSchema, req.body);
    const keys = await putSecuritySettings(input);
    await audit({ action: 'admin.settings_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { keys } });
    const data = await getSecuritySettings();
    return { success: true, data };
  });

  // ---- gold ticker defaults (round 18, asovin «تنظیمات ربات طلا» parity) ----
  app.get('/admin/settings/gold', settingsManage, async () => {
    const data = await getGoldSettings();
    return { success: true, data };
  });

  app.put('/admin/settings/gold', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(goldPutSchema, req.body);
    const keys = await putGoldSettings(input);
    await audit({ action: 'admin.settings_updated', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { keys } });
    const data = await getGoldSettings();
    return { success: true, data };
  });

  // ---- broadcast ----
  app.get('/admin/broadcast/targets', { preHandler: [app.requirePermission('admin.broadcast')] }, async () => {
    const data = await getBroadcastTargets();
    return { success: true, data };
  });

  app.post('/admin/broadcast', { preHandler: [app.requirePermission('admin.broadcast')] }, async (req) => {
    const me = auth(req);
    const input = parse(broadcastSchema, req.body);
    const target: BroadcastTarget = input.target ?? { kind: 'ALL' };
    const notified = await broadcast(me.id, input.titleFa, input.bodyFa, target);
    await audit({ action: 'admin.broadcast', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { recipients: notified, target } });
    return { success: true, data: { notified } };
  });

  // ---- channel registry ----
  app.post('/admin/channel-registry/release', usersManage, async (req) => {
    const me = auth(req);
    const input = parse(releaseSchema, req.body);
    await releaseChannel(me.id, input.platform, input.channelRef);
    await audit({
      action: 'admin.channel_released',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { platform: input.platform, channelRef: input.channelRef },
    });
    return { success: true, data: { ok: true } };
  });
}
