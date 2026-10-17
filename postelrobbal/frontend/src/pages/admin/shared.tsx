import { ApiRequestError, type PlanDto } from '../../lib/api';
import { PLATFORM_ICONS } from '../../components/PlatformIcons';
import type { NavIconName } from '../../components/icons';

/* ------------------------------------------------------------------ */
/* Shared helpers for the admin panel (Tasks 16-b + 17-b).             */
/* Label maps harvested from the old single-page Admin.tsx.            */
/* ------------------------------------------------------------------ */

export const PAGE_SIZE = 20;

export const ROLE_FA: Record<string, string> = {
  SUPER_ADMIN: 'مدیر ارشد',
  SUPPORT: 'پشتیبانی',
  USER: 'کاربر',
};

export const USER_STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  SUSPENDED: 'تعلیق‌شده',
};

export const PAYMENT_STATE_FA: Record<string, string> = {
  CREATED: 'ایجادشده',
  REDIRECTED: 'هدایت به درگاه',
  VERIFIED: 'تأییدشده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغوشده',
  REFUNDED: 'بازگشت‌شده',
  PENDING_REVIEW: 'در انتظار تأیید رسید',
};

export const CHANNEL_STATUS_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

export const BOT_STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
  PENDING: 'در انتظار تأیید',
};

export const BOT_MODE_FA: Record<string, string> = {
  WEBHOOK: 'وب‌هوک',
  POLLING: 'پایش',
};

export const AUDIT_ACTION_FA: Record<string, string> = {
  'admin.user_suspended': 'تعلیق کاربر',
  'admin.user_activated': 'فعال‌سازی کاربر',
  'admin.grant_subscription': 'هدیهٔ اشتراک',
  'admin.payment_approved': 'تأیید دستی پرداخت',
  'admin.payment_rejected': 'رد رسید پرداخت',
  'admin.plan_created': 'افزودن پلن',
  'admin.plan_updated': 'ویرایش پلن',
  'admin.plan_deleted': 'حذف پلن',
  'admin.settings_updated': 'به‌روزرسانی تنظیمات',
  'admin.broadcast': 'ارسال همگانی',
  'admin.ticket_reply': 'پاسخ مدیر به تیکت',
  'admin.ticket_close': 'بستن تیکت توسط مدیر',
  'admin.channel_released': 'آزادسازی کانال',
  'bot.connect': 'اتصال ربات',
  'bot.enable': 'فعال‌سازی ربات',
  'bot.disable': 'غیرفعال‌سازی ربات',
  'bot.command.create': 'افزودن دستور ربات',
  'bot.keyword.create': 'افزودن کلیدواژه',
  'bot.ai.update': 'به‌روزرسانی تنظیمات هوش مصنوعی ربات',
  'workflow.create': 'ساخت گردش‌کار',
  'workflow.update': 'ویرایش گردش‌کار',
  'workflow.delete': 'حذف گردش‌کار',
  'channel.connect': 'اتصال کانال',
  'channel.disconnect': 'قطع کانال',
  'post.publish': 'انتشار پست',
  'post.schedule': 'زمان‌بندی پست',
  'wordpress.connected': 'اتصال سایت وردپرس',
  'wordpress.secret_rotated': 'چرخش کلید سایت',
  'auth.login': 'ورود به حساب',
  'auth.register': 'ثبت‌نام',
  'user.register': 'ثبت‌نام کاربر',
  'subscription.activate': 'فعال‌سازی اشتراک',
  'payment.verified': 'تأیید پرداخت',
  'payment.created': 'ایجاد درخواست پرداخت',
  'admin.email_test': 'آزمون ارسال ایمیل',
  'admin.supporter_created': 'افزودن نیروی پشتیبانی',
  'admin.supporter_role_changed': 'تغییر نقش نیروی پشتیبانی',
  'admin.ticket_categories_updated': 'به‌روزرسانی دسته‌بندی تیکت',
  'admin.ticket_created': 'ایجاد تیکت از طرف مدیر',
  'admin.ai_provider_saved': 'ذخیرهٔ سرویس‌دهندهٔ هوش مصنوعی',
  'admin.ai_provider_deleted': 'حذف سرویس‌دهندهٔ هوش مصنوعی',
  'auth.logout': 'خروج از حساب',
  'auth.password_reset': 'بازیابی رمز عبور',
  'user.settings_updated': 'ویرایش تنظیمات حساب',
  'user.password_changed': 'تغییر رمز عبور',
  'user.avatar_updated': 'به‌روزرسانی تصویر نمایه',
  'user.avatar_removed': 'حذف تصویر نمایه',
  'channel.update': 'ویرایش کانال',
  'channel.verify': 'بررسی کانال',
  'bot.command.update': 'ویرایش دستور ربات',
  'bot.command.delete': 'حذف دستور ربات',
  'bot.keyword.update': 'ویرایش کلیدواژه',
  'bot.keyword.delete': 'حذف کلیدواژه',
  'bot.verify': 'بررسی ربات',
  'bot.mode': 'تغییر حالت ربات',
  'bot.ai_settings': 'تنظیمات هوش مصنوعی ربات',
  'post.create': 'ایجاد پست',
  'post.cancel': 'لغو انتشار پست',
  'post.target.retry': 'تلاش دوباره برای انتشار',
  'media.upload': 'بارگذاری فایل',
  'media.delete': 'حذف فایل',
  'wordpress.disconnected': 'قطع سایت وردپرس',
  'wordpress.product_published': 'انتشار محصول وردپرس',
  'sync_products': 'همگام‌سازی محصولات',
  'publish_product': 'انتشار محصول',
  'referral.first_purchase_reward': 'پرداخت پاداش معرفی',
  'referral.reward_failed': 'ناموفق بودن پاداش معرفی',
};

/* Ticket states — admin-side labels (round 18-c). The user-side Support page
   keeps its own friendlier map in lib/format; the admin list uses «باز / پاسخ
   داده‌شده / بسته» per the asovin-style chips. */
export const TICKET_STATE_FA: Record<string, string> = {
  OPEN: 'باز',
  ANSWERED: 'پاسخ داده‌شده',
  CLOSED: 'بسته',
};

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'brand' | 'muted';

/** Shared state→tone mapping for badges/pills (mirrors StatusBadge's map;
 *  falls back to muted for unknown states). */
export function statusTone(state: string): StatusTone {
  const map: Record<string, StatusTone> = {
    OPEN: 'warning',
    ANSWERED: 'success',
    CLOSED: 'muted',
    ACTIVE: 'success',
    SUSPENDED: 'danger',
    PENDING: 'warning',
    FAILED: 'danger',
    ERROR: 'danger',
  };
  return map[state] ?? 'muted';
}

/** Extract the server Persian message from an ApiRequestError, else fallback. */
export function errText(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback;
}

/** Coerce unknown JSON into a plain object (arrays/null → {}). */
export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function strField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function boolField(value: unknown): boolean {
  return value === true;
}

/** Strip separators + normalize Persian/Arabic digits in card numbers. */
export function normalizeCardNumber(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s-]/g, '');
}

/* ------------------------------------------------------------------ */
/* Row / DTO types (API contract Task 16-b)                            */
/* ------------------------------------------------------------------ */

export interface AdminUserRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mobile?: string | null;
  businessName?: string | null;
  role?: string | null;
  status?: string | null;
  createdAt?: string | null;
  /* Task 17-b avatar fields */
  avatarKind?: string | null;
  avatarValue?: string | null;
  avatarMediaId?: string | null;
}

export interface AdminPaymentRow {
  id: string;
  purpose?: string | null;
  amountRial?: number;
  state?: string | null;
  tenantId?: string | null;
  userEmail?: string | null;
  createdAt?: string | null;
  /* Round 19 detail-popup fields */
  months?: number | null;
  gateway?: string | null;
  gatewayRef?: string | null;
  reference?: string | null;
  verifiedAt?: string | null;
  metaJson?: { pricing?: Record<string, number> } | null;
  receiptMediaId?: string | null;
  receiptNote?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userMobile?: string | null;
  planNameFa?: string | null;
}

export interface AuditRow {
  id: string;
  actorLabel?: string | null;
  actorRoleFa?: string | null;
  actionFa?: string | null;
  subjectTypeFa?: string | null;
  subjectLabel?: string | null;
  createdAt?: string | null;
}

export interface AdminChannelRow {
  id: string;
  platform: string;
  channelRef: string;
  title?: string | null;
  status?: string | null;
  createdAt?: string | null;
  ownerEmail?: string | null;
  ownerName?: string | null;
}

export interface AdminBotRow {
  id: string;
  platform: string;
  username?: string | null;
  title?: string | null;
  status?: string | null;
  mode?: string | null;
  aiEnabled?: boolean;
  createdAt?: string | null;
  ownerEmail?: string | null;
}

export interface AdminPlanDto extends PlanDto {
  isActive?: boolean;
}

export interface PayCardRow {
  id?: string;
  bankName: string;
  cardNumber: string;
  holderName: string;
}

export interface AdminOverview {
  users?: { total?: number; active?: number; suspended?: number; new30d?: number };
  channels?: { total?: number; active?: number; telegram?: number; bale?: number; rubika?: number; byPlatform?: Record<'telegram'|'bale'|'rubika', { total: number; active: number; inactive: number }> };
  bots?: { total?: number; active?: number; telegram?: number; bale?: number; rubika?: number; byPlatform?: Record<'telegram'|'bale'|'rubika', { total: number; active: number; inactive: number }> };
  gold?: { configs?: number; enabled?: number; snapshots24h?: number };
  posts?: { total?: number; scheduled?: number; published30d?: number; failed24h?: number };
  payments?: { verifiedCount30d?: number; verifiedSum30d?: number; verifiedSumTotal?: number; pendingReview?: number };
  subscriptions?: { active?: number; byPlan?: Array<{ planName: string; count: number }> };
  usage?: {
    aiJobs30d?: number;
    mediaCount?: number;
    mediaBytes?: number;
    ticketsOpen?: number;
    deliveries24h?: number;
    deliveriesFailed24h?: number;
  };
}

/* ------------------------------------------------------------------ */
/* Small shared components                                             */
/* ------------------------------------------------------------------ */

/** iOS-like switch (theme.css .switch). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch__track" aria-hidden="true" />
    </label>
  );
}

/** Official platform logo for a platform key (telegram/bale/rubika). */
export function PlatformIcon({ platform, size = 20 }: { platform: string; size?: number }) {
  const Cmp = PLATFORM_ICONS[platform as keyof typeof PLATFORM_ICONS];
  if (!Cmp) return null;
  return <Cmp size={size} />;
}

/* ------------------------------------------------------------------ */
/* Admin navigation — grouped sections (Task 17-b). Single source for  */
/* the layout sidebar, the mobile drawer and the home quick tiles.     */
/* `end` = exact index match on NavLink.                               */
/* ------------------------------------------------------------------ */

export interface AdminSectionItem {
  to: string;
  icon: NavIconName;
  label: string;
  short: string;
  end?: boolean;
}

export interface AdminSectionGroup {
  group: string;
  items: AdminSectionItem[];
}

export const ADMIN_SECTIONS: AdminSectionGroup[] = [
  {
    group: 'مدیریت',
    items: [
      { to: '/dashboard/admin', icon: 'home', label: 'داشبورد مدیریت', short: 'داشبورد', end: true },
      { to: '/dashboard/admin/users', icon: 'referrals', label: 'کاربران', short: 'کاربران' },
      { to: '/dashboard/admin/channels', icon: 'channels', label: 'کانال‌ها', short: 'کانال‌ها' },
      { to: '/dashboard/admin/bots', icon: 'bots', label: 'ربات‌ها', short: 'ربات‌ها' },
    ],
  },
  {
    group: 'مالی',
    items: [
      { to: '/dashboard/admin/plans', icon: 'subscription', label: 'اشتراک‌ها (پلن‌ها)', short: 'پلن‌ها' },
      { to: '/dashboard/admin/payments', icon: 'wallet', label: 'پرداخت‌ها', short: 'پرداخت‌ها' },
      { to: '/dashboard/admin/gateways', icon: 'woocommerce', label: 'درگاه پرداخت', short: 'درگاه' },
    ],
  },
  {
    group: 'ارتباطات',
    items: [
      { to: '/dashboard/admin/sms', icon: 'notifications', label: 'پیامک', short: 'پیامک' },
      { to: '/dashboard/admin/email', icon: 'posts', label: 'ایمیل', short: 'ایمیل' },
      { to: '/dashboard/admin/tickets', icon: 'support', label: 'تیکت‌های پشتیبانی', short: 'تیکت‌ها' },
      { to: '/dashboard/admin/surveys', icon: 'support', label: 'نظرات و پیشنهادات', short: 'نظرات' },
      { to: '/dashboard/admin/support-team', icon: 'support', label: 'تیم پشتیبانی', short: 'پشتیبان‌ها' },
      { to: '/dashboard/admin/broadcast', icon: 'more', label: 'اطلاع‌رسانی', short: 'اطلاع‌رسانی' },
    ],
  },
  {
    group: 'تنظیمات',
    items: [
      { to: '/dashboard/admin/settings', icon: 'settings', label: 'مرکز تنظیمات', short: 'تنظیمات', end: true },
      { to: '/dashboard/admin/settings/general', icon: 'home', label: 'تنظیمات عمومی', short: 'عمومی' },
      { to: '/dashboard/admin/settings/ai', icon: 'ai', label: 'هوش مصنوعی', short: 'هوش مصنوعی' },
      { to: '/dashboard/admin/settings/gold', icon: 'gold', label: 'ربات طلا و سکه', short: 'طلا' },
      { to: '/dashboard/admin/settings/referral', icon: 'referrals', label: 'زیرمجموعه‌گیری', short: 'زیرمجموعه' },
      { to: '/dashboard/admin/settings/security', icon: 'admin', label: 'امنیت', short: 'امنیت' },
      { to: '/dashboard/admin/logs', icon: 'analytics', label: 'گزارش رویداد', short: 'رویدادها' },
    ],
  },
];

/** Flat view of all sections (quick tiles, lookups). */
export const ADMIN_SECTIONS_FLAT: AdminSectionItem[] = ADMIN_SECTIONS.flatMap((g) => g.items);
