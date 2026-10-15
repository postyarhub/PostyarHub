import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { NavIcon, type NavIconName } from '../../components/icons';
import { faNumber } from '../../lib/format';
import { boolField, strField } from './shared';

/* ------------------------------------------------------------------ */
/* مرکز تنظیمات — categorized hub (round 18-c, asovin-style).          */
/* Cards are grouped under .adm-subhead headings that mirror the       */
/* sidebar groups. Live per-area hints stay best-effort.               */
/* ------------------------------------------------------------------ */

interface SettingsCardDef {
  to: string;
  icon: NavIconName;
  title: string;
  desc: string;
  /** Key into the hints map for a cheap current-state line. */
  hintKey?: 'general' | 'ai' | 'referral' | 'security' | 'gold';
}

const GROUPS: Array<{ title: string; cards: SettingsCardDef[] }> = [
  {
    title: 'سامانه',
    cards: [
      { to: '/dashboard/admin/settings/general', icon: 'home', title: 'عمومی', desc: 'نام و شعار سایت، راه‌های ارتباطی پشتیبانی، قوانین و حالت تعمیر', hintKey: 'general' },
      { to: '/dashboard/admin/settings/security', icon: 'admin', title: 'امنیت', desc: 'ثبت‌نام کاربران جدید و کپچای امنیتی ورود', hintKey: 'security' },
    ],
  },
  {
    title: 'هوش مصنوعی و ربات‌ها',
    cards: [
      { to: '/dashboard/admin/settings/ai', icon: 'ai', title: 'هوش مصنوعی', desc: 'سرویس‌دهندهٔ پیش‌فرض، کلید رابط برنامه‌نویسی و مدل اختصاصی', hintKey: 'ai' },
      { to: '/dashboard/admin/settings/gold', icon: 'gold', title: 'ربات طلا و سکه', desc: 'سورس قیمت، فاصلهٔ به‌روزرسانی و قالب پیش‌فرض کاربران تازه', hintKey: 'gold' },
    ],
  },
  {
    title: 'مالی',
    cards: [
      { to: '/dashboard/admin/gateways', icon: 'woocommerce', title: 'درگاه پرداخت', desc: 'درگاه آنلاین، کارت به کارت و اعتبارنامهٔ هر درگاه' },
    ],
  },
  {
    title: 'ارتباطات',
    cards: [
      { to: '/dashboard/admin/sms', icon: 'notifications', title: 'پیامک', desc: 'سرویس‌دهندهٔ پیامک و اعتبارنامهٔ ارسال' },
      { to: '/dashboard/admin/email', icon: 'posts', title: 'ایمیل', desc: 'سرور ارسال رایانامه و رایانامهٔ آزمایشی' },
    ],
  },
  {
    title: 'رشد',
    cards: [
      { to: '/dashboard/admin/settings/referral', icon: 'referrals', title: 'زیرمجموعه‌گیری', desc: 'فعال‌سازی معرفی، پاداش ثبت‌نام و درصد خرید اول', hintKey: 'referral' },
    ],
  },
];

const AI_PROVIDER_TITLE: Record<string, string> = {
  openai: 'اوپن‌ای‌آی',
  deepseek: 'دیپ‌سیک',
  mistral: 'میسترال',
  openrouter: 'اوپن‌روتر',
  gemini: 'جیمینای',
  anthropic: 'آنتروپیک کلود',
};

export default function AdminSettings() {
  // Cheap current-state hints (best-effort; cards render regardless).
  const [hints, setHints] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      const results = await Promise.allSettled([
        api.get<Record<string, unknown>>('/api/v1/admin/settings/general'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/ai'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/referral'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/security'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/gold'),
      ]);
      if (!alive) return;
      const [general, ai, referral, security, gold] = results;
      if (general.status === 'fulfilled') {
        const name = strField(general.value.siteNameFa).trim();
        const maint = boolField(general.value.maintenanceEnabled);
        if (maint) next.general = 'حالت تعمیر و نگهداری فعال است';
        else if (name) next.general = `نام سایت: ${name}`;
      }
      if (ai.status === 'fulfilled') {
        const p = strField(ai.value.default_provider);
        const bits: string[] = [];
        bits.push(p ? `سرویس‌دهندهٔ فعلی: ${AI_PROVIDER_TITLE[p] ?? p}` : 'سرویس‌دهندهٔ پیش‌فرض سیستم');
        if (boolField(ai.value.hasApiKey)) bits.push('کلید ذخیره‌شده');
        else bits.push('کلید محیط سرور');
        next.ai = bits.join(' · ');
      }
      if (referral.status === 'fulfilled') {
        if (referral.value.enabled === false) {
          next.referral = 'سیستم زیرمجموعه‌گیری خاموش است';
        } else {
          const bits: string[] = [];
          const pts = Number(referral.value.registerRewardPoints);
          if (Number.isFinite(pts)) bits.push(`امتیاز ثبت‌نام: ${faNumber(pts)}`);
          const pct = Number(referral.value.firstPurchasePercent);
          if (Number.isFinite(pct)) bits.push(`خرید اول: ${faNumber(pct)}٪`);
          if (bits.length) next.referral = bits.join(' · ');
        }
      }
      if (security.status === 'fulfilled') {
        const flags: string[] = [];
        if (security.value.registrationEnabled === false) flags.push('ثبت‌نام خاموش');
        if (security.value.captchaEnabled === false) flags.push('کپچا خاموش');
        if (flags.length) next.security = flags.join(' · ');
      }
      if (gold.status === 'fulfilled') {
        const src = strField(gold.value.defaultSourceUrl).trim();
        const bits = [src ? 'منبع پیش‌فرض تنظیم شده است' : 'منبع پیش‌فرض سیستمی'];
        const mins = Number(gold.value.defaultFrequencyMinutes);
        if (Number.isFinite(mins) && mins > 0) bits.push(`به‌روزرسانی هر ${faNumber(mins)} دقیقه`);
        next.gold = bits.join(' · ');
      }
      setHints(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="adm-page-head">
        <h2>مرکز تنظیمات</h2>
        <p>تنظیمات سامانه به تفکیک دسته — هر بخش صفحهٔ اختصاصی خودش را دارد</p>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="adm-settings-group">
          <h3 className="adm-subhead">{g.title}</h3>
          <div className="adm-settings-grid">
            {g.cards.map((c) => {
              const hint = c.hintKey ? hints[c.hintKey] : undefined;
              return (
                <Link key={c.to} to={c.to} className="adm-settings-card">
                  <span className="adm-settings-card__icon" aria-hidden="true">
                    <NavIcon name={c.icon} size={20} />
                  </span>
                  <strong>{c.title}</strong>
                  <p>{c.desc}</p>
                  {hint && <span className="adm-settings-card__hint">{hint}</span>}
                  <span className="adm-settings-card__go">مشاهده و ویرایش ‹</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
