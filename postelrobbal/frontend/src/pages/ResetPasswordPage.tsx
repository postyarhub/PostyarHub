import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Input } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token || token.length < 10 || token.length > 200) {
      setError('لینک بازیابی معتبر نیست. دوباره درخواست بازیابی رمز عبور بدهید.');
      return;
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('رمز عبور باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد.');
      return;
    }
    if (password !== repeat) {
      setError('تکرار رمز عبور مطابقت ندارد.');
      return;
    }

    setBusy(true);
    try {
      await api.post<{ ok: true }>('/api/v1/auth/password-reset/confirm', { token, password });
      setDone(true);
      setPassword('');
      setRepeat('');
    } catch (cause) {
      setError(cause instanceof ApiRequestError
        ? cause.message
        : 'بازیابی رمز عبور انجام نشد. لینک ممکن است منقضی شده باشد؛ دوباره درخواست بدهید.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '28px 16px', background: 'var(--surface, #f4f6fb)' }}>
      <div style={{ width: '100%', maxWidth: 470 }}>
        <Link to="/" aria-label="پُست‌یار، صفحهٔ اصلی" style={{ display: 'block', textAlign: 'center', fontSize: 24, fontWeight: 800, color: 'var(--brand, #3949ab)', textDecoration: 'none', marginBottom: 22 }}>
          پُست‌یار
        </Link>
        <Card pad="lg">
          {done ? (
            <section aria-live="polite" style={{ textAlign: 'center', padding: '12px 0' }}>
              <div aria-hidden="true" style={{ fontSize: 42, marginBottom: 12 }}>✓</div>
              <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 12 }}>رمز عبور تغییر کرد</h1>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.9, marginBottom: 22 }}>اکنون می‌توانید با رمز عبور جدید وارد حساب پُست‌یار شوید.</p>
              <Button block onClick={() => navigate('/login', { replace: true })}>ورود به حساب</Button>
            </section>
          ) : (
            <>
              <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 8 }}>بازیابی رمز عبور</h1>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.9, marginBottom: 22, fontSize: 14 }}>
                رمز جدیدی انتخاب کنید. لینک بازیابی یک‌بارمصرف و فقط برای مدت محدودی معتبر است.
              </p>
              {!token && (
                <p role="alert" className="field-error" style={{ marginBottom: 16 }}>
                  توکن بازیابی در لینک وجود ندارد. لطفاً از صفحهٔ ورود، دوباره درخواست بازیابی کنید.
                </p>
              )}
              <form onSubmit={submit} noValidate>
                <Field label="رمز عبور جدید" required hint="حداقل ۸ کاراکتر شامل حرف و عدد">
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    maxLength={128}
                  />
                </Field>
                <Field label="تکرار رمز عبور جدید" required>
                  <Input
                    type="password"
                    value={repeat}
                    onChange={(event) => setRepeat(event.target.value)}
                    autoComplete="new-password"
                    required
                    maxLength={128}
                  />
                </Field>
                {error && <p role="alert" className="field-error" style={{ marginBottom: 14 }}>{error}</p>}
                <Button type="submit" block loading={busy} disabled={!token || busy}>ثبت رمز جدید</Button>
              </form>
              <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13 }}>
                <Link to="/login" style={{ color: 'var(--brand, #3949ab)', fontWeight: 700, textDecoration: 'none' }}>بازگشت به ورود</Link>
              </div>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
