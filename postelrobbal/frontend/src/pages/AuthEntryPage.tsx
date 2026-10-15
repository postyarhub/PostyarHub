import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthModal } from '../components/AuthModal';
import { Logo } from '../components/Logo';
import '../styles/auth-entry.css';

type AuthMode = 'login' | 'register' | 'forgot';

export default function AuthEntryPage({ initialMode }: { initialMode: 'login' | 'register' }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const navigate = useNavigate();

  useEffect(() => setMode(initialMode), [initialMode]);

  useEffect(() => {
    const previousTitle = document.title;
    let robotsMeta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const hadRobotsMeta = Boolean(robotsMeta);
    const previousRobots = robotsMeta?.content ?? '';
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.name = 'robots';
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.content = 'noindex,nofollow';
    document.title = mode === 'register' ? 'ساخت حساب | پُست‌یار' : mode === 'forgot' ? 'بازیابی رمز عبور | پُست‌یار' : 'ورود | پُست‌یار';
    return () => {
      document.title = previousTitle;
      if (hadRobotsMeta && robotsMeta) robotsMeta.content = previousRobots;
      else robotsMeta?.remove();
    };
  }, [mode]);

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    if (nextMode === 'login' || nextMode === 'register') navigate(nextMode === 'login' ? '/login' : '/register', { replace: true });
  };

  return (
    <div className={`auth-entry auth-entry--${initialMode}`} dir="rtl">
      <div className="auth-entry__ambient" aria-hidden="true"><span /><span /><span /></div>
      <header className="auth-entry__header">
        <Link to="/" className="auth-entry__brand" aria-label="پُست‌یار، صفحهٔ اصلی"><Logo size={38} /> <span>پُست‌یار</span></Link>
        <Link to="/" className="auth-entry__back">بازگشت به سایت <span aria-hidden="true">←</span></Link>
      </header>
      <main className="auth-entry__main">
        <section className="auth-entry__story">
          <span className="auth-entry__eyebrow">فضای کاری محتوای شما</span>
          <h1>{mode === 'login' ? 'به فضای کاری پُست‌یار برگردید' : mode === 'register' ? 'مدیریت محتوای خود را از اینجا شروع کنید' : 'رمز عبور خود را بازیابی کنید'}</h1>
          <p>{mode === 'login' ? 'وارد حساب خود شوید و روند انتشار، کانال‌های متصل و زمان‌بندی محتوا را ادامه دهید.' : mode === 'register' ? 'حساب خود را بسازید و ابزارهای مدیریت و برنامه‌ریزی محتوا را در یک محیط فارسی بررسی کنید.' : 'برای بازیابی دسترسی، اطلاعات حساب خود را در فرم زیر وارد کنید.'}</p>
          <div className="auth-entry__visual">
            <img src="/images/help-real/dashboard-hero.webp" alt="نمای واقعی پنل مدیریت محتوای پُست‌یار" width={1440} height={900} loading="eager" decoding="async" />
            <span className="auth-entry__visual-chip"><i aria-hidden="true" /> فضای کاری یکپارچه</span>
          </div>
          <div className="auth-entry__trust"><span>✓</span> فرم ورود و ثبت‌نام امن با کد امنیتی</div>
        </section>
        <section className="auth-entry__form" aria-label={mode === 'login' ? 'ورود به حساب' : mode === 'register' ? 'ساخت حساب' : 'بازیابی رمز عبور'}>
          <AuthModal open={true} mode={mode} onModeChange={handleModeChange} onClose={() => navigate('/', { replace: true })} />
        </section>
      </main>
      <footer className="auth-entry__footer"><span>© پُست‌یار</span><span>دسترسی امن به فضای کاری محتوای شما</span><Link to="/privacy/">حریم خصوصی</Link><Link to="/terms/">قوانین و مقررات</Link></footer>
    </div>
  );
}
