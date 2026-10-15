import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading, Select } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { errText, strField } from './shared';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';

/* ------------------------------------------------------------------ */
/* ربات طلا و سکه — server-wide defaults for the gold ticker bot       */
/* (round 18-c, NEW). GET/PUT /admin/settings/gold →                   */
/* { defaultSourceUrl, defaultFrequencyMinutes, defaultTemplateFa }.   */
/* These defaults only feed the per-user lazy configuration; existing  */
/* user configs are never touched (18-a wiring).                       */
/* ------------------------------------------------------------------ */

const FREQUENCY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 15, label: 'هر ۱۵ دقیقه' },
  { value: 30, label: 'هر ۳۰ دقیقه' },
  { value: 60, label: 'هر ۱ ساعت' },
  { value: 180, label: 'هر ۳ ساعت' },
  { value: 360, label: 'هر ۶ ساعت' },
  { value: 720, label: 'هر ۱۲ ساعت' },
  { value: 1440, label: 'هر ۲۴ ساعت' },
];

export default function AdminSettingsGold() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [defaultSourceUrl, setDefaultSourceUrl] = useState('');
  const [frequencyMinutes, setFrequencyMinutes] = useState(60);
  const [defaultTemplateFa, setDefaultTemplateFa] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/gold');
        if (!alive) return;
        setDefaultSourceUrl(strField(d.defaultSourceUrl));
        const f = Number(d.defaultFrequencyMinutes ?? 60);
        setFrequencyMinutes(Number.isFinite(f) ? f : 60);
        setDefaultTemplateFa(strField(d.defaultTemplateFa));
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات ربات طلا ناموفق بود.'));
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
    if (defaultSourceUrl.trim() && !defaultSourceUrl.trim().startsWith('https://')) {
      toast.error('آدرس سورس باید با https:// شروع شود.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/gold', {
        defaultSourceUrl: defaultSourceUrl.trim(),
        defaultFrequencyMinutes: frequencyMinutes,
        defaultTemplateFa: defaultTemplateFa.trim(),
      });
      toast.success('تنظیمات ربات طلا و سکه ذخیره شد.');
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات ربات طلا ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>ربات طلا و سکه</h2>
        <p>پیش‌فرض‌های سراسری ربات لحظه‌ای طلا برای کاربران تازه</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات ربات طلا و سکه با موفقیت ذخیره شد.</span>
        </div>
      )}

      <div className="adm-note adm-note--info" role="note">
        <span aria-hidden="true">ℹ️</span>
        <span>
          این مقادیر فقط برای پیکربندی خودِ کاربران زمانی اعمال می‌شود که هنوز تنظیمات شخصی نساخته‌اند؛ تنظیمات کاربران موجود تغییر نمی‌کند.
        </span>
      </div>

      <Card>
        <fieldset className="adm-fset">
          <legend>منبع قیمت پیش‌فرض</legend>
          <p className="adm-fset__desc">سورسی که قیمت طلا و سکه از آن استخراج می‌شود وقتی کاربر سورس شخصی نداشته باشد.</p>
          <Field
            label="آدرس سورس قیمت"
            hint="نشانی رابط برنامه‌نویسی قیمت که به‌عنوان پیش‌فرض به کاربران دارای پلن طلا تخصیص می‌شود؛ خالی = منبع داخلی تی‌جی‌یو‌جی."
          >
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              value={defaultSourceUrl}
              onChange={(e) => setDefaultSourceUrl(e.target.value)}
              placeholder="نشانی امن منبع قیمت"
            />
          </Field>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>به‌روزرسانی و قالب پیام</legend>
          <p className="adm-fset__desc">فاصلهٔ پیش‌فرض گرفتن قیمت جدید و متن قالبی که برای کاربران تازه ارسال می‌شود.</p>
          <div className="adm-form-grid">
            <Field label="فاصلهٔ به‌روزرسانی" hint="هر چند وقت یک‌بار قیمت جدید گرفته و ارسال می‌شود.">
              <Select
                value={String(frequencyMinutes)}
                onChange={(e) => setFrequencyMinutes(Number(e.target.value))}
                aria-label="فاصلهٔ به‌روزرسانی قیمت"
              >
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="قالب پیش‌فرض پیام قیمت"
            hint="متن پیش‌فرض قیمت برای کاربران جدید؛ قیمت‌ها از سورس استخراج و ارسال می‌شود."
          >
            <ContentComposerTextarea
              rows={8}
              value={defaultTemplateFa}
              onChange={(e) => setDefaultTemplateFa(e.target.value)}
              placeholder={'مثلاً:\n🪙 قیمت لحظه‌ای طلا و سکه\nهر گرم طلای ۱۸ عیار: {price_18k} تومان\nسکه امامی: {coin_emami} تومان'}
            />
          </Field>
        </fieldset>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">این مقادیر فقط به پیکربندی خودکار کاربران جدید اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
