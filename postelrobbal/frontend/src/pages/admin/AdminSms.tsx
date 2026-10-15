import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { asObject, boolField, errText, strField, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* پیامک — enable toggle + provider picker with per-provider settings  */
/* reveal (سامانهٔ پیامکی / ملی پیامک / کاوه‌نگار / قاصدک) (Task 16-b).        */
/* ------------------------------------------------------------------ */

type SmsProviderKey = 'smsir' | 'melipayamak' | 'kavenegar' | 'ghasedak';

const SMS_PROVIDERS: Array<{ key: SmsProviderKey; title: string; desc: string; badge?: string }> = [
  { key: 'smsir', title: 'اس‌ام‌اس آی‌آر', desc: 'سرویس پیامک سامانهٔ پیامکی', badge: 'پیش‌فرض' },
  { key: 'melipayamak', title: 'ملی پیامک', desc: 'سرویس پیامک ملی پیامک' },
  { key: 'kavenegar', title: 'کاوه‌نگار', desc: 'سرویس پیامک کاوه‌نگار' },
  { key: 'ghasedak', title: 'قاصدک', desc: 'سرویس پیامک قاصدک' },
];

interface SmsState {
  enabled: boolean;
  provider: SmsProviderKey;
  smsir: { apiKey: string; line: string; otpTemplateId: string };
  melipayamak: { username: string; password: string; from: string };
  kavenegar: { apiKey: string; from: string };
  ghasedak: { apiKey: string; line: string };
}

const EMPTY: SmsState = {
  enabled: false,
  provider: 'smsir',
  smsir: { apiKey: '', line: '', otpTemplateId: '' },
  melipayamak: { username: '', password: '', from: '' },
  kavenegar: { apiKey: '', from: '' },
  ghasedak: { apiKey: '', line: '' },
};

const KEYS: Array<SmsProviderKey> = ['smsir', 'melipayamak', 'kavenegar', 'ghasedak'];

export default function AdminSms() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SmsState>(EMPTY);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/sms');
        if (!alive) return;
        const configs = asObject(d.configs);
        const read = (key: SmsProviderKey): Record<string, string> => {
          const o = asObject(configs[key]);
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(o)) out[k] = strField(v);
          return out;
        };
        setState({
          enabled: boolField(d.enabled),
          provider: KEYS.includes(d.provider as SmsProviderKey) ? (d.provider as SmsProviderKey) : 'smsir',
          smsir: {
            apiKey: read('smsir').apiKey ?? '',
            line: read('smsir').line ?? '',
            otpTemplateId: read('smsir').otpTemplateId ?? '',
          },
          melipayamak: {
            username: read('melipayamak').username ?? '',
            password: read('melipayamak').password ?? '',
            from: read('melipayamak').from ?? '',
          },
          kavenegar: { apiKey: read('kavenegar').apiKey ?? '', from: read('kavenegar').from ?? '' },
          ghasedak: { apiKey: read('ghasedak').apiKey ?? '', line: read('ghasedak').line ?? '' },
        });
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات پیامک ناموفق بود.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchSmsir = (patch: Partial<SmsState['smsir']>) =>
    setState((prev) => ({ ...prev, smsir: { ...prev.smsir, ...patch } }));
  const patchMelipayamak = (patch: Partial<SmsState['melipayamak']>) =>
    setState((prev) => ({ ...prev, melipayamak: { ...prev.melipayamak, ...patch } }));
  const patchKavenegar = (patch: Partial<SmsState['kavenegar']>) =>
    setState((prev) => ({ ...prev, kavenegar: { ...prev.kavenegar, ...patch } }));
  const patchGhasedak = (patch: Partial<SmsState['ghasedak']>) =>
    setState((prev) => ({ ...prev, ghasedak: { ...prev.ghasedak, ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/sms', {
        enabled: state.enabled,
        provider: state.provider,
        configs: {
          smsir: state.smsir,
          melipayamak: state.melipayamak,
          kavenegar: state.kavenegar,
          ghasedak: state.ghasedak,
        },
      });
      toast.success('تنظیمات پیامک ذخیره شد.');
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات پیامک ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>پیامک</h2>
        <p>سرویس پیامک برای ارسال کد تأیید و اطلاع‌رسانی‌ها</p>
      </div>

      <Card>
        <div className="adm-inline-row" style={{ paddingTop: 0 }}>
          <div>
            <div className="adm-inline-row__title">فعال‌سازی سرویس پیامک</div>
            <div className="adm-inline-row__desc">در صورت غیرفعال بودن، هیچ پیامکی از سامانه ارسال نمی‌شود.</div>
          </div>
          <Toggle checked={state.enabled} onChange={(v) => setState((prev) => ({ ...prev, enabled: v }))} label="فعال‌سازی سرویس پیامک" />
        </div>

        <div className="adm-card-head" style={{ marginTop: 16 }}>
          <strong>سرویس‌دهندهٔ پیامک</strong>
        </div>
        <div className="adm-picker" role="radiogroup" aria-label="انتخاب سرویس‌دهندهٔ پیامک">
          {SMS_PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={state.provider === p.key}
              className={`adm-picker__tile${state.provider === p.key ? ' is-active' : ''}`}
              onClick={() => setState((prev) => ({ ...prev, provider: p.key }))}
            >
              <span className="adm-picker__title">
                {p.title}
                {p.badge && <Badge tone="muted">{p.badge}</Badge>}
                {state.provider === p.key && <Badge tone="brand">فعال</Badge>}
              </span>
              <span className="adm-picker__desc">{p.desc}</span>
            </button>
          ))}
        </div>

        {/* Per-provider settings reveal */}
        <div className="adm-reveal">
          {state.provider === 'smsir' && (
            <>
              <Field label="کلید رابط برنامه‌نویسی" hint="کلید رابط برنامه‌نویسی از پنل پیامکی">
                <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={state.smsir.apiKey} onChange={(e) => patchSmsir({ apiKey: e.target.value })} />
              </Field>
              <Field label="خط ارسال" hint="شمارهٔ خط ارسال پیامک">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.smsir.line} onChange={(e) => patchSmsir({ line: e.target.value })} placeholder="+98..." />
              </Field>
              <Field label="شناسهٔ قالب کد یکبارمصرف" hint="شناسهٔ قالب تأیید پیامکی در پنل سامانهٔ پیامکی">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.smsir.otpTemplateId} onChange={(e) => patchSmsir({ otpTemplateId: e.target.value })} />
              </Field>
            </>
          )}
          {state.provider === 'melipayamak' && (
            <>
              <Field label="نام کاربری">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.melipayamak.username} onChange={(e) => patchMelipayamak({ username: e.target.value })} />
              </Field>
              <Field label="رمز عبور">
                <Input type="password" dir="ltr" style={{ textAlign: 'left' }} value={state.melipayamak.password} onChange={(e) => patchMelipayamak({ password: e.target.value })} autoComplete="new-password" />
              </Field>
              <Field label="شمارهٔ فرستنده">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.melipayamak.from} onChange={(e) => patchMelipayamak({ from: e.target.value })} placeholder="+98..." />
              </Field>
            </>
          )}
          {state.provider === 'kavenegar' && (
            <>
              <Field label="کلید رابط برنامه‌نویسی">
                <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={state.kavenegar.apiKey} onChange={(e) => patchKavenegar({ apiKey: e.target.value })} />
              </Field>
              <Field label="شمارهٔ فرستنده">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.kavenegar.from} onChange={(e) => patchKavenegar({ from: e.target.value })} placeholder="+98..." />
              </Field>
            </>
          )}
          {state.provider === 'ghasedak' && (
            <>
              <Field label="کلید رابط برنامه‌نویسی">
                <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={state.ghasedak.apiKey} onChange={(e) => patchGhasedak({ apiKey: e.target.value })} />
              </Field>
              <Field label="خط ارسال">
                <Input dir="ltr" style={{ textAlign: 'left' }} value={state.ghasedak.line} onChange={(e) => patchGhasedak({ line: e.target.value })} placeholder="+98..." />
              </Field>
            </>
          )}
        </div>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">کلیدهای همهٔ سرویس‌دهنده‌ها ذخیره می‌شوند؛ سرویس فعال همان انتخاب بالا است.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
