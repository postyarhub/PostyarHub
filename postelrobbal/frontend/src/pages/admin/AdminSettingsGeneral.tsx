import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading, Textarea } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { boolField, errText, strField, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* تنظیمات عمومی — round 18-c: four labeled fieldsets inside one card  */
/* (asovin-style: subheading + description + 2-col grid + save bar).   */
/* GET/PUT /admin/settings/general → full snapshot in / full patch out */
/* (telegram/bale support URLs added by the 18-a backend).             */
/* ------------------------------------------------------------------ */

export default function AdminSettingsGeneral() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const [siteNameFa, setSiteNameFa] = useState('');
  const [siteTaglineFa, setSiteTaglineFa] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [supportTelegramUrl, setSupportTelegramUrl] = useState('');
  const [supportBaleUrl, setSupportBaleUrl] = useState('');
  const [termsNoteFa, setTermsNoteFa] = useState('');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessageFa, setMaintenanceMessageFa] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/general');
        if (!alive) return;
        setSiteNameFa(strField(d.siteNameFa));
        setSiteTaglineFa(strField(d.siteTaglineFa));
        setSupportEmail(strField(d.supportEmail));
        setSupportPhone(strField(d.supportPhone));
        setSupportTelegramUrl(strField(d.supportTelegramUrl));
        setSupportBaleUrl(strField(d.supportBaleUrl));
        setTermsNoteFa(strField(d.termsNoteFa));
        setMaintenanceEnabled(boolField(d.maintenanceEnabled));
        setMaintenanceMessageFa(strField(d.maintenanceMessageFa));
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات عمومی ناموفق بود.'));
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
    if (!siteNameFa.trim()) {
      toast.error('نام سایت را وارد کنید.');
      return;
    }
    if (supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail.trim())) {
      toast.error('ایمیل پشتیبانی معتبر نیست.');
      return;
    }
    if (supportTelegramUrl.trim() && !supportTelegramUrl.trim().startsWith('https://')) {
      toast.error('آدرس تلگرام باید با https:// شروع شود.');
      return;
    }
    if (supportBaleUrl.trim() && !supportBaleUrl.trim().startsWith('https://')) {
      toast.error('آدرس بله باید با https:// شروع شود.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/general', {
        siteNameFa: siteNameFa.trim(),
        siteTaglineFa: siteTaglineFa.trim(),
        supportEmail: supportEmail.trim(),
        supportPhone: supportPhone.trim(),
        supportTelegramUrl: supportTelegramUrl.trim(),
        supportBaleUrl: supportBaleUrl.trim(),
        termsNoteFa: termsNoteFa.trim(),
        maintenanceEnabled,
        maintenanceMessageFa: maintenanceMessageFa.trim(),
      });
      toast.success('تنظیمات عمومی ذخیره شد.');
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات عمومی ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>تنظیمات عمومی</h2>
        <p>هویت سایت، راه‌های ارتباطی پشتیبانی، قوانین و حالت تعمیر و نگهداری</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات عمومی با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <fieldset className="adm-fset">
          <legend>هویت سایت</legend>
          <p className="adm-fset__desc">نام و شعاری که در سربرگ پنل کاربران و صفحات عمومی نمایش داده می‌شود.</p>
          <div className="adm-form-grid">
            <Field label="نام سایت" required hint="در سربرگ و اعلان‌ها نمایش داده می‌شود.">
              <Input value={siteNameFa} onChange={(e) => setSiteNameFa(e.target.value)} placeholder="مثلاً پُست‌یار" />
            </Field>
            <Field label="شعار سایت">
              <Input value={siteTaglineFa} onChange={(e) => setSiteTaglineFa(e.target.value)} placeholder="مثلاً انتشار هوشمند در پیام‌رسان‌ها" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>راه‌های ارتباطی پشتیبانی</legend>
          <p className="adm-fset__desc">این راه‌ها در صفحهٔ پشتیبانی و قوانین برای کاربران نمایش داده می‌شود.</p>
          <div className="adm-form-grid">
            <Field label="ایمیل پشتیبانی">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@postyar.ir" />
            </Field>
            <Field label="تلفن پشتیبانی">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="021-00000000" />
            </Field>
            <Field label="آدرس تلگرام پشتیبانی" hint="آدرس کامل با https://">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={supportTelegramUrl} onChange={(e) => setSupportTelegramUrl(e.target.value)} placeholder="https://t.me/postyar_support" />
            </Field>
            <Field label="آدرس بله پشتیبانی" hint="آدرس کامل با https://">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={supportBaleUrl} onChange={(e) => setSupportBaleUrl(e.target.value)} placeholder="https://ble.ir/postyar" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>قوانین و مقررات</legend>
          <p className="adm-fset__desc">یادداشت تکمیلی که همراه لینک قوانین نمایش داده می‌شود.</p>
          <Field label="یادداشت قوانین" hint="متن تکمیلی صفحه قوانین.">
            <Textarea rows={3} value={termsNoteFa} onChange={(e) => setTermsNoteFa(e.target.value)} placeholder="یادداشت دلخواه دربارهٔ قوانین و مقررات…" />
          </Field>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>حالت تعمیر و نگهداری</legend>
          <p className="adm-fset__desc">در صورت فعال بودن، کاربران عادی به‌جای سامانه پیام حالت تعمیر را می‌بینند؛ مدیران همچنان دسترسی دارند.</p>
          <div className="adm-inline-row">
            <div>
              <div className="adm-inline-row__title">فعال‌سازی حالت تعمیر</div>
              <div className="adm-inline-row__desc">
                تا زمانی که خاموش است، پیام زیر در هیچ صفحه‌ای نمایش داده نمی‌شود.
              </div>
            </div>
            <Toggle checked={maintenanceEnabled} onChange={setMaintenanceEnabled} label="حالت تعمیر و نگهداری" />
          </div>
          <div className="adm-reveal">
            <Field
              label="پیام حالت تعمیر"
              hint="این پیام فقط زمانی که حالت تعمیر روشن باشد به کاربران نشان داده می‌شود."
            >
              <Textarea
                rows={3}
                value={maintenanceMessageFa}
                onChange={(e) => setMaintenanceMessageFa(e.target.value)}
                placeholder="مثلاً: سامانه موقتاً در دست تعمیر است؛ به‌زودی بازمی‌گردیم."
              />
            </Field>
          </div>
        </fieldset>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییرات پس از ذخیره برای همهٔ کاربران اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
