import { useEffect, useRef, useState, type ReactNode } from 'react';
import { faDigits, faMoney } from '../lib/format';
import type { PlanDto } from '../lib/api';
import { NavIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import { BaleIcon, RubikaIcon, TelegramIcon } from '../components/PlatformIcons';
import { FeatureArt, FEATURE_GRADIENTS, type FeatureArtName } from '../components/FeatureArt';

/* ------------------------------------------------------------------ */
/* Landing 2026 — Task 14-a. Persian RTL, self-contained CSS/SVG art,  */
/* scroll-reveal via IntersectionObserver, counters, FAQ accordion.    */
/* Auth entry points use dedicated routes so static and SPA pages share the same destination. */
/* ------------------------------------------------------------------ */

const FEATURES: Array<{ icon: FeatureArtName; title: string; text: string }> = [
  { icon: 'channels', title: 'مدیریت کانال‌ها', text: 'کانال‌های متصل را در یک پنل مدیریت کنید، روش اتصال، تأیید دسترسی و سقف استفاده به هر پیام‌رسان و پلن فعال وابسته است.' },
  { icon: 'posts', title: 'انتشار هم‌زمان', text: 'یک پست بنویسید و هم‌زمان در همهٔ کانال‌های انتخابی‌تان منتشر کنید.' },
  { icon: 'clock', title: 'زمان‌بندی خودکار', text: 'پست‌ها را با تقویم شمسی زمان‌بندی کنید و وضعیت ارسال را پیگیری کنید، تحویل نهایی به وضعیت پیام‌رسان مقصد نیز وابسته است.' },
  { icon: 'bots', title: 'ربات‌ساز بدون کدنویسی', text: 'ربات بسازید، دستور و پاسخ تعریف کنید و گردش‌کارهای خودکار طراحی کنید.' },
  { icon: 'ai', title: 'هوش مصنوعی', text: 'کپشن‌های حرفه‌ای بنویسید و پاسخگوی هوشمند به مشتریان داشته باشید.' },
  { icon: 'analytics', title: 'تحلیل آمار کامل', text: 'گزارش وضعیت و آمار قابل دریافت از پست‌ها و کانال‌ها را در پنل بررسی کنید.' },
];

const STEPS = [
  { n: '۱', title: 'ثبت‌نام کنید', text: 'در کمتر از یک دقیقه حساب رایگان بسازید.' },
  { n: '۲', title: 'کانال‌ها را وصل کنید', text: 'روش اتصال و سطح دسترسی هر پیام‌رسان را مطابق مراحل نمایش‌داده‌شده در پنل انجام دهید.' },
  { n: '۳', title: 'بسازید و منتشر کنید', text: 'پست بنویسید، مقصدها را انتخاب کنید و الان یا زمان‌بندی‌شده منتشر کنید.' },
];

const FAQ = [
  { q: 'آیا برای ساخت ربات باید برنامه‌نویسی بلد باشم؟', a: 'خیر. پُست‌یار همهٔ کارها را بدون حتی یک خط کد انجام می‌دهد، ربات را با توکن رسمی پیام‌رسان وصل می‌کنید و همه‌چیز از پنل مدیریت می‌شود.' },
  { q: 'پست‌های زمان‌بندی‌شده چطور ارسال می‌شوند؟', a: 'پُست‌یار از صف ارسال و گزارش وضعیت استفاده می‌کند تا ارسال‌های در حال پردازش یا ناموفق را پیگیری کنید، تحویل نهایی به دسترس‌پذیری و محدودیت‌های پیام‌رسان مقصد نیز وابسته است.' },
  { q: 'روبیکا واقعاً پشتیبانی می‌شود؟', a: 'پُست‌یار مسیر اتصال روبیکا را در پنل ارائه می‌کند، اتصال کامل به روش پشتیبانی‌شده، وضعیت کانال و مجوزهای لازم وابسته است. اگر تأیید شناسایی انجام نشد، کانال را فعال فرض نکنید و از پشتیبانی کمک بگیرید.' },
  { q: 'اگر ارسال پیامی شکست بخورد چه می‌شود؟', a: 'وضعیت دقیق هر ارسال (موفق، در حال تلاش مجدد، ناموفق) را با دلیل آن می‌بینید و می‌توانید ارسال ناموفق را دوباره اجرا کنید.' },
];



/** Fade+rise scroll reveal (staggered via `delay`). */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -36px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`ln-reveal${inView ? ' ln-reveal--in' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Smooth-height FAQ accordion (grid-rows transition, CSS-driven). */
function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="ln-faq">
      {FAQ.map((f, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={f.q} className={`ln-faq__item${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="ln-faq__q"
              id={`faq-q-${i}`}
              aria-expanded={isOpen}
              aria-controls={`faq-a-${i}`}
              onClick={() => setOpenIdx(isOpen ? null : i)}
            >
              <span>{f.q}</span>
              <svg className="ln-faq__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div className="ln-faq__a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
              <div className="ln-faq__a-inner"><p>{f.a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Plans from GET /api/v1/subscriptions/plans (same endpoint/shape as before),
 *  with loading skeleton and graceful fallback when the API is unreachable. */
function PricingGrid() {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/subscriptions/plans', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('plans-unavailable'))))
      .then((j: { data?: { plans?: PlanDto[] } }) => {
        if (!cancelled) setPlans(j.data?.plans ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error || (plans !== null && plans.length === 0)) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-2)', margin: 0 }}>
        برای مشاهدهٔ تعرفه‌ها و ثبت‌نام، وارد پنل کاربری شوید.
      </p>
    );
  }

  if (plans === null) {
    return (
      <div className="ln-pricing" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton ln-pricing-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="ln-pricing">
      {plans.map((p, i) => {
        const featured = p.code === 'professional';
        return (
          <Reveal key={p.id} delay={i * 90} className="ln-plan-reveal">
            <div className={`ln-plan${featured ? ' ln-plan--featured' : ''}`}>
              {featured && <span className="ln-plan__flag">پیشنهاد ما</span>}
              <h3 className="ln-plan__name">{p.nameFa}</h3>
              <div className="ln-plan__price">
                {p.priceRial === 0 ? 'رایگان' : faMoney(p.priceRial)}
                {p.priceRial > 0 && <span> / ماهانه</span>}
              </div>
              <ul className="ln-plan__list">
                <li>تا {p.limitsJson.max_channels === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_channels)} کانال`}</li>
                <li>{p.limitsJson.max_posts === 0 ? 'پست نامحدود' : `${faDigits(p.limitsJson.max_posts)} پست در دوره`}</li>
                <li>تا {p.limitsJson.max_bots === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_bots)}`} ربات</li>
                <li className={p.featuresJson.gold_ticker ? undefined : 'is-off'}>ربات نرخ لحظه‌ای طلا و سکه</li>
                <li className={p.featuresJson.woocommerce ? undefined : 'is-off'}>اتصال وب‌سایت فروشگاهی</li>
              </ul>
              <a href="/register/" className={`btn ${featured ? 'btn-primary' : 'btn-ghost'} btn-block ln-plan__cta`}>
                {p.priceRial === 0 ? 'شروع رایگان' : 'خرید اشتراک'}
              </a>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

/** Reference-led device composition using only real Postyar screen captures. */
function WordPressMark() {
  return <img src="/images/brand/wordpress-wmark-white.png" alt="" aria-hidden="true" className="ln-brand-logo ln-brand-logo--wordpress" width={320} height={100} loading="eager" decoding="async" />;
}
function WooMark() {
  return <img src="/images/brand/woocommerce-wordmark-white.png" alt="" aria-hidden="true" className="ln-brand-logo ln-brand-logo--woocommerce" width={450} height={90} loading="eager" decoding="async" />;
}
function PlatformMark({ kind, size = 42 }: { kind: string; size?: number }) {
  if (kind === 'telegram') return <TelegramIcon size={size} />;
  if (kind === 'bale') return <BaleIcon size={size} />;
  if (kind === 'rubika') return <RubikaIcon size={size} />;
  if (kind === 'wordpress') return <WordPressMark />;
  return <WooMark />;
}

function HeroArt() {
  return (
    <div className="ln-hero-art" aria-label="تصاویر رابط واقعی پُست‌یار، کاراکتر پُست‌یار و نشان‌های پلتفرم‌های متصل">
      <span className="ln-hero-art__halo ln-hero-art__halo--one" aria-hidden="true" />
      <span className="ln-hero-art__halo ln-hero-art__halo--two" aria-hidden="true" />
      <div className="ln-hero-art__laptop">
        <div className="ln-hero-art__screen">
          <div className="ln-hero-art__windowbar">
            <span className="ln-hero-art__windowdots" aria-hidden="true"><i /><i /><i /></span>
            <Logo size={22} full />
            <span className="ln-hero-art__windowlabel">پنل مدیریت محتوا</span>
          </div>
          <img
            className="ln-hero-art__dashboard"
            src="/images/help-real/hero-posts-real.webp"
            alt="برش مستندات پُست‌یار از فهرست پست‌ها؛ کارت‌های شناور امکانات مدیریت وب‌سایت و کمپین‌ها را معرفی می‌کنند"
            width={1280}
            height={800}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <span className="ln-hero-art__laptop-base" aria-hidden="true" />
      </div>
      <div className="ln-hero-art__phone">
        <div className="ln-hero-art__phone-speaker" aria-hidden="true" />
        <img
          src="/images/help-real/hero-workflow-real.webp"
          alt="برش مستندات رابط پُست‌یار از فرم ساخت گردش‌کار ربات"
          width={755}
          height={1245}
          loading="eager"
          decoding="async"
        />
      </div>
      <img className="ln-hero-art__mascot" src="/images/brand/postyar-hero-640.webp" alt="شخصیت راهنمای پُست‌یار" width={640} height={960} loading="eager" fetchPriority="high" decoding="async" />
      <div className="ln-hero-orbit" aria-hidden="true">
        {HOME_PLATFORM_CARDS.map((platform) => (
          <span
            key={platform.kind}
            className={`ln-hero-orbit__node ln-hero-orbit__node--${platform.kind}`}
            title={platform.name}
          >
            <span className={`ln-hero-orbit__glyph ln-hero-orbit__glyph--${platform.kind}`}>
              <PlatformMark kind={platform.kind} size={30} />
            </span>
          </span>
        ))}
      </div>
      <div className="ln-float-note">
        <span className="ln-float-note__spark" aria-hidden="true">✦</span>
        <span><strong>مدیریت وب‌سایت</strong><small>محصولات، نوشته‌ها و برگه‌ها</small></span>
      </div>
      <div className="ln-float-status">
        <span><small>مرکز کمپین‌ها</small><strong>برنامه‌ریزی و پیگیری اجرا</strong></span>
        <span className="ln-float-status__bars" aria-hidden="true"><i /><i /><i /><i /></span>
      </div>
    </div>
  );
}

const HOME_PLATFORM_CARDS = [
  { kind: 'woocommerce', name: 'ووکامرس', detail: 'فروشگاه آنلاین', available: true },
  { kind: 'wordpress', name: 'وردپرس', detail: 'محتوا و وبلاگ', available: true },
  { kind: 'telegram', name: 'تلگرام', detail: 'کانال و گروه', available: true },
  { kind: 'bale', name: 'بله', detail: 'کانال و گروه', available: true },
  { kind: 'rubika', name: 'روبیکا', detail: 'کانال و گروه', available: true },
];

export default function Landing() {
  return (
    <div className="ln-home">
      <section className="ln-hero" aria-labelledby="landing-title">
        <div className="ln-hero__dots" aria-hidden="true" />
        <span className="ln-orb ln-orb--1" aria-hidden="true" />
        <span className="ln-orb ln-orb--2" aria-hidden="true" />
        <span className="ln-orb ln-orb--3" aria-hidden="true" />
        <div className="ln-hero__layout">
          <div className="ln-hero__inner">
            <span className="ln-badge"><span className="ln-badge__pulse" aria-hidden="true" />مدیریت و زمان‌بندی انتشار محتوا <span aria-hidden="true">✦</span></span>
            <h1 id="landing-title" className="ln-hero__title">
              با <span className="ln-hero__grad">پُست‌یار</span>، انتشار محتوا را منظم کنید
            </h1>
            <p className="ln-hero__sub">
              پست‌ها را در یک فضای فارسی آماده کنید، کانال‌های متصل را انتخاب کنید و زمان انتشار و وضعیت هر ارسال را از همان پنل پیگیری کنید.
            </p>
            <div className="ln-hero__ctas">
              <a href="/register/" className="btn btn-primary btn-lg ln-hero__primary">شروع رایگان <span aria-hidden="true">←</span></a>
              <a href="#how" className="btn btn-ghost btn-lg ln-hero__secondary"><span className="ln-play" aria-hidden="true">▶</span> مشاهده نحوه کار</a>
            </div>
            <div className="ln-hero-benefits" aria-label="مزیت‌های کلیدی">
              <div className="ln-hero-benefit"><span className="ln-hero-benefit__icon"><NavIcon name="posts" size={18} /></span><span><strong>مدیریت محتوا</strong><small>متن و رسانه در یک پنل</small></span></div>
              <div className="ln-hero-benefit"><span className="ln-hero-benefit__icon"><NavIcon name="workflows" size={18} /></span><span><strong>زمان‌بندی انتشار</strong><small>هماهنگ با تقویم شمسی</small></span></div>
              <div className="ln-hero-benefit"><span className="ln-hero-benefit__icon"><NavIcon name="analytics" size={18} /></span><span><strong>مدیریت کمپین‌ها</strong><small>بررسی وضعیت و نتایج</small></span></div>
            </div>
          </div>
          <HeroArt />
        </div>
      </section>

      <section className="ln-platform-section" aria-labelledby="platforms-title">
        <div className="ln-platform-section__head">
          <h2 id="platforms-title">انتشار در تمام پلتفرم‌های محبوب</h2>
          <p>کانال‌ها و یکپارچه‌سازی‌های پُست‌یار را در یک نمای یکپارچه بشناسید.</p>
        </div>
        <div className="ln-platform-grid">
          {HOME_PLATFORM_CARDS.map((p) => (
            <article key={p.kind} className={`ln-platform-card${p.available ? '' : ' is-upcoming'}`}>
              <span className={`ln-platform-card__mark ln-platform-card__mark--${p.kind}`}><PlatformMark kind={p.kind} /></span>
              <strong>{p.name}</strong>
              <span className="ln-platform-card__detail">{p.detail}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="ln-section ln-section--editorial ln-reference-band" aria-label="جریان کاری پُست‌یار">
        <Reveal>
          <div className="ln-editorial-band">
            <div className="ln-editorial-band__visual">
              <img className="ln-editorial-band__screenshot" src="/images/help-real/hero-posts-real.webp" alt="نمای فهرست پست‌ها و مدیریت انتشار در پنل پُست‌یار" width={1280} height={800} loading="lazy" decoding="async" />
              <div className="ln-editorial-band__photo-wrap"><img src="/images/help-real/hero-workflow-real.webp" alt="نمای گردش‌کار ربات در رابط پُست‌یار" width={755} height={1245} loading="lazy" decoding="async" /></div>
            </div>
            <div className="ln-editorial-band__copy">
              <span className="ln-editorial-band__eyebrow">از برنامه‌ریزی تا پیگیری</span>
              <h2>محتوا را برنامه‌ریزی کنید، نتیجه را ببینید</h2>
              <p>مطالب خود را آماده کنید، کانال‌های متصل را انتخاب کنید و زمان انتشار را مشخص کنید. سپس وضعیت ارسال هر مقصد را جداگانه در پنل ببینید.</p>
              <div className="ln-editorial-band__benefits">
                <div><span className="ln-editorial-band__check" aria-hidden="true">✓</span><div><strong>تقویم انتشار</strong><small>زمان انتشار را با تقویم شمسی تنظیم کنید</small></div></div>
                <div><span className="ln-editorial-band__check" aria-hidden="true">✓</span><div><strong>وضعیت ارسال</strong><small>نتیجهٔ هر مقصد را جداگانه ببینید</small></div></div>
                <div><span className="ln-editorial-band__check" aria-hidden="true">✓</span><div><strong>آماده‌سازی محتوا</strong><small>متن و رسانه را پیش از انتشار بررسی کنید</small></div></div>
              </div>
              <div className="ln-editorial-band__actions"><a href="/features/multi-channel-publishing/" className="btn btn-primary">آشنایی با روند انتشار <span aria-hidden="true">←</span></a></div>
            </div>
            <div className="ln-editorial-band__summary" aria-label="ویژگی‌های محیط کاری">
              <div><span>محتوا</span><small>آماده‌سازی متن و رسانه</small></div>
              <div><span>زمان</span><small>برنامه‌ریزی با تقویم شمسی</small></div>
              <div><span>وضعیت</span><small>پیگیری جداگانهٔ هر مقصد</small></div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">امکانات</span>
          <h2 className="ln-section__title">هر آنچه برای انتشار حرفه‌ای نیاز دارید</h2>
          <p className="ln-section__sub">از اتصال کانال تا تحلیل آمار، همه‌چیز یکجا</p>
        </div>
        <div className="ln-features">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 90}>
              <div className="ln-feature" style={{ height: '100%' }}>
                <div className="ln-feature__icon ln-feature__icon--art" style={{ background: FEATURE_GRADIENTS[f.icon] }}>
                  <FeatureArt name={f.icon} />
                </div>
                <h3 className="ln-feature__title">{f.title}</h3>
                <p className="ln-feature__text">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">روش استفاده</span>
          <h2 className="ln-section__title">در ۳ مرحلهٔ ساده شروع کنید</h2>
          <p className="ln-section__sub">بدون دانش فنی، بدون پیچیدگی</p>
        </div>
        <div className="ln-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="ln-step">
                <div className="ln-step__num" aria-hidden="true">{s.n}</div>
                <h3 className="ln-step__title">{s.title}</h3>
                <p className="ln-step__text">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- Advanced integrations ---------- */}
      <section className="ln-section">
        <div className="ln-rows">
          <Reveal>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon ln-row__icon--woocommerce"><img src="/images/brand/woocommerce-wordmark-white.png" alt="" aria-hidden="true" className="ln-brand-logo ln-brand-logo--woocommerce" width={450} height={90} loading="lazy" decoding="async" /></div>
              <div>
                <h3 className="ln-row__title">یکپارچگی با فروشگاه اینترنتی</h3>
                <p className="ln-row__text">برای مدیریت محتوای مرتبط با فروشگاه، مسیر اتصال وردپرس و ووکامرس را بررسی کنید، قابلیت‌های دقیق به تنظیمات و مجوزهای فعال وابسته است.</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon"><NavIcon name="gold" size={22} /></div>
              <div>
                <h3 className="ln-row__title">ربات نرخ لحظه‌ای طلا و سکه</h3>
                <p className="ln-row__text">نرخ طلا، سکه و ارز را به‌صورت خودکار و زمان‌بندی‌شده در کانال شما منتشر کنید.</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon"><NavIcon name="workflows" size={22} /></div>
              <div>
                <h3 className="ln-row__title">اتوماسیون و گردش‌کار</h3>
                <p className="ln-row__text">پاسخ‌های خودکار، دستورهای ربات و گردش‌کارهای چندمرحله‌ای بدون کدنویسی.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section id="pricing" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">تعرفه‌ها</span>
          <h2 className="ln-section__title">تعرفه‌های پُست‌یار</h2>
          <p className="ln-section__sub">با پلن رایگان شروع کنید، هر وقت خواستید ارتقا دهید</p>
        </div>
        <PricingGrid />
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">سؤالات متداول</span>
          <h2 className="ln-section__title">پاسخ پرتکرارترین پرسش‌ها</h2>
        </div>
        <Reveal>
          <Faq />
        </Reveal>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="ln-section ln-section--flush">
        <Reveal>
          <div className="ln-cta">
            <h2 className="ln-cta__title">همین امروز انتشار حرفه‌ای را شروع کنید</h2>
            <p className="ln-cta__sub">حساب رایگان بسازید، بدون نیاز به کارت بانکی.</p>
            <div className="ln-cta__btns">
              <a href="/register/" className="btn btn-primary btn-lg">ساخت حساب رایگان <span aria-hidden="true">←</span></a>
              <a href="/login/" className="btn btn-ghost btn-lg">ورود به حساب</a>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}