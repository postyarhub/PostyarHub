import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { payments, plans, subscriptions, tickets, users } from '../../db/schema.js';
import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../core/logger.js';
import { enqueue } from '../../queue/queues.js';
import { getEmailSettings } from '../admin/system-settings.service.js';
import type { EmailNotificationPayload, EmailTemplateInput } from '../../providers/email/templates.js';

const log = createLogger('email-notifications');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface BusinessEmailEvent {
  eventId: string;
  name: string;
  tenantId: string | null;
  subjectId?: string;
  props: Record<string, unknown>;
}

export function isBusinessEmailEvent(value: unknown): value is BusinessEmailEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.eventId === 'string' && typeof v.name === 'string' &&
    (typeof v.tenantId === 'string' || v.tenantId === null) &&
    (v.subjectId === undefined || typeof v.subjectId === 'string') &&
    Boolean(v.props) && typeof v.props === 'object' && !Array.isArray(v.props);
}

async function mailConfigured(): Promise<boolean> {
  const settings = await getEmailSettings();
  if (!settings.enabled) return false;
  const env = loadEnv();
  const useSettings = Boolean(settings.host.trim());
  return Boolean(useSettings
    ? (settings.host.trim() && settings.user.trim() && settings.pass)
    : ((env.MAIL_HOST ?? '').trim() && (env.MAIL_USER ?? '').trim() && env.MAIL_PASSWORD));
}

function safeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 190);
}

function validRecipient(value: string): boolean {
  return value.length <= 190 && EMAIL_RE.test(value) && !/[\r\n]/.test(value);
}

async function queueNotice(to: string, key: string, input: EmailTemplateInput): Promise<void> {
  if (!validRecipient(to)) return;
  const payload: EmailNotificationPayload = {
    kind: 'EMAIL_NOTIFICATION',
    to,
    subject: safeSubject(input.subject),
    preheader: input.preheader.slice(0, 180),
    title: input.title.slice(0, 160),
    ...(input.greeting ? { greeting: input.greeting.slice(0, 160) } : {}),
    paragraphs: input.paragraphs.slice(0, 12).map((p) => p.slice(0, 2000)),
    ...(input.details ? { details: input.details.slice(0, 12).map((d) => ({ label: d.label.slice(0, 60), value: d.value.slice(0, 300) })) } : {}),
    ...(input.buttonLabel && input.buttonPath ? {
      buttonLabel: input.buttonLabel.slice(0, 100),
      buttonPath: input.buttonPath.slice(0, 500),
    } : {}),
    ...(input.footerNote ? { footerNote: input.footerNote.slice(0, 300) } : {}),
  };
  if (!payload.subject) return;
  await enqueue('notifications', 'email-notification', payload as unknown as Record<string, unknown>, {
    jobId: 'email:' + key,
  });
}

async function queueStaffNotice(
  key: string,
  input: EmailTemplateInput,
  roles: Array<'SUPER_ADMIN' | 'SUPPORT'> = ['SUPER_ADMIN'],
): Promise<void> {
  const db = getDb();
  const staff = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.role, roles), eq(users.status, 'ACTIVE')))
    .limit(50);
  for (const member of staff) {
    if (!validRecipient(member.email)) continue;
    await queueNotice(member.email, key + ':' + member.id, input);
  }
}

async function getTenant(tenantId: string) {
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      businessName: users.businessName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, tenantId))
    .limit(1);
  return user;
}

function displayName(user: { firstName: string; lastName: string }): string {
  return (user.firstName.trim() + ' ' + user.lastName.trim()).trim() || 'کاربر پُست‌یار';
}

function faMoney(value: number | string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' ریال' : 'نامشخص';
}

function faDate(value: Date | string | null | undefined): string {
  if (!value) return 'نامشخص';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long', timeZone: 'Asia/Tehran' }).format(date);
}

/** Called only by the notifications worker; SMTP delivery remains a separate bounded job. */
export async function dispatchEmailForBusinessEvent(event: BusinessEmailEvent): Promise<void> {
  if (!await mailConfigured()) return;
  const db = getDb();

  if (event.name === 'user.registration' && event.tenantId) {
    const user = await getTenant(event.tenantId);
    if (!user || !validRecipient(user.email)) return;
    const name = displayName(user);
    await queueNotice(user.email, 'registered:' + user.id, {
      subject: 'ثبت‌نام شما در پُست‌یار انجام شد',
      preheader: 'حساب پُست‌یار شما با موفقیت ایجاد شده است.',
      title: 'به پُست‌یار خوش آمدید',
      greeting: 'سلام ' + name + '،',
      paragraphs: ['ثبت‌نام شما با موفقیت انجام شد. از این پس می‌توانید انتشار محتوای کانال‌هایتان را از پنل پُست‌یار مدیریت کنید.', 'اگر این حساب را شما ایجاد نکرده‌اید، لطفاً با پشتیبانی تماس بگیرید.'],
      buttonLabel: 'ورود به پنل پُست‌یار',
      buttonPath: '/dashboard',
    });
    if (user.role === 'USER') {
      await queueStaffNotice('new-user:' + user.id, {
        subject: 'ثبت‌نام کاربر جدید در پُست‌یار',
        preheader: 'یک حساب کاربری جدید ایجاد شده است.',
        title: 'ثبت‌نام کاربر جدید',
        paragraphs: ['یک کاربر جدید در پُست‌یار ثبت‌نام کرده است.'],
        details: [
          { label: 'نام کاربر', value: name },
          { label: 'ایمیل', value: user.email },
          { label: 'کسب‌وکار', value: user.businessName },
        ],
        buttonLabel: 'مشاهده کاربران',
        buttonPath: '/dashboard/admin/users',
      });
    }
    return;
  }

  if ((event.name === 'payment.completed' || event.name === 'payment.failed') && event.subjectId) {
    const [payment] = await db
      .select({
        id: payments.id,
        tenantId: payments.tenantId,
        purpose: payments.purpose,
        amountRial: payments.amountRial,
      })
      .from(payments)
      .where(eq(payments.id, event.subjectId))
      .limit(1);
    if (!payment) return;
    // Subscription payment completion is represented by a follow-up subscription
    // event; process only wallet top-ups here to avoid duplicate receipt emails.
    if (event.name === 'payment.completed' && payment.purpose !== 'WALLET_TOPUP') return;
    const user = await getTenant(payment.tenantId);
    if (!user) return;
    const failed = event.name === 'payment.failed';
    const amount = faMoney(payment.amountRial);
    if (validRecipient(user.email)) {
      await queueNotice(user.email, (failed ? 'payment-failed:' : 'wallet-topup:') + payment.id + ':' + user.id, {
        subject: failed ? 'پرداخت شما در پُست‌یار تأیید نشد' : 'رسید شارژ کیف پول پُست‌یار',
        preheader: failed ? 'وضعیت پرداخت شما نیاز به بررسی دارد.' : 'شارژ کیف پول شما با موفقیت انجام شد.',
        title: failed ? 'پرداخت تأیید نشد' : 'شارژ کیف پول موفق بود',
        greeting: 'سلام ' + displayName(user) + '،',
        paragraphs: failed
          ? ['تأیید پرداخت انجام نشد. اگر مبلغی از حساب شما کسر شده است، وضعیت را از پنل پیگیری کنید یا با پشتیبانی تماس بگیرید.']
          : ['شارژ کیف پول پُست‌یار با موفقیت ثبت شد. این ایمیل رسید اطلاع‌رسانی عملیات است.'],
        details: [{ label: 'مبلغ', value: amount }, { label: 'شناسه پرداخت', value: payment.id }],
        buttonLabel: failed ? 'پیگیری در پنل' : 'مشاهده کیف پول',
        buttonPath: '/dashboard',
      });
    }
    await queueStaffNotice((failed ? 'payment-failed:' : 'wallet-topup:') + payment.id, {
      subject: failed ? 'پرداخت ناموفق در پُست‌یار' : 'شارژ کیف پول جدید در پُست‌یار',
      preheader: failed ? 'یک پرداخت نیازمند توجه است.' : 'یک شارژ کیف پول تأیید شده است.',
      title: failed ? 'پرداخت ناموفق' : 'شارژ کیف پول تأیید شد',
      paragraphs: [failed ? 'پرداخت کاربر نزد درگاه تأیید نشد.' : 'شارژ کیف پول کاربر با موفقیت تأیید شد.'],
      details: [
        { label: 'کاربر', value: displayName(user) },
        { label: 'ایمیل', value: user.email },
        { label: 'مبلغ', value: amount },
        { label: 'شناسه پرداخت', value: payment.id },
      ],
      buttonLabel: 'مشاهده پرداخت‌ها',
      buttonPath: '/dashboard/admin/payments',
    });
    return;
  }

  if (event.name === 'subscription.created' || event.name === 'subscription.renewed' ||
      event.name === 'subscription.expiring' || event.name === 'subscription.expired') {
    if (!event.subjectId) return;
    const [row] = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        expiresAt: subscriptions.expiresAt,
        planName: plans.nameFa,
        planCode: plans.code,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(users, eq(users.id, subscriptions.tenantId))
      .where(eq(subscriptions.id, event.subjectId))
      .limit(1);
    if (!row || !validRecipient(row.email)) return;
    const name = displayName({ firstName: row.firstName, lastName: row.lastName });
    const isRenewal = event.name === 'subscription.renewed';
    const isExpiring = event.name === 'subscription.expiring';
    const isExpired = event.name === 'subscription.expired';
    const title = isExpiring ? 'اشتراک شما به‌زودی منقضی می‌شود'
      : isExpired ? 'اشتراک شما به پایان رسیده است'
        : isRenewal ? 'تمدید اشتراک شما انجام شد' : 'اشتراک شما فعال شد';
    const paragraph = isExpiring
      ? 'اشتراک فعلی شما به‌زودی منقضی می‌شود. برای جلوگیری از وقفه در مدیریت و انتشار محتوا، وضعیت اشتراک را بررسی و در صورت نیاز تمدید کنید.'
      : isExpired
        ? 'مدت اعتبار اشتراک به پایان رسیده است. برای ادامهٔ استفاده از قابلیت‌های پلن، اشتراک خود را بررسی کنید.'
        : isRenewal ? 'تمدید اشتراک شما با موفقیت ثبت شد.' : 'اشتراک شما با موفقیت فعال شد.';
    await queueNotice(row.email, 'subscription:' + row.id + ':' + event.name, {
      subject: title + ' | پُست‌یار',
      preheader: paragraph,
      title,
      greeting: 'سلام ' + name + '،',
      paragraphs: [paragraph],
      details: [
        { label: 'پلن', value: row.planName },
        { label: 'کد پلن', value: row.planCode },
        { label: 'تاریخ پایان اعتبار', value: faDate(row.expiresAt) },
      ],
      buttonLabel: isExpiring || isExpired ? 'بررسی و تمدید اشتراک' : 'مشاهده اشتراک',
      buttonPath: '/dashboard',
    });
    if (!isExpiring && !isExpired) {
      await queueStaffNotice('subscription:' + row.id + ':' + event.name, {
        subject: isRenewal ? 'تمدید اشتراک جدید در پُست‌یار' : 'اشتراک جدید در پُست‌یار',
        preheader: 'وضعیت یک اشتراک تغییر کرده است.',
        title: isRenewal ? 'تمدید اشتراک' : 'فعال‌سازی اشتراک',
        paragraphs: [isRenewal ? 'اشتراک یک کاربر تمدید شد.' : 'اشتراک یک کاربر فعال شد.'],
        details: [
          { label: 'کاربر', value: name },
          { label: 'ایمیل', value: row.email },
          { label: 'پلن', value: row.planName },
          { label: 'تاریخ پایان', value: faDate(row.expiresAt) },
        ],
        buttonLabel: 'مشاهده اشتراک‌ها',
        buttonPath: '/dashboard/admin/payments',
      });
    }
  }
}

export type TicketEmailKind = 'created' | 'user-reply' | 'staff-reply' | 'staff-created';

/** Ticket email contains references only; private conversation bodies stay in the authenticated panel. */
export async function notifyTicketEmail(input: {
  kind: TicketEmailKind;
  ticketId: string;
  messageId: string;
}): Promise<void> {
  try {
    if (!await mailConfigured()) return;
    const db = getDb();
    const [ticket] = await db
      .select({
        id: tickets.id,
        tenantId: tickets.tenantId,
        subject: tickets.subject,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.tenantId))
      .where(eq(tickets.id, input.ticketId))
      .limit(1);
    if (!ticket) return;
    const name = displayName({ firstName: ticket.firstName, lastName: ticket.lastName });
    const subject = safeSubject(ticket.subject) || 'تیکت پشتیبانی';
    const details = [
      { label: 'موضوع', value: subject },
      { label: 'شماره پیگیری', value: ticket.id },
    ];

    if (input.kind === 'created' && validRecipient(ticket.email)) {
      await queueNotice(ticket.email, 'ticket-created-user:' + input.ticketId, {
        subject: 'تیکت شما در پُست‌یار ثبت شد',
        preheader: 'درخواست پشتیبانی شما دریافت شد.',
        title: 'تیکت شما ثبت شد',
        greeting: 'سلام ' + name + '،',
        paragraphs: ['درخواست شما ثبت شد. پاسخ و ادامهٔ گفتگو از داخل پنل پُست‌یار در دسترس خواهد بود.'],
        details,
        buttonLabel: 'مشاهده تیکت',
        buttonPath: '/dashboard/help',
      });
    }

    if (input.kind === 'created' || input.kind === 'user-reply') {
      const isNew = input.kind === 'created';
      await queueStaffNotice('ticket:' + input.ticketId + ':' + input.messageId, {
        subject: isNew ? 'تیکت پشتیبانی جدید' : 'پاسخ جدید کاربر به تیکت',
        preheader: isNew ? 'یک کاربر تیکت جدید ثبت کرده است.' : 'یک کاربر به تیکت پشتیبانی پاسخ داده است.',
        title: isNew ? 'تیکت جدید از کاربر' : 'پیام جدید در تیکت پشتیبانی',
        paragraphs: [isNew ? 'یک کاربر درخواست پشتیبانی جدیدی ثبت کرده است.' : 'یک کاربر در گفتگوی پشتیبانی پیام تازه‌ای ارسال کرده است.'],
        details: [...details, { label: 'نام کاربر', value: name }, { label: 'ایمیل کاربر', value: ticket.email }],
        buttonLabel: 'مشاهده تیکت در مدیریت',
        buttonPath: '/dashboard/admin/tickets',
      }, ['SUPER_ADMIN', 'SUPPORT']);
      return;
    }

    if ((input.kind === 'staff-reply' || input.kind === 'staff-created') && validRecipient(ticket.email)) {
      const initial = input.kind === 'staff-created';
      await queueNotice(ticket.email, 'ticket-staff:' + input.ticketId + ':' + input.messageId, {
        subject: initial ? 'پیام جدید پشتیبانی پُست‌یار' : 'پاسخ جدید تیکت شما',
        preheader: 'در تیکت پشتیبانی شما پیام تازه‌ای ثبت شده است.',
        title: initial ? 'پشتیبانی برای شما پیام دارد' : 'پاسخ جدید به تیکت شما',
        greeting: 'سلام ' + name + '،',
        paragraphs: [initial
          ? 'تیکتی از طرف تیم پشتیبانی برای شما ایجاد شده است. برای مشاهدهٔ پیام و ادامهٔ گفتگو وارد پنل شوید.'
          : 'تیم پشتیبانی به تیکت شما پاسخ داده است. برای مشاهدهٔ پاسخ، وارد پنل پُست‌یار شوید.'],
        details,
        buttonLabel: 'مشاهده تیکت',
        buttonPath: '/dashboard/help',
      });
    }
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string'
      ? String((err as { code: string }).code).slice(0, 40) : 'NOTIFICATION_ERROR';
    log.warn({ kind: input.kind, ticketId: input.ticketId, reason: code }, 'ticket_email_notification_enqueue_failed');
  }
}

export async function enqueueUserEmailNotice(
  tenantId: string,
  input: EmailTemplateInput,
  idempotencyKey: string,
): Promise<void> {
  try {
    if (!await mailConfigured()) return;
    const user = await getTenant(tenantId);
    if (!user || !validRecipient(user.email)) return;
    await queueNotice(user.email, idempotencyKey + ':' + user.id, {
      ...input,
      greeting: input.greeting || ('سلام ' + displayName(user) + '،'),
    });
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string'
      ? String((err as { code: string }).code).slice(0, 40) : 'NOTIFICATION_ERROR';
    log.warn({ tenantId, reason: code }, 'user_email_notification_enqueue_failed');
  }
}
