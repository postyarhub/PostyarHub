import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { Badge, Card, EmptyState, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDateShort, faMoney, faNumber, faRelative, PLATFORM_FA } from '../../lib/format';
import { PlatformIcon } from '../../pages/admin/shared';

type PlatformKey = 'telegram' | 'bale' | 'rubika' | 'wordpress';

interface SummaryDto {
  days: number;
  from: string;
  to: string;
  events: { total: number; sent: number; failed: number };
  successRate: number | null;
  platforms: Record<PlatformKey, { sent: number; failed: number }>;
  daily: Array<{ day: string; eventName: string; count: number }>;
  topPosts?: Array<{ id: string; title: string | null; events: number }>;
  topCampaigns?: Array<{ id: string; name: string; events: number }>;
  errors?: Array<{ eventType: string; count: number }>;
  links: { clicks: number };
  revenue: {
    paymentsCreated: number;
    paymentsCompleted: number;
    paymentsCompletedRial: number;
    subscriptionRevenueRial: number;
    walletTopupRial: number;
    paymentsFailed: number;
    subscriptionsCreated: number;
    subscriptionsRenewed: number;
    subscriptionsExpired: number;
    referralsCreated: number;
    referralRewardEvents: number;
    referralRewardPoints: number;
  };
  automation: {
    ai: {
      requested: number;
      completed: number;
      failed: number;
      successRate: number | null;
      tokens: number;
      avgDurationMs: number | null;
    };
    workflows: {
      started: number;
      completed: number;
      failed: number;
      successRate: number | null;
      avgDurationMs: number | null;
    };
    errors: Array<{
      eventType: string;
      errorCode: string;
      count: number;
    }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function hasNumericFields(value: unknown, fields: string[]): boolean {
  return isRecord(value) && fields.every((field) => isFiniteNumber(value[field]));
}

/**
 * TypeScript types do not validate network data. Validate every nested collection
 * that the dashboard maps over and every aggregate it uses in arithmetic, so a
 * backend/frontend version skew becomes a visible API-contract error rather than
 * a render-time TypeError hidden behind the generic analytics failure message.
 */
function isAnalyticsSummary(value: unknown): value is SummaryDto {
  if (!isRecord(value)) return false;

  const events = value.events;
  const platforms = value.platforms;
  const revenue = value.revenue;
  const links = value.links;
  const automation = value.automation;

  if (
    !isFiniteNumber(value.days) ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    !isRecord(events) ||
    !isFiniteNumber(events.total) ||
    !isFiniteNumber(events.sent) ||
    !isFiniteNumber(events.failed) ||
    !isNullableNumber(value.successRate) ||
    !Array.isArray(value.daily) ||
    !value.daily.every((row) =>
      isRecord(row) &&
      typeof row.day === 'string' &&
      typeof row.eventName === 'string' &&
      isFiniteNumber(row.count)
    ) ||
    !isRecord(platforms) ||
    !isRecord(revenue) ||
    !isRecord(links) ||
    !isFiniteNumber(links.clicks) ||
    !isRecord(automation) ||
    !isRecord(automation.ai) ||
    !isRecord(automation.workflows) ||
    !Array.isArray(automation.errors) ||
    !automation.errors.every((row) =>
      isRecord(row) &&
      typeof row.eventType === 'string' &&
      typeof row.errorCode === 'string' &&
      isFiniteNumber(row.count)
    )
  ) {
    return false;
  }

  const platformKeys: PlatformKey[] = ['telegram', 'bale', 'rubika', 'wordpress'];
  if (!platformKeys.every((key) => hasNumericFields(platforms[key], ['sent', 'failed']))) {
    return false;
  }

  const revenueFields = [
    'paymentsCreated',
    'paymentsCompleted',
    'paymentsCompletedRial',
    'subscriptionRevenueRial',
    'walletTopupRial',
    'paymentsFailed',
    'subscriptionsCreated',
    'subscriptionsRenewed',
    'subscriptionsExpired',
    'referralsCreated',
    'referralRewardEvents',
    'referralRewardPoints',
  ];
  if (!revenueFields.every((field) => isFiniteNumber(revenue[field]))) {
    return false;
  }

  const ai = automation.ai;
  const workflows = automation.workflows;
  if (
    !isFiniteNumber(ai.requested) ||
    !isFiniteNumber(ai.completed) ||
    !isFiniteNumber(ai.failed) ||
    !isNullableNumber(ai.successRate) ||
    !isFiniteNumber(ai.tokens) ||
    !isNullableNumber(ai.avgDurationMs) ||
    !isFiniteNumber(workflows.started) ||
    !isFiniteNumber(workflows.completed) ||
    !isFiniteNumber(workflows.failed) ||
    !isNullableNumber(workflows.successRate) ||
    !isNullableNumber(workflows.avgDurationMs)
  ) {
    return false;
  }

  if (value.topPosts !== undefined && (
    !Array.isArray(value.topPosts) ||
    !value.topPosts.every((row) =>
      isRecord(row) &&
      typeof row.id === 'string' &&
      (row.title === null || typeof row.title === 'string') &&
      isFiniteNumber(row.events)
    )
  )) {
    return false;
  }

  if (value.topCampaigns !== undefined && (
    !Array.isArray(value.topCampaigns) ||
    !value.topCampaigns.every((row) =>
      isRecord(row) &&
      typeof row.id === 'string' &&
      typeof row.name === 'string' &&
      isFiniteNumber(row.events)
    )
  )) {
    return false;
  }

  if (value.errors !== undefined && (
    !Array.isArray(value.errors) ||
    !value.errors.every((row) =>
      isRecord(row) &&
      typeof row.eventType === 'string' &&
      isFiniteNumber(row.count)
    )
  )) {
    return false;
  }

  return true;
}

interface EventsDto {
  events: Array<{
    id: string;
    name: string;
    subjectType: string;
    subjectId: string;
    props?: Record<string, unknown> | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
}

interface TargetDto {
  platform: string;
  channelTitle: string;
  channelRef: string;
  state: string;
  attempts: number;
  errorCode: string | null;
}

interface PostDetails {
  post: { title: string | null };
  targets: TargetDto[];
}

const EVENT_FA: Record<string, string> = {
  'post.created': 'ایجاد پست',
  'post.scheduled': 'زمان‌بندی پست',
  'post.sent': 'ارسال موفق',
  'post.failed': 'خطای ارسال',
  'post.delivery.sent': 'تحویل موفق',
  'post.delivery.failed': 'خطای تحویل',
  'bot.created': 'افزودن ربات',
  'bot.enabled': 'فعال‌سازی ربات',
  'bot.disabled': 'غیرفعال‌سازی ربات',
  'channel.connected': 'اتصال کانال',
  'channel.disconnected': 'قطع اتصال کانال',
  'payment.created': 'ایجاد پرداخت',
  'payment.initiated': 'آغاز پرداخت',
  'payment.completed': 'پرداخت موفق',
  'payment.failed': 'پرداخت ناموفق',
  'subscription.created': 'خرید اشتراک',
  'subscription.renewed': 'تمدید اشتراک',
  'subscription.expiring': 'نزدیک به پایان اشتراک',
  'subscription.expired': 'پایان اشتراک',
  'referral.rewarded': 'پاداش معرفی',
  'wordpress.connected': 'اتصال وردپرس',
  'wordpress.sync.completed': 'تکمیل همگام‌سازی وردپرس',
  'wordpress.sync.failed': 'خطای همگام‌سازی وردپرس',
  'wordpress.product.published': 'انتشار محصول',
  'ai.requested': 'درخواست هوش مصنوعی',
  'ai.completed': 'پردازش هوش مصنوعی',
  'ai.failed': 'خطای هوش مصنوعی',
  'workflow.started': 'شروع گردش‌کار',
  'workflow.completed': 'تکمیل گردش‌کار',
  'workflow.failed': 'خطای گردش‌کار',
  'user.login': 'ورود به حساب',
  'user.registration': 'ثبت‌نام',
  'user.logout': 'خروج از حساب',
  'channel.created': 'ایجاد کانال',
  'channel.updated': 'به‌روزرسانی کانال',
  'post.delivery.started': 'آغاز ارسال به مقصد',
  'bot.message.received': 'دریافت پیام ربات',
  'bot.message.sent': 'ارسال پیام ربات',
  'bot.button.clicked': 'فشردن دکمه ربات',
  'wordpress.product.synced': 'همگام‌سازی محصول',
  'wordpress.content.published': 'انتشار محتوا در وردپرس',
  'wordpress.campaign.created': 'ایجاد کارزار وردپرس',
  'wordpress.campaign.updated': 'به‌روزرسانی کارزار وردپرس',
  'wordpress.campaign.deleted': 'حذف کارزار وردپرس',
  'wordpress.campaign.run.started': 'آغاز اجرای کارزار',
  'wordpress.campaign.run.completed': 'پایان موفق اجرای کارزار',
  'wordpress.campaign.run.failed': 'ناموفق بودن اجرای کارزار',
  'wordpress.product.failed': 'خطای پردازش محصول وردپرس',
  'wordpress.content.failed': 'خطای انتشار محتوا در وردپرس',
  'link.clicked': 'باز کردن پیوند',
  'wallet.credit': 'افزایش موجودی کیف پول',
  'wallet.debit': 'کاهش موجودی کیف پول',
  'referral.created': 'ثبت معرفی',
};

/**
 * Never expose internal event identifiers to users. Known event codes have an
 * explicit Persian label; any future/unrecognized code receives a clear Persian
 * fallback instead of leaking English identifiers into the tooltip.
 */
function eventLabel(name: string): string {
  return EVENT_FA[name] ?? 'سایر فعالیت‌ها';
}

const ERROR_FA: Record<string, { label: string; action: string }> = {
  NOT_FOUND: {
    label: 'مقصد پیدا نشد',
    action: 'شناسه کانال یا گفتگو و عضویت ربات را بررسی کنید.',
  },
  TRANSIENT: {
    label: 'اختلال موقت پلتفرم',
    action: 'ارسال با تلاش مجدد خودکار ادامه می‌یابد؛ اتصال را بررسی کنید.',
  },
  BLOCKED: {
    label: 'دسترسی ناکافی',
    action: 'سطح دسترسی ربات و نقش مدیر کانال یا گروه را بررسی کنید.',
  },
  UNAUTHORIZED: {
    label: 'اعتبار اتصال نامعتبر',
    action: 'توکن یا اتصال پلتفرم را دوباره بررسی کنید.',
  },
  CHANNEL_DISABLED: {
    label: 'کانال غیرفعال',
    action: 'وضعیت کانال و اتصال ربات را بررسی کنید.',
  },
  PROVIDER_UNAVAILABLE: {
    label: 'پلتفرم موقتاً در دسترس نیست',
    action: 'اتصال را بررسی کرده و بعداً دوباره تلاش کنید.',
  },
  RATE_LIMITED: {
    label: 'محدودیت نرخ ارسال',
    action: 'فاصله ارسال را بیشتر کنید و ارسال مجدد را به زمان بعد موکول کنید.',
  },
  VALIDATION: {
    label: 'داده پیام نامعتبر',
    action: 'محتوا، قالب، لینک‌ها و مقادیر ورودی را بررسی کنید.',
  },
};

const number = (value: number) => faNumber(Math.max(0, Math.round(value)));
const money = (value: number) => faMoney(Math.max(0, Math.round(value)));

const duration = (ms: number) => {
  if (!ms || ms < 1) return '—';
  if (ms < 1000) return `${number(ms)} میلی‌ثانیه`;
  return `${(ms / 1000).toLocaleString('fa-IR', {
    maximumFractionDigits: 1,
  })} ثانیه`;
};

const errorInfo = (code: string) =>
  ERROR_FA[code] ?? {
    label: 'خطای ناشناخته',
    action: 'جزئیات این رویداد را بررسی کنید.',
  };

function Section({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`analytics-v4-section ${className}`.trim()}>
      <div className="analytics-v4-section__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

function Progress({
  value,
  max,
  tone = 'brand',
}: {
  value: number;
  max: number;
  tone?: 'brand' | 'success' | 'danger';
}) {
  const percent =
    max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div className="analytics-v4-progress">
      <span
        className={`analytics-v4-progress__fill analytics-v4-progress__fill--${tone}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function Ring({ value }: { value: number | null }) {
  const hasValue = value !== null && Number.isFinite(value);
  const percent = hasValue ? Math.min(100, Math.max(0, value)) : 0;

  return (
    <div
      className="analytics-v4-ring"
      style={{
        background: `conic-gradient(var(--brand) ${percent}%, var(--surface-2) 0)`,
      }}
    >
      <div>
        <strong>{hasValue ? `${number(percent)}٪` : '—'}</strong>
        <span>موفقیت</span>
      </div>
    </div>
  );
}

interface DailyPoint {
  day: string;
  total: number;
  breakdown: Array<{ name: string; count: number }>;
}

function shiftIsoDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function DailyActivityChart({ points }: { points: DailyPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const activeBarRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const max = Math.max(1, ...points.map((point) => point.total));
  const active = activeIndex !== null ? points[activeIndex] : points[points.length - 1];

  useLayoutEffect(() => {
    if (activeIndex === null || !activeBarRef.current || !tooltipRef.current) {
      setTooltipPos(null);
      return;
    }

    const updateTooltip = () => {
      const barRect = activeBarRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current;
      if (!barRect || !tooltip) return;

      const gap = 10;
      const margin = 12;
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      let left = barRect.left + barRect.width / 2 - width / 2;
      left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
      let top = barRect.top - height - gap;
      if (top < margin) top = Math.min(window.innerHeight - height - margin, barRect.bottom + gap);
      top = Math.max(margin, top);
      setTooltipPos({ left, top });
    };

    updateTooltip();
    window.addEventListener('resize', updateTooltip, { passive: true });
    window.addEventListener('scroll', updateTooltip, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', updateTooltip);
      window.removeEventListener('scroll', updateTooltip, true);
    };
  }, [activeIndex, active?.day, active?.total]);

  if (!points.length) {
    return <div className="analytics-daily-empty">دادهٔ روزانه هنوز ثبت نشده است.</div>;
  }

  return (
    <div className="analytics-daily-chart" dir="rtl">
      <div className="analytics-daily-chart__insight" aria-live="polite">
        <div className="analytics-daily-chart__insight-head">
          <div>
            <span>آمار فوری روز</span>
            <strong>{active ? faDateShort(`${active.day}T12:00:00`) : '—'}</strong>
          </div>
          <div className="analytics-daily-chart__insight-total">
            <small>مجموع اقدامات</small>
            <b>{active ? number(active.total) : '۰'}</b>
          </div>
        </div>
        <div className="analytics-daily-chart__insight-breakdown">
          {active?.breakdown.length ? active.breakdown.map((item) => (
            <span key={item.name}><em>{eventLabel(item.name)}</em><b>{number(item.count)}</b></span>
          )) : <span className="analytics-daily-chart__insight-muted">جزئیات رویداد برای این روز ثبت نشده است.</span>}
        </div>
      </div>

      <div className="analytics-daily-chart__plot" role="img" aria-label="نمودار میله‌ای روند فعالیت روزانه">
        <div className="analytics-daily-chart__gridline analytics-daily-chart__gridline--top" />
        <div className="analytics-daily-chart__gridline analytics-daily-chart__gridline--mid" />
        <div className="analytics-daily-chart__gridline analytics-daily-chart__gridline--bottom" />
        <div className="analytics-daily-chart__bars">
          {points.map((point, index) => {
            const ratio = point.total / max;
            const isActive = index === activeIndex || (activeIndex === null && index === points.length - 1);
            return (
              <button
                ref={activeIndex === index ? activeBarRef : undefined}
                key={point.day}
                type="button"
                className={`analytics-daily-chart__bar ${isActive ? 'is-active' : ''}`}
                aria-label={`${faDateShort(`${point.day}T12:00:00`)}، ${number(point.total)} اقدام`}
                aria-describedby={activeIndex === index ? 'analytics-daily-chart-tooltip' : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              >
                <span className="analytics-daily-chart__bar-value">{point.total ? number(point.total) : ''}</span>
                <span className="analytics-daily-chart__bar-fill" style={{ height: `${point.total ? Math.max(6, ratio * 100) : 0}%` }} />
                <span className="analytics-daily-chart__bar-label">{faDateShort(`${point.day}T12:00:00`).slice(5)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {activeIndex !== null && active ? (
        <div
          ref={tooltipRef}
          id="analytics-daily-chart-tooltip"
          role="tooltip"
          className={`analytics-daily-chart__tooltip ${tooltipPos ? 'is-visible' : ''}`}
          style={tooltipPos ? { left: tooltipPos.left, top: tooltipPos.top } : { left: 12, top: 12 }}
        >
          <div className="analytics-daily-chart__tooltip-head">
            <span>{faDateShort(`${active.day}T12:00:00`)}</span>
            <b>{number(active.total)} اقدام</b>
          </div>
          <div className="analytics-daily-chart__tooltip-list">
            {active.breakdown.length ? active.breakdown.map((item) => (
              <div key={item.name}><span>{eventLabel(item.name)}</span><b>{number(item.count)}</b></div>
            )) : <span className="analytics-daily-chart__tooltip-empty">در این روز رویدادی ثبت نشده است.</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Analytics() {
  const toast = useToast();
  const [summary, setSummary] = useState<SummaryDto | null>(null);
  const [events, setEvents] = useState<EventsDto['events']>([]);
  const [postDetails, setPostDetails] = useState<Record<string, PostDetails>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eventsLoadError, setEventsLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setEventsLoadError(null);

    (async () => {
      try {
        const [summaryResult, eventsResult] = await Promise.allSettled([
          api.get<SummaryDto>('/api/v1/analytics/summary?days=30'),
          api.get<EventsDto>('/api/v1/analytics/events?limit=24'),
        ]);

        if (summaryResult.status === 'rejected') throw summaryResult.reason;
        const s: unknown = summaryResult.value;
        if (!isAnalyticsSummary(s)) {
          throw new ApiRequestError(
            'INVALID_ANALYTICS_RESPONSE',
            'ساختار پاسخ آمار با نسخهٔ فعلی پنل سازگار نیست. درخواست آمار به سرور رسیده، اما شکل داده‌ها معتبر نیست؛ شناسهٔ پیگیری را برای پشتیبانی ثبت کنید.',
            502,
          );
        }

        const ev = eventsResult.status === 'fulfilled' && Array.isArray(eventsResult.value?.events)
          ? eventsResult.value
          : { events: [], nextCursor: null };

        if (eventsResult.status === 'rejected') {
          const eventMessage = eventsResult.reason instanceof ApiRequestError
            ? eventsResult.reason.message
            : eventsResult.reason instanceof Error
              ? `${eventsResult.reason.name}: ${eventsResult.reason.message}`
              : 'دریافت فهرست فعالیت‌ها ناموفق بود.';
          setEventsLoadError(eventMessage);
        } else if (!Array.isArray(eventsResult.value?.events)) {
          setEventsLoadError('ساختار پاسخ فهرست فعالیت‌ها معتبر نیست.');
        }

        const ids = (Array.isArray(s.topPosts) ? s.topPosts : []).slice(0, 5).map((post) => post.id);
        const details = await Promise.allSettled(
          ids.map(
            async (id) =>
              [id, await api.get<PostDetails>(`/api/v1/posts/${id}`)] as const,
          ),
        );

        const map: Record<string, PostDetails> = {};

        for (const result of details) {
          if (result.status === 'fulfilled') {
            map[result.value[0]] = result.value[1];
          }
        }

        if (alive) {
          setSummary(s);
          setEvents(ev.events ?? []);
          setPostDetails(map);
          setLoadError(null);
        }
      } catch (error) {
        const message = error instanceof ApiRequestError
          ? `${error.message}${error.requestId ? ` (شناسهٔ پیگیری: ${error.requestId})` : ''}`
          : error instanceof Error
            ? `بارگذاری آمار با خطای ${error.name} مواجه شد: ${error.message}`
            : 'دریافت آمار تحلیل ناموفق بود.';
        if (alive) setLoadError(message);
        toast.error(message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [toast, retryKey]);

  const daily = useMemo(() => {
    const map = new Map<string, { total: number; breakdown: Map<string, number> }>();

    for (const row of summary?.daily ?? []) {
      const day = String(row.day).slice(0, 10);
      const current = map.get(day) ?? { total: 0, breakdown: new Map<string, number>() };
      const count = Number(row.count ?? 0);
      current.total += count;
      current.breakdown.set(row.eventName, (current.breakdown.get(row.eventName) ?? 0) + count);
      map.set(day, current);
    }

    const endDay = String(summary?.to ?? new Date().toISOString()).slice(0, 10);
    const totalDays = Math.max(1, Math.min(90, Number(summary?.days ?? 30)));
    return Array.from({ length: totalDays }, (_, index) => {
      const day = shiftIsoDay(endDay, index - (totalDays - 1));
      const value = map.get(day) ?? { total: 0, breakdown: new Map<string, number>() };
      return {
        day,
        total: value.total,
        breakdown: Array.from(value.breakdown.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      };
    });
  }, [summary]);

  const errorRows = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of summary?.automation.errors ?? []) {
      const key = `${row.eventType}::${row.errorCode}`;
      map.set(key, (map.get(key) ?? 0) + Number(row.count ?? 0));
    }

    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, count]) => {
        const [eventType, errorCode] = key.split('::');
        return { eventType, errorCode, count };
      });
  }, [summary]);

  if (loading) {
    return <PageLoading />;
  }

  if (!summary) {
    return (
      <div className="analytics-v4-page">
        <Card pad="lg" style={{ borderColor: 'var(--danger, #dc2626)' }}>
          <h1 style={{ marginTop: 0 }}>تحلیل آمار در دسترس نیست</h1>
          <p role="alert" style={{ lineHeight: 1.9 }}>
            {loadError ?? 'دریافت اطلاعات تحلیل کامل نشد.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            تلاش مجدد
          </button>
        </Card>
      </div>
    );
  }

  const platforms = (
    ['telegram', 'bale', 'rubika', 'wordpress'] as PlatformKey[]
  ).map((platform) => {
    const item = summary.platforms?.[platform] ?? {
      sent: 0,
      failed: 0,
    };

    return {
      platform,
      sent: Number(item.sent ?? 0),
      failed: Number(item.failed ?? 0),
    };
  });

  const aiRate = Number(summary.automation.ai.successRate ?? 0);
  const workflowRate = Number(
    summary.automation.workflows.successRate ?? 0,
  );

  const totalRevenue = Number(
    summary.revenue.paymentsCompletedRial ?? 0,
  );

  return (
    <div className="analytics-v4-page">
      <header className="analytics-v4-hero">
        <div>
          <span className="analytics-v4-eyebrow">مرکز تحلیل</span>
          <h1>آمار و عملکرد</h1>
          <p>
            نمای یکپارچه‌ی عملکرد ارسال، پلتفرم‌ها، محتوا، هوش مصنوعی،
            گردش‌کار، اشتراک و درآمد در ۳۰ روز اخیر.
          </p>
        </div>
        <Badge tone="brand">۳۰ روز اخیر</Badge>
      </header>

      <section className="analytics-v4-kpis">
        <Card className="analytics-v4-kpi analytics-v4-kpi--accent">
          <span className="analytics-v4-kpi__icon">📨</span>
          <div>
            <strong>{number(summary.events.sent)}</strong>
            <span>ارسال موفق</span>
            <small>ارسال‌هایی که با موفقیت ثبت شده‌اند</small>
          </div>
        </Card>

        <Card className="analytics-v4-kpi">
          <span className="analytics-v4-kpi__icon">⚠️</span>
          <div>
            <strong>{number(summary.events.failed)}</strong>
            <span>خطای ارسال</span>
            <small>مواردی که نیاز به بررسی دارند</small>
          </div>
        </Card>

        <Card className="analytics-v4-kpi">
          <div className="analytics-v4-kpi__ring">
            <Ring value={summary.successRate} />
          </div>
          <div>
            <strong>{summary.successRate === null ? '—' : `${number(summary.successRate)}٪`}</strong>
            <span>نرخ موفقیت</span>
            <small>نسبت عملیات موفق به کل عملیات</small>
          </div>
        </Card>

        <Card className="analytics-v4-kpi">
          <span className="analytics-v4-kpi__icon">🔗</span>
          <div>
            <strong>{number(summary.links.clicks)}</strong>
            <span>کلیک لینک</span>
            <small>تعامل ثبت‌شده روی لینک‌های رهگیری</small>
          </div>
        </Card>
      </section>

      <Section
        title="ارسال به تفکیک پلتفرم"
        description="تعداد کل، موفق و ناموفق هر پلتفرم در یک نمای خوانا."
      >
        <div className="analytics-v4-platforms">
          {platforms.map((item) => {
            const total = item.sent + item.failed;
            const rate = total ? Math.round((item.sent / total) * 100) : 0;

            return (
              <div
                key={item.platform}
                className="analytics-v4-platform"
              >
                <div className="analytics-v4-platform__head">
                  <div>
                    <PlatformIcon platform={item.platform} size={24} />
                    <strong>
                      {PLATFORM_FA[item.platform] ?? item.platform}
                    </strong>
                  </div>
                  <Badge
                    tone={
                      rate >= 90
                        ? 'success'
                        : rate >= 60
                          ? 'brand'
                          : 'danger'
                    }
                  >
                    {number(rate)}٪ موفق
                  </Badge>
                </div>

                <div className="analytics-v4-platform__number">
                  {number(total)}
                  <span>عملیات</span>
                </div>

                <Progress value={item.sent} max={Math.max(1, total)} tone="success" />

                <div className="analytics-v4-platform__stats">
                  <span>
                    موفق <b>{number(item.sent)}</b>
                  </span>
                  <span>
                    خطا <b>{number(item.failed)}</b>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <section className="analytics-v4-two-col">
        <Section
          title="پست‌های پرتراکنش"
          description="نام پست، کانال مقصد، پلتفرم و نتیجه‌ی ارسال."
        >
          {summary.topPosts.length === 0 ? (
            <EmptyState
              icon="📊"
              title="داده‌ای ثبت نشده"
              description="پس از انتشار پست‌ها، این فهرست تکمیل می‌شود."
            />
          ) : (
            <div className="analytics-v4-posts">
              {summary.topPosts.slice(0, 5).map((post) => {
                const detail = postDetails[post.id];
                const groups = new Map<
                  string,
                  {
                    channel: string;
                    platform: string;
                    sent: number;
                    failed: number;
                  }
                >();

                for (const target of detail?.targets ?? []) {
                  const key = `${target.channelRef}::${target.platform}`;
                  const current = groups.get(key) ?? {
                    channel: target.channelTitle || 'کانال متصل',
                    platform: target.platform,
                    sent: 0,
                    failed: 0,
                  };

                  if (target.state === 'SENT') current.sent += 1;
                  if (target.state === 'FAILED') current.failed += 1;

                  groups.set(key, current);
                }

                return (
                  <div key={post.id} className="analytics-v4-post">
                    <div className="analytics-v4-post__title">
                      <Link to={`/dashboard/posts/${post.id}`}>
                        {post.title ||
                          detail?.post?.title ||
                          'پست بدون عنوان'}
                      </Link>
                      <Badge tone="brand">
                        {number(post.events)} رویداد
                      </Badge>
                    </div>

                    {groups.size ? (
                      <div className="analytics-v4-post__targets">
                        {Array.from(groups.values()).map((group) => (
                          <span
                            key={`${group.channel}-${group.platform}`}
                            className="analytics-v4-pill"
                          >
                            <PlatformIcon
                              platform={group.platform}
                              size={15}
                            />
                            <b>{group.channel}</b>
                            <span>
                              {number(group.sent)} موفق
                            </span>
                            <span>
                              {number(group.failed)} خطا
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="analytics-v4-note">
                        جزئیات مقصد در دسترس نیست.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title="رایج‌ترین خطاها"
          description="دسته‌بندی فارسی خطا و اقدام پیشنهادی."
        >
          {errorRows.length === 0 ? (
            <EmptyState
              icon="✅"
              title="خطای پرتکراری وجود ندارد"
              description="در این بازه خطای شاخصی ثبت نشده است."
            />
          ) : (
            <div className="analytics-v4-errors">
              {errorRows.map((item) => {
                const info = errorInfo(item.errorCode);

                return (
                  <div
                    key={`${item.eventType}-${item.errorCode}`}
                    className="analytics-v4-error"
                  >
                    <div className="analytics-v4-error__top">
                      <div>
                        <strong>{info.label}</strong>
                        <span>
                          {EVENT_FA[item.eventType] ??
                            'رویداد سیستمی'}
                        </span>
                      </div>
                      <Badge tone="danger">
                        {number(item.count)}
                      </Badge>
                    </div>
                    <p>
                      <b>اقدام پیشنهادی:</b> {info.action}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </section>

      <section className="analytics-v4-two-col">
        <Section
          title="هوش مصنوعی و گردش‌کار"
          description="اجرای موفق، خطا، نرخ موفقیت و زمان پردازش."
        >
          <div className="analytics-v4-automation">
            <div className="analytics-v4-automation-card">
              <div className="analytics-v4-automation-card__head">
                <div>
                  <span>هوش مصنوعی</span>
                  <strong>
                    {number(summary.automation.ai.completed)}
                  </strong>
                  <small>پردازش تکمیل‌شده</small>
                </div>
                <Ring value={aiRate} />
              </div>

              <div className="analytics-v4-statline">
                <div>
                  <span>درخواست</span>
                  <b>{number(summary.automation.ai.requested)}</b>
                </div>
                <div>
                  <span>خطا</span>
                  <b>{number(summary.automation.ai.failed)}</b>
                </div>
                <div>
                  <span>زمان میانگین</span>
                  <b>
                    {duration(
                      Number(
                        summary.automation.ai.avgDurationMs ?? 0,
                      ),
                    )}
                  </b>
                </div>
              </div>
            </div>

            <div className="analytics-v4-automation-card">
              <div className="analytics-v4-automation-card__head">
                <div>
                  <span>گردش‌کار</span>
                  <strong>
                    {number(
                      summary.automation.workflows.completed,
                    )}
                  </strong>
                  <small>اجرای تکمیل‌شده</small>
                </div>
                <Ring value={workflowRate} />
              </div>

              <div className="analytics-v4-statline">
                <div>
                  <span>شروع</span>
                  <b>
                    {number(
                      summary.automation.workflows.started,
                    )}
                  </b>
                </div>
                <div>
                  <span>خطا</span>
                  <b>
                    {number(
                      summary.automation.workflows.failed,
                    )}
                  </b>
                </div>
                <div>
                  <span>زمان میانگین</span>
                  <b>
                    {duration(
                      Number(
                        summary.automation.workflows.avgDurationMs ??
                          0,
                      ),
                    )}
                  </b>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="درآمد و اشتراک"
          description="نمای مالی و چرخه‌ی اشتراک در ۳۰ روز اخیر."
        >
          <div className="analytics-v4-revenue-main">
            <span>مجموع پرداخت‌های موفق</span>
            <strong>{money(totalRevenue)}</strong>
            <small>ریال</small>
          </div>

          <div className="analytics-v4-revenue-grid">
            <div>
              <span>درآمد اشتراک</span>
              <b>
                {money(
                  summary.revenue.subscriptionRevenueRial,
                )}
              </b>
            </div>
            <div>
              <span>شارژ کیف پول</span>
              <b>
                {money(summary.revenue.walletTopupRial)}
              </b>
            </div>
            <div>
              <span>اشتراک جدید</span>
              <b>
                {number(
                  summary.revenue.subscriptionsCreated,
                )}
              </b>
            </div>
            <div>
              <span>تمدید اشتراک</span>
              <b>
                {number(
                  summary.revenue.subscriptionsRenewed,
                )}
              </b>
            </div>
          </div>
        </Section>
      </section>

      <Section
        title="روند فعالیت روزانه"
        description="۳۰ روز اخیر؛ میله‌ها تعاملی هستند و با نگه‌داشتن ماوس، آمار همان روز را فوری نمایش می‌دهند."
      >
        <DailyActivityChart points={daily} />
      </Section>

      <Section
        title="آخرین فعالیت‌ها"
        description="آخرین رویدادهای ثبت‌شده در حساب کاربری."
      >
        {eventsLoadError ? (
          <div role="status" className="analytics-v4-inline-warning" style={{ marginBottom: 12 }}>
            <p style={{ margin: '0 0 8px' }}>فهرست فعالیت‌ها دریافت نشد؛ سایر آمار در صورت دسترس بودن همچنان نمایش داده می‌شوند.</p>
            <small>{eventsLoadError}</small>
            <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetryKey((value) => value + 1)}>تلاش مجدد</button></div>
          </div>
        ) : null}
        {events.length === 0 ? (
          <EmptyState
            icon="🧭"
            title="فعالیتی ثبت نشده"
            description="فعالیت‌های جدید در این بخش نمایش داده می‌شوند."
          />
        ) : (
          <div className="analytics-v4-events">
            {events.map((event) => {
              const failed =
                event.name.endsWith('.failed') ||
                event.name === 'post.failed';

              return (
                <div
                  key={event.id}
                  className="analytics-v4-event"
                >
                  <i
                    className={
                      failed
                        ? 'analytics-v4-event__dot analytics-v4-event__dot--danger'
                        : 'analytics-v4-event__dot'
                    }
                  />

                  <div>
                    <strong>
                      {EVENT_FA[event.name] ??
                        'فعالیت ثبت‌شده'}
                    </strong>
                    <span>
                      رویداد ثبت‌شده در حساب کاربری
                    </span>
                  </div>

                  <time>{faRelative(event.createdAt)}</time>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
