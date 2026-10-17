import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { boolField, errText, strField, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* ایمیل — SMTP settings + test email sender (Task 16-b).              */
/* ------------------------------------------------------------------ */

interface EmailState {
  enabled: boolean;
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  passwordConfigured: boolean;
  fromName: string;
  fromEmail: string;
}

const EMPTY: EmailState = { enabled: false, host: '', port: '', secure: true, user: '', pass: '', passwordConfigured: false, fromName: '', fromEmail: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminEmail() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<EmailState>(EMPTY);

  // test email card
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/email');
        if (!alive) return;
        setState({
          enabled: boolField(d.enabled),
          host: strField(d.host),
          port: typeof d.port === 'number' ? String(d.port) : strField(d.port),
          secure: boolField(d.secure),
          user: strField(d.user),
          pass: '',
          passwordConfigured: boolField(d.passwordConfigured),
          fromName: strField(d.fromName),
          fromEmail: strField(d.fromEmail),
        });
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات ایمیل ناموفق بود.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const portNum = Number(toLatinDigits(state.port.trim()));
    if (!state.host.trim()) {
      toast.error('نشانی سرور ارسال را وارد کنید.');
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      toast.error('پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.');
      return;
    }
    setSaving(true);
    try {
      const passwordProvided = state.pass.length > 0;
      await api.put('/api/v1/admin/settings/email', {
        enabled: state.enabled,
        host: state.host.trim(),
        port: portNum,
        secure: state.secure,
        user: state.user.trim(),
        ...(passwordProvided ? { pass: state.pass } : {}),
        fromName: state.fromName.trim(),
        fromEmail: state.fromEmail.trim(),
      });
      setState((prev) => ({ ...prev, pass: '', passwordConfigured: prev.passwordConfigured || passwordProvided }));
      toast.success('تنظیمات ایمیل ذخیره شد.');
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات ایمیل ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const to = testTo.trim();
    if (!EMAIL_RE.test(to)) {
      setTestResult({ ok: false, message: 'نشانی ایمیل مقصد معتبر نیست.' });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      await api.post('/api/v1/admin/settings/email/test', { to });
      setTestResult({ ok: true, message: `ایمیل آزمایشی با موفقیت به ${to} ارسال شد.` });
      toast.success('ایمیل آزمایشی با موفقیت ارسال شد.');
    } catch (err) {
      setTestResult({ ok: false, message: errText(err, 'ارسال ایمیل آزمایشی ناموفق بود.') });
    } finally {
      setTestBusy(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>ایمیل</h2>
        <p>تنظیمات سرور ارسال رایانامهٔ سامانه</p>
      </div>

      <Card>
        <div className="adm-card-head"><strong>تنظیمات سرور ارسال</strong></div>
        <div className="adm-inline-row" style={{ paddingTop: 0 }}>
          <div>
            <div className="adm-inline-row__title">فعال‌سازی ایمیل</div>
            <div className="adm-inline-row__desc">در صورت غیرفعال بودن، هیچ ایمیلی از سامانه ارسال نمی‌شود.</div>
          </div>
          <Toggle checked={state.enabled} onChange={(v) => setState((prev) => ({ ...prev, enabled: v }))} label="فعال‌سازی ایمیل" />
        </div>

        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="سرور ارسال رایانامه" required>
            <Input dir="ltr" style={{ textAlign: 'left' }} value={state.host} onChange={(e) => setState((prev) => ({ ...prev, host: e.target.value }))} placeholder="mail.postyar.ir" />
          </Field>
          <Field label="پورت" required hint="مثلاً ۴۶۵ برای اتصال امن یا ۵۸۷ برای اتصال امن با آغاز ارتباط رمزگذاری‌شده">
            <Input dir="ltr" style={{ textAlign: 'left' }} inputMode="numeric" value={state.port} onChange={(e) => setState((prev) => ({ ...prev, port: e.target.value }))} placeholder="465" />
          </Field>
          <Field label="نام فرستنده">
            <Input value={state.fromName} onChange={(e) => setState((prev) => ({ ...prev, fromName: e.target.value }))} placeholder="پُست‌یار" />
          </Field>
          <Field label="رایانامهٔ فرستنده">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={state.fromEmail} onChange={(e) => setState((prev) => ({ ...prev, fromEmail: e.target.value }))} placeholder="no-reply@postyar.ir" />
          </Field>
          <Field label="نام کاربری سرور ارسال">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={state.user} onChange={(e) => setState((prev) => ({ ...prev, user: e.target.value }))} autoComplete="off" />
          </Field>
          <Field label="رمز عبور سرور ارسال" hint={state.passwordConfigured ? 'رمز قبلی ذخیره شده است؛ برای حفظ آن این فیلد را خالی بگذارید.' : 'رمز SMTP را وارد کنید.'}>
            <Input type="password" dir="ltr" style={{ textAlign: 'left' }} value={state.pass} onChange={(e) => setState((prev) => ({ ...prev, pass: e.target.value }))} autoComplete="new-password" />
          </Field>
        </div>

        <div className="adm-inline-row">
          <div>
            <div className="adm-inline-row__title">اتصال امن</div>
            <div className="adm-inline-row__desc">پورت ۴۶۵: SSL/TLS فعال. پورت ۵۸۷: SSL/TLS غیرفعال و STARTTLS اجباری.</div>
          </div>
          <Toggle checked={state.secure} onChange={(v) => setState((prev) => ({ ...prev, secure: v }))} label="اتصال امن" />
        </div>

        <div style={{ marginTop: 16 }}>
          <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
        </div>
      </Card>

      <Card>
        <div className="adm-card-head"><strong>ارسال ایمیل آزمایشی</strong></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px' }}>
          پیش از اعتماد به تنظیمات، یک ایمیل آزمایشی برای خودتان بفرستید.
        </p>
        <form className="adm-toolbar" onSubmit={(e) => { e.preventDefault(); void sendTest(); }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="ایمیل مقصد را وارد کنید"
              aria-label="نشانی ایمیل مقصد"
            />
          </div>
          <Button type="submit" variant="soft" loading={testBusy}>ارسال ایمیل آزمایشی</Button>
        </form>
        {testResult && (
          <div className={`adm-note ${testResult.ok ? 'adm-note--success' : 'adm-note--danger'}`} role="status">
            <span aria-hidden="true">{testResult.ok ? '✅' : '⛔'}</span>
            <span>{testResult.message}</span>
          </div>
        )}
      </Card>
    </>
  );
}
