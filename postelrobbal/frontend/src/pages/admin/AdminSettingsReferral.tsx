import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { faNumber, toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { errText, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* زیرمجموعه‌گیری — round 18-c: enabled switch + register reward +     */
/* first-purchase percent (wired by the 18-a backend).                 */
/* GET/PUT /admin/settings/referral → { registerRewardPoints, enabled, */
/* firstPurchasePercent(0..50) }.                                      */
/* ------------------------------------------------------------------ */

export default function AdminSettingsReferral() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [pointsInput, setPointsInput] = useState('');
  const [percentInput, setPercentInput] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/referral');
        if (!alive) return;
        setEnabled(d.enabled !== false);
        const pts = Number(d.registerRewardPoints ?? 0);
        setPointsInput(String(Number.isFinite(pts) ? pts : 0));
        const pct = Number(d.firstPurchasePercent ?? 10);
        setPercentInput(String(Number.isFinite(pct) ? pct : 10));
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات زیرمجموعه‌گیری ناموفق بود.'));
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
    const pts = Number(toLatinDigits(pointsInput).trim());
    if (!Number.isFinite(pts) || pts < 0 || !Number.isInteger(pts)) {
      toast.error('امتیاز پاداش را به‌صورت عدد صحیح نامنفی وارد کنید.');
      return;
    }
    const pct = Number(toLatinDigits(percentInput).trim());
    if (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 50) {
      toast.error('درصد پاداش خرید اول باید عددی بین ۰ تا ۵۰ باشد.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/referral', {
        enabled,
        registerRewardPoints: pts,
        firstPurchasePercent: pct,
      });
      toast.success('تنظیمات زیرمجموعه‌گیری ذخیره شد.');
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات زیرمجموعه‌گیری ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>زیرمجموعه‌گیری</h2>
        <p>فعال‌سازی معرفی کاربران و پاداش‌های آن</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات زیرمجموعه‌گیری با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <fieldset className="adm-fset">
          <legend>وضعیت سیستم زیرمجموعه‌گیری</legend>
          <p className="adm-fset__desc">
            با فعال بودن، هر کاربر می‌تواند با کد معرف خود کاربر جدید جذب کند و پاداش بگیرد.
          </p>
          <div className="adm-inline-row">
            <div>
              <div className="adm-inline-row__title">فعال‌سازی زیرمجموعه‌گیری</div>
              <div className="adm-inline-row__desc">
                {enabled
                  ? 'پاداش‌ها طبق مقادیر زیر به‌صورت خودکار ثبت می‌شوند.'
                  : 'سیستم خاموش است؛ هیچ پاداشی ثبت نمی‌شود و لینک‌های معرف بی‌اثر خواهند بود.'}
              </div>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} label="فعال‌سازی زیرمجموعه‌گیری" />
          </div>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>پاداش ثبت‌نام</legend>
          <p className="adm-fset__desc">امتیازی که بلافاصله پس از ثبت‌نام زیرمجموعه به کیف معرِّف اضافه می‌شود.</p>
          <Field label="امتیاز پاداش ثبت‌نام" hint="امتیاز پرداختی به معرف پس از ثبت‌نام زیرمجموعه.">
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              inputMode="numeric"
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
              placeholder="100"
            />
          </Field>
        </fieldset>

        <fieldset className="adm-fset">
          <legend>پاداش خرید اول زیرمجموعه</legend>
          <p className="adm-fset__desc">امتیاز کیف پولی که پس از نخستین خرید تأییدشدهٔ زیرمجموعه پرداخت می‌شود.</p>
          <Field label="درصد پاداش خرید اول" hint="درصد از مبلغ اولین خرید زیرمجموعه، ۰ تا ۵۰.">
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              inputMode="numeric"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              placeholder="10"
            />
          </Field>
          <div className="adm-note adm-note--info">
            <span aria-hidden="true">ℹ️</span>
            <span>تغییرات بلافاصله برای ثبت‌نام‌ها و خریدهای جدید اعمال می‌شود؛ پاداش‌های قبلی برگشت نمی‌خورند.</span>
          </div>
        </fieldset>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">پیش‌نمایش: امتیاز فعلی {faNumber(Number(toLatinDigits(pointsInput)) || 0)} · درصد خرید اول {faNumber(Number(toLatinDigits(percentInput)) || 0)}٪</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
