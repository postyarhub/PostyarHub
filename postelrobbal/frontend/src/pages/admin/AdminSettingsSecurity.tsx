import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { errText, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* امنیت — registration + captcha switches (Task 17-b; round 18-c      */
/* polish: the two controls now live in labeled fieldsets, logic and   */
/* labels unchanged). GET/PUT /admin/settings/security →               */
/* { registrationEnabled, captchaEnabled }. Public mirror:             */
/* GET /settings/security.                                             */
/* ------------------------------------------------------------------ */

export default function AdminSettingsSecurity() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [captchaEnabled, setCaptchaEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/security');
        if (!alive) return;
        setRegistrationEnabled(d.registrationEnabled !== false);
        setCaptchaEnabled(d.captchaEnabled !== false);
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات امنیت ناموفق بود.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/security', { registrationEnabled, captchaEnabled });
      toast.success('تنظیمات امنیت ذخیره شد.');
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات امنیت ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>امنیت</h2>
        <p>کنترل ثبت‌نام کاربران جدید و کپچای امنیتی</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات امنیت با موفقیت ذخیره شد.</span>
        </div>
      )}

      {!registrationEnabled && (
        <div className="adm-note adm-note--warning" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>
            ثبت‌نام کاربران جدید خاموش است؛ تا فعال‌سازی مجدد، هیچ‌کس نمی‌تواند حساب بسازد. کاربران فعلی و ورود آن‌ها تحت تأثیر قرار نمی‌گیرد.
          </span>
        </div>
      )}

      <Card>
        <fieldset className="adm-fset">
          <legend>ثبت‌نام کاربران</legend>
          <div className="adm-inline-row">
            <div>
              <div className="adm-inline-row__title">ثبت‌نام کاربران جدید</div>
              <div className="adm-inline-row__desc">
                اجازهٔ ساخت حساب رایگان در صفحهٔ ورود. در زمان‌های خاص (مثل کمپین‌های محدود) می‌توانید آن را خاموش کنید.
              </div>
            </div>
            <Toggle checked={registrationEnabled} onChange={setRegistrationEnabled} label="ثبت‌نام کاربران جدید" />
          </div>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>کپچای امنیتی</legend>
          <div className="adm-inline-row">
            <div>
              <div className="adm-inline-row__title">کپچای امنیتی در ورود و ثبت‌نام</div>
              <div className="adm-inline-row__desc">
                کد امنیتی تصویری برای جلوگیری از ثبت‌نام و ورود ربات‌ها؛ هر کد فقط یک‌بار قابل استفاده است.
              </div>
            </div>
            <Toggle checked={captchaEnabled} onChange={setCaptchaEnabled} label="کپچای امنیتی" />
          </div>
        </fieldset>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییرات بلافاصله برای همهٔ بازدیدکنندگان اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
