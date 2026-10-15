/**
 * Single source of truth for user-facing formatting (§44-46, §168).
 * Persian digits everywhere; Jalali dates everywhere; no ad-hoc formatting
 * in components.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Convert any Latin digits inside a string/number to Persian digits. */
export function faDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to Latin (for parsing user input). */
export function toLatinDigits(input: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return input
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

/** Thousand-separated number with Persian digits: ۱۲۳٬۴۵۶ */
export function faNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '۰';
  const n = typeof value === 'number' ? value : Number(toLatinDigits(String(value).replace(/[,٬]/g, '')));
  if (Number.isNaN(n)) return faDigits(value);
  return faDigits(n.toLocaleString('en-US')).replace(/,/g, '٬');
}

/** Money in Toman with Persian digits (amounts stored in Rial). */
export function faMoney(rial: number | null | undefined): string {
  if (rial === null || rial === undefined) return `${faNumber(0)} تومان`;
  const toman = Math.round(rial / 10);
  return `${faNumber(toman)} تومان`;
}

let activeTimeZone = 'Asia/Tehran';
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function validTimeZone(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  if (!candidate) return 'Asia/Tehran';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return 'Asia/Tehran';
  }
}

/** Set the authenticated user's timezone for all dashboard date/time formatting. */
export function setAppTimeZone(value: string | null | undefined): void {
  activeTimeZone = validTimeZone(value);
}

export function getAppTimeZone(): string {
  return activeTimeZone;
}

export interface PersianDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Extract the Persian calendar wall-clock shown to the authenticated user. */
export function zonedPersianParts(input: string | number | Date): PersianDateTimeParts | null {
  const d = asDate(input);
  if (!d) return null;
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZone: activeTimeZone, numberingSystem: 'latn',
  });
  const parts = formatter.formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour'), minute: pick('minute'), second: pick('second') };
}

function getFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${activeTimeZone}|${key}`;
  const cached = formatterCache.get(cacheKey);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    ...options,
    timeZone: activeTimeZone,
    numberingSystem: 'arabext',
  });
  formatterCache.set(cacheKey, formatter);
  return formatter;
}

function asDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getZonedGregorianParts(input: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZone: activeTimeZone, numberingSystem: 'latn',
  });
  return Object.fromEntries(
    formatter.formatToParts(input).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

/** Convert the picker wall clock in the active timezone into an absolute Date/UTC instant. */
export function zonedWallClockToDate(parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number }): Date {
  const second = parts.second ?? 0;
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, second);
  const observed = getZonedGregorianParts(new Date(wallAsUtc));
  const observedAsUtc = Date.UTC(
    Number(observed.year), Number(observed.month) - 1, Number(observed.day),
    Number(observed.hour), Number(observed.minute), Number(observed.second),
  );
  return new Date(wallAsUtc - (observedAsUtc - wallAsUtc));
}

/** Jalali long date: «۱۵ آبان ۱۴۰۳». */
export function faDate(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  return d ? faDigits(getFormatter('date-long', { year: 'numeric', month: 'long', day: 'numeric' }).format(d)) : '—';
}

/** Jalali short: «۱۴۰۳/۰۸/۱۵». */
export function faDateShort(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  return d ? faDigits(getFormatter('date-short', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)) : '—';
}

/** Jalali date + time using the authenticated user's timezone. */
export function faDateTime(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  return `${faDate(d)} ساعت ${faDigits(getFormatter('time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d))}`;
}

/** Jalali long date + weekday using the authenticated user's timezone. */
export function faDateLong(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  const parts = getFormatter('date-weekday', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('weekday')}، ${faDigits(pick('day'))} ${pick('month')} ${faDigits(pick('year'))}`;
}

/** 24-hour local time using the authenticated user's timezone. */
export function faTime(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  return d ? faDigits(getFormatter('time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)) : '—';
}

const tehranDayFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tehran', numberingSystem: 'latn',
});

/** Stable Gregorian YYYY-MM-DD key at Tehran midnight semantics for analytics buckets. */
export function tehranDayKey(input: string | number | Date | null | undefined): string | null {
  const d = asDate(input);
  if (!d) return null;
  const parts = tehranDayFmt.formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Relative Persian time: «۳ روز پیش». */
export function faRelative(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const future = diff < 0;
  const fmt = (value: number, unit: string) =>
    future ? `${faDigits(value)} ${unit} دیگر` : `${faDigits(value)} ${unit} پیش`;
  if (minutes < 1) return future ? 'همین حالا' : 'همین حالا';
  if (minutes < 60) return fmt(minutes, 'دقیقه');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fmt(hours, 'ساعت');
  const days = Math.round(hours / 24);
  if (days < 30) return fmt(days, 'روز');
  const months = Math.round(days / 30);
  if (months < 12) return fmt(months, 'ماه');
  return fmt(Math.round(months / 12), 'سال');
}

/** Human file size with Persian digits: ۲٫۴ مگابایت (§44 single formatter). */
export function faFileSize(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (!Number.isFinite(b) || b <= 0) return `${faDigits(0)} بایت`;
  if (b >= 1024 * 1024) return `${faDigits((b / (1024 * 1024)).toFixed(1))} مگابایت`;
  if (b >= 1024) return `${faDigits(Math.round(b / 1024))} کیلوبایت`;
  return `${faDigits(b)} بایت`;
}

/** Percentage with Persian digits. */
export function faPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${faDigits((value * 100).toFixed(fractionDigits))}٪`;
}

/** Compact stats: ۱۲۰۰ → ۱٫۲ هزار / ۲٬۳۰۰٬۰۰۰ → ۲٫۳ میلیون */
export function faCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '۰';
  if (Math.abs(value) >= 1_000_000) return `${faDigits((value / 1_000_000).toFixed(1))} میلیون`;
  if (Math.abs(value) >= 1000) return `${faDigits((value / 1000).toFixed(1))} هزار`;
  return faNumber(value);
}

/** Jalali date input helpers: value for <input type="date"> in Gregorian ISO. */
export function isoToJalaliInput(iso: string | Date | null | undefined): string {
  const d = asDate(iso);
  return d ? faDateShort(d) : '';
}

/** Status label maps (§22, §43). */
export const DELIVERY_STATE_FA: Record<string, string> = {
  PENDING: 'در انتظار ارسال',
  PROCESSING: 'در حال پردازش',
  SENT: 'ارسال شد',
  RETRYING: 'در حال تلاش مجدد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

export const POST_STATE_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  SCHEDULED: 'زمان‌بندی‌شده',
  QUEUED: 'در صف انتشار',
  PUBLISHING: 'در حال انتشار',
  PUBLISHED: 'منتشر شد',
  PARTIAL: 'نیمه‌کاره',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

export const PLATFORM_FA: Record<string, string> = {
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};

export const POST_SOURCE_FA: Record<string, string> = {
  MANUAL: 'دستی',
  GOLD: 'طلا',
  WORDPRESS: 'وب‌سایت',
  WORKFLOW: 'گردش‌کار',
};

export const EVENT_TYPE_FA: Record<string, string> = {
  'post.created': 'ایجاد پست',
  'post.scheduled': 'زمان‌بندی پست',
  'post.sent': 'ارسال موفق',
  'post.failed': 'ارسال ناموفق',
  'post.delivery.sent': 'تحویل موفق',
  'post.delivery.failed': 'تحویل ناموفق',
  'bot.created': 'افزودن ربات',
  'channel.connected': 'اتصال کانال',
  'payment.completed': 'پرداخت موفق',
  'payment.failed': 'پرداخت ناموفق',
  'subscription.created': 'خرید اشتراک',
  'subscription.renewed': 'تمدید اشتراک',
  'subscription.expired': 'پایان اشتراک',
  'referral.rewarded': 'دریافت پاداش معرفی',
  'wordpress.connected': 'اتصال سایت وردپرس',
  'wordpress.product.published': 'انتشار محصول',
  'ai.requested': 'درخواست هوش مصنوعی',
  'ai.completed': 'تکمیل پردازش هوش مصنوعی',
  'ai.failed': 'خطای پردازش هوش مصنوعی',
  'workflow.started': 'شروع گردش‌کار',
  'workflow.completed': 'تکمیل گردش‌کار',
  'workflow.failed': 'خطای گردش‌کار',
};

export function faLabel(value: string | null | undefined, labels: Record<string, string>, fallback = 'نامشخص'): string {
  return value && labels[value] ? labels[value] : fallback;
}

export const TICKET_STATE_FA: Record<string, string> = {
  OPEN: 'در انتظار پاسخ',
  ANSWERED: 'پاسخ داده شد',
  CLOSED: 'بسته شده',
};
