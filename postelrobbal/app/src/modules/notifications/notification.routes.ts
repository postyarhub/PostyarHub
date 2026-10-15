import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { notifications, systemSettings } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';

/** Static Persian notification categories (§27). */
export const NOTIFICATION_CATEGORIES: Array<{ key: string; labelFa: string; descriptionFa: string }> = [
  { key: 'SUBSCRIPTION_EXPIRY_7D', labelFa: 'هشدار انقضای اشتراک', descriptionFa: 'یادآوری ۷ روز پیش از پایان اشتراک' },
  { key: 'PAYMENT', labelFa: 'پرداخت‌ها و کیف پول', descriptionFa: 'نتیجهٔ پرداخت‌ها و تغییرات موجودی' },
  { key: 'POST_STATUS', labelFa: 'وضعیت ارسال پست‌ها', descriptionFa: 'موفقیت یا شکست ارسال‌ها' },
  { key: 'BOT_EVENTS', labelFa: 'رویدادهای ربات', descriptionFa: 'پیام‌ها و تعامل‌های ربات' },
  { key: 'BROADCAST', labelFa: 'اطلاعیه‌های پُست‌یار', descriptionFa: 'اخبار و اطلاعیه‌های سرویس' },
  { key: 'PASSWORD_RESET', labelFa: 'امنیت حساب', descriptionFa: 'بازیابی رمز عبور و هشدارهای امنیتی' },
];

function prefKey(tenantId: string): string {
  return `notif_pref:${tenantId}`;
}

async function readPrefs(tenantId: string): Promise<Record<string, boolean>> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, prefKey(tenantId)))
    .limit(1);
  const raw = row?.valueJson;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[cat.key];
    if (typeof v === 'boolean') out[cat.key] = v;
  }
  return out;
}

const prefsSchema = z.object({
  prefs: z.record(z.boolean()).refine(
    (r) => Object.keys(r).every((k) => NOTIFICATION_CATEGORIES.some((c) => c.key === k)) && Object.keys(r).length > 0,
    { message: 'کلیدهای دسته‌بندی معتبر نیستند.' }
  ),
});

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const q = (req.query ?? {}) as { page?: string; pageSize?: string; unreadOnly?: string };
    const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
    const unreadOnly = q.unreadOnly === 'true' || q.unreadOnly === '1';

    const db = getDb();
    const where = unreadOnly
      ? and(eq(notifications.tenantId, me.id), isNull(notifications.readAt))
      : eq(notifications.tenantId, me.id);

    const [totalRow] = await db.select({ value: count() }).from(notifications).where(where);
    const rows = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        titleFa: notifications.titleFa,
        bodyFa: notifications.bodyFa,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // Round 18 fix: the user dashboard bell badge reads `d.unread` — count of
    // this tenant's notifications with readAt IS NULL (independent of paging /
    // the unreadOnly filter).
    const [unreadRow] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.tenantId, me.id), isNull(notifications.readAt)));

    return {
      success: true,
      data: {
        items: rows,
        unread: Number(unreadRow?.value ?? 0),
        total: Number(totalRow?.value ?? 0),
        page,
        pageSize,
      },
    };
  });

  app.post('/notifications/:id/read', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    const db = getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.tenantId, me.id), isNull(notifications.readAt)));
    return { success: true, data: { ok: true } };
  });

  app.post('/notifications/read-all', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const db = getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.tenantId, me.id), isNull(notifications.readAt)));
    return { success: true, data: { ok: true } };
  });

  app.get('/notifications/preferences', { preHandler: [app.requireAuth] }, async (req) => {
    const stored = await readPrefs(auth(req).id);
    const categories = NOTIFICATION_CATEGORIES.map((c) => ({
      key: c.key,
      labelFa: c.labelFa,
      descriptionFa: c.descriptionFa,
      enabled: stored[c.key] ?? true,
    }));
    return { success: true, data: { categories } };
  });

  app.put('/notifications/preferences', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(prefsSchema, req.body);
    const db = getDb();
    const current = await readPrefs(me.id);
    const merged = { ...current, ...input.prefs };
    await db
      .insert(systemSettings)
      .values({
        settingKey: prefKey(me.id),
        valueJson: merged as Record<string, unknown>,
      })
      .onDuplicateKeyUpdate({ set: { valueJson: merged as Record<string, unknown> } });
    return { success: true, data: { ok: true } };
  });
}
