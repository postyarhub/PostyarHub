import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Field, Input } from './ui';
import { CaptchaField, type CaptchaHandle, type CaptchaValue } from './CaptchaField';
import { api, setCsrfToken, ApiRequestError, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { toLatinDigits } from '../lib/format';

interface AuthModalProps {
  open: boolean;
  mode: 'login' | 'register' | 'forgot';
  onModeChange: (mode: 'login' | 'register' | 'forgot') => void;
  onClose: () => void;
}

const BUSINESS_TYPES = [
  'فروشگاهی', 'خدماتی', 'آموزشی', 'رسانه‌ای و خبری', 'فناوری اطلاعات', 'نرخ و بازار مالی', 'سایر',
];

/* Public security settings control whether registration is open.
   CAPTCHA remains a mandatory security requirement and is intentionally not optional. */
interface SecuritySettings {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
}

let securityCache: SecuritySettings | null = null;

export function AuthModal({ open, mode, onModeChange, onClose }: AuthModalProps) {
  const [security, setSecurity] = useState<SecuritySettings | null>(securityCache);

  useEffect(() => {
    if (!open) return;
    if (securityCache) {
      setSecurity(securityCache);
      return;
    }
    let alive = true;
    api
      .get<SecuritySettings>('/api/v1/settings/security')
      .then((d) => {
        const s: SecuritySettings = {
          registrationEnabled: d.registrationEnabled !== false,
          captchaEnabled: d.captchaEnabled !== false,
        };
        securityCache = s;
        if (alive) setSecurity(s);
      })
      .catch(() => undefined); // endpoint failed → keep both enabled (current behavior)
    return () => {
      alive = false;
    };
  }, [open]);

  // CAPTCHA is mandatory for login/register/password recovery. Keep this hard requirement
  // independent of the optional legacy settings endpoint so the working CAPTCHA path cannot regress.
  const captchaEnabled = true;
  const registrationEnabled = security?.registrationEnabled ?? true;

  return (
    <Modal open={open} onClose={onClose} title={mode === 'login' ? 'ورود به حساب کاربری' : mode === 'register' ? 'ساخت حساب جدید' : 'بازیابی رمز عبور'}>
      {/* key={mode} → fresh captcha challenge whenever the form switches */}
      {mode === 'login' && <LoginForm key="login" onModeChange={onModeChange} onClose={onClose} captchaEnabled={captchaEnabled} />}
      {mode === 'register' && <RegisterForm key="register" onModeChange={onModeChange} onClose={onClose} captchaEnabled={captchaEnabled} registrationEnabled={registrationEnabled} />}
      {mode === 'forgot' && <ForgotForm onModeChange={onModeChange} captchaEnabled={captchaEnabled} />}
    </Modal>
  );
}

function LoginForm({ onModeChange, onClose, captchaEnabled }: { onModeChange: (m: 'login' | 'register' | 'forgot') => void; onClose: () => void; captchaEnabled: boolean }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaValue | null>(null);
  const [captchaError, setCaptchaError] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (captchaEnabled && (!captcha?.captchaId || !captcha.captchaText.trim())) {
      setCaptchaError('کد امنیتی را وارد کنید.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { identifier, password };
      if (captchaEnabled && captcha) {
        payload.captchaId = captcha.captchaId;
        payload.captchaText = captcha.captchaText;
      }
      const data = await api.post<MeResponse>('/api/v1/auth/login', payload);
      setCsrfToken(data.csrfToken);
      await refresh();
      onClose();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'ورود ناموفق بود.';
      // Every failed attempt consumed the one-time challenge → always refresh;
      // captcha-specific errors also show inline on the field (item 15)
      if (captchaEnabled) {
        captchaRef.current?.refresh();
        setCaptcha(null);
      }
      if (msg.includes('کد امنیتی')) {
        setCaptchaError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="ایمیل یا شمارهٔ موبایل" required>
        <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
      </Field>
      <Field label="رمز عبور" required>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      {captchaEnabled && (
        <CaptchaField
          ref={captchaRef}
          onChange={(v) => {
            setCaptcha(v);
            setCaptchaError('');
          }}
          invalidToken={captchaError}
        />
      )}
      {error && <p className="field-error" style={{ marginBottom: 10 }} role="alert">{error}</p>}
      <Button type="submit" block loading={busy}>ورود</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13 }}>
        <button type="button" className="btn-soft" style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 600 }} onClick={() => onModeChange('forgot')}>
          رمز عبور را فراموش کرده‌اید؟
        </button>
        <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 600 }} onClick={() => onModeChange('register')}>
          ساخت حساب جدید
        </button>
      </div>
    </form>
  );
}

function RegisterForm({ onModeChange, onClose, captchaEnabled, registrationEnabled }: { onModeChange: (m: 'login' | 'register' | 'forgot') => void; onClose: () => void; captchaEnabled: boolean; registrationEnabled: boolean }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', mobile: '', email: '', businessName: '', businessType: BUSINESS_TYPES[0], password: '', passwordRepeat: '', referralCode: '',
  });
  const [captcha, setCaptcha] = useState<CaptchaValue | null>(null);
  const [captchaError, setCaptchaError] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const referralFromUrl = new URLSearchParams(window.location.search).get('ref') ?? '';
  useEffect(() => {
    if (referralFromUrl) setForm((f) => f.referralCode ? f : { ...f, referralCode: referralFromUrl.slice(0, 32) });
  }, [referralFromUrl]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate(): boolean {
    if (!registrationEnabled) return false;
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = 'نام را وارد کنید.';
    if (!form.lastName.trim()) errs.lastName = 'نام خانوادگی را وارد کنید.';
    if (!/^09\d{9}$/.test(toLatinDigits(form.mobile).replace(/\s/g, ''))) errs.mobile = 'شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) errs.email = 'ایمیل معتبر نیست.';
    if (!form.businessName.trim()) errs.businessName = 'نام کسب‌وکار را وارد کنید.';
    if (form.referralCode.trim().length > 32) errs.referralCode = 'کد معرف نامعتبر است.';
    if (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) errs.password = 'رمز عبور باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد.';
    if (form.password !== form.passwordRepeat) errs.passwordRepeat = 'تکرار رمز عبور مطابقت ندارد.';
    if (!acceptTerms) errs.acceptTerms = 'پذیرش قوانین الزامی است.';
    let valid = Object.keys(errs).length === 0;
    if (captchaEnabled && (!captcha?.captchaId || !captcha.captchaText.trim())) {
      setCaptchaError('کد امنیتی را وارد کنید.');
      valid = false;
    }
    setErrors(errs);
    return valid;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!registrationEnabled) return;
    if (!validate()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        mobile: toLatinDigits(form.mobile).replace(/\s/g, ''),
        acceptTerms,
        ...(form.referralCode.trim() ? { referralCode: form.referralCode.trim() } : {}),
      };
      if (captchaEnabled && captcha) {
        payload.captchaId = captcha.captchaId;
        payload.captchaText = captcha.captchaText;
      }
      const data = await api.post<MeResponse>('/api/v1/auth/register', payload);
      setCsrfToken(data.csrfToken);
      await refresh();
      toast.success('حساب شما با موفقیت ساخته شد. خوش آمدید!');
      onClose();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'ثبت‌نام ناموفق بود.';
      // Every failed attempt consumed the one-time challenge → always refresh;
      // captcha-specific errors also show inline on the field (item 15)
      if (captchaEnabled) {
        captchaRef.current?.refresh();
        setCaptcha(null);
      }
      if (msg.includes('کد امنیتی')) {
        setCaptchaError(msg);
      } else {
        setErrors({ form: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="نام" required error={errors.firstName}>
          <Input value={form.firstName} onChange={set('firstName')} error={!!errors.firstName} />
        </Field>
        <Field label="نام خانوادگی" required error={errors.lastName}>
          <Input value={form.lastName} onChange={set('lastName')} error={!!errors.lastName} />
        </Field>
      </div>
      <Field label="موبایل" required error={errors.mobile}>
        <Input value={form.mobile} onChange={set('mobile')} inputMode="tel" placeholder="۰۹۱۲۳۴۵۶۷۸۹" error={!!errors.mobile} />
      </Field>
      <Field label="ایمیل" required error={errors.email}>
        <Input type="email" value={form.email} onChange={set('email')} error={!!errors.email} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="نام کسب‌وکار" required error={errors.businessName}>
          <Input value={form.businessName} onChange={set('businessName')} error={!!errors.businessName} />
        </Field>
        <Field label="نوع فعالیت" required>
          <select className="select" value={form.businessType} onChange={set('businessType')}>
            {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <Field label="کد معرف" error={errors.referralCode} hint="اختیاری؛ در صورت داشتن کد معرف وارد کنید">
        <Input value={form.referralCode} onChange={set('referralCode')} error={!!errors.referralCode} maxLength={32} autoComplete="off" placeholder="کد معرف" />
      </Field>
      <Field label="رمز عبور" required error={errors.password} hint="حداقل ۸ کاراکتر شامل حرف و عدد">
        <Input type="password" value={form.password} onChange={set('password')} error={!!errors.password} autoComplete="new-password" />
      </Field>
      <Field label="تکرار رمز عبور" required error={errors.passwordRepeat}>
        <Input type="password" value={form.passwordRepeat} onChange={set('passwordRepeat')} error={!!errors.passwordRepeat} autoComplete="new-password" />
      </Field>
      {!registrationEnabled && (
        <div
          role="alert"
          style={{
            background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid rgba(217, 119, 6, 0.25)',
            borderRadius: 12, padding: '11px 14px', fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', gap: 9,
          }}
        >
          <span aria-hidden="true">⚠️</span>
          <span>ثبت‌نام موقتاً غیرفعال است.</span>
        </div>
      )}
      {captchaEnabled && (
        <CaptchaField
          ref={captchaRef}
          onChange={(v) => {
            setCaptcha(v);
            setCaptchaError('');
          }}
          invalidToken={captchaError}
        />
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} style={{ marginTop: 4 }} />
        <span>
          <a href="/terms" target="_blank" rel="noreferrer">قوانین و مقررات</a> پُست‌یار را می‌پذیرم.
          {errors.acceptTerms && <span className="field-error"> {errors.acceptTerms}</span>}
        </span>
      </label>
      {errors.form && <p className="field-error" style={{ marginBottom: 10 }} role="alert">{errors.form}</p>}
      <Button type="submit" block loading={busy} disabled={!registrationEnabled}>ساخت حساب رایگان</Button>
      <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
        حساب دارید؟{' '}
        <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 600 }} onClick={() => onModeChange('login')}>
          وارد شوید
        </button>
      </div>
    </form>
  );
}

function ForgotForm({ onModeChange, captchaEnabled }: { onModeChange: (m: 'login' | 'register' | 'forgot') => void; captchaEnabled: boolean }) {
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaValue | null>(null);
  const [captchaError, setCaptchaError] = useState('');
  const [requestError, setRequestError] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (captchaEnabled && (!captcha?.captchaId || !captcha.captchaText.trim())) {
      setCaptchaError('کد امنیتی را وارد کنید.');
      return;
    }
    setBusy(true);
    setCaptchaError('');
    setRequestError('');
    try {
      const payload: Record<string, unknown> = { email };
      if (captchaEnabled && captcha) {
        payload.captchaId = captcha.captchaId;
        payload.captchaText = captcha.captchaText;
      }
      await api.post('/api/v1/auth/password-reset', payload);
      setSent(true);
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : '';
      if (captchaEnabled) {
        captchaRef.current?.refresh();
        setCaptcha(null);
      }
      if (msg.includes('کد امنیتی')) {
        setCaptchaError(msg);
        setRequestError('');
      } else {
        // Surface infrastructure failures without revealing whether an account exists.
        setRequestError('در حال حاضر درخواست بازیابی انجام نشد. چند دقیقه دیگر دوباره تلاش کنید.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden="true">📧</div>
        <p style={{ color: 'var(--text-2)', marginBottom: 18 }}>
          اگر این ایمیل در سیستم ثبت باشد، راهنمای بازیابی برای شما ارسال می‌شود.
        </p>
        <Button variant="ghost" onClick={() => onModeChange('login')}>بازگشت به ورود</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="ایمیل حساب کاربری" required>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      {captchaEnabled && <CaptchaField
        ref={captchaRef}
        onChange={(v) => {
          setCaptcha(v);
          setCaptchaError('');
        }}
        invalidToken={captchaError}
      />}
      {requestError && <p role="alert" className="field-error" style={{ margin: '0 0 14px', lineHeight: 1.8 }}>{requestError}</p>}
      <Button type="submit" block loading={busy}>ارسال راهنمای بازیابی</Button>
      <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
        <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 600 }} onClick={() => onModeChange('login')}>
          بازگشت به ورود
        </button>
      </div>
    </form>
  );
}
