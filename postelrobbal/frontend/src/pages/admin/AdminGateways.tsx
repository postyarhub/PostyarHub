import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { faDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { asObject, boolField, errText, normalizeCardNumber, strField, Toggle, type PayCardRow } from './shared';

/* ------------------------------------------------------------------ */
/* درگاه پرداخت — online/card-to-card toggles, default gateway picker  */
/* with per-gateway settings reveal, card-to-card cards (Task 16-b).   */
/* ------------------------------------------------------------------ */

type ProviderKey = 'zibal' | 'zarinpal' | 'idpay' | 'winapay';

const PROVIDERS: Array<ProviderKey> = ['zibal', 'zarinpal', 'idpay', 'winapay'];

const PROVIDER_INFO: Record<ProviderKey, { title: string; desc: string }> = {
  zibal: { title: 'زیبال', desc: 'درگاه زیبال — تسویهٔ سریع و کارمزد مناسب' },
  zarinpal: { title: 'زرین‌پال', desc: 'درگاه زرین‌پال — محبوب‌ترین درگاه پرداخت ایران' },
  idpay: { title: 'آیدی‌پی', desc: 'درگاه آیدی‌پی — پشتیبانی از همهٔ کارت‌های شتاب' },
  winapay: { title: 'ویناپی', desc: 'درگاه ویناپی — پرداخت آنلاین از طریق رابط برنامه‌نویسی' },
};

const PROVIDER_LABEL: Record<ProviderKey, string> = { zibal: 'زیبال', zarinpal: 'زرین‌پال', idpay: 'آیدی‌پی', winapay: 'ویناپی' };

interface GatewayCreds {
  merchantId: string;
  apiKey: string;
  sandbox: boolean;
}

export default function AdminGateways() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [cardToCardEnabled, setCardToCardEnabled] = useState(false);
  const [provider, setProvider] = useState<ProviderKey>('zibal');

  const [creds, setCreds] = useState<Record<ProviderKey, GatewayCreds>>({
    zibal: { merchantId: '', apiKey: '', sandbox: false },
    zarinpal: { merchantId: '', apiKey: '', sandbox: false },
    idpay: { merchantId: '', apiKey: '', sandbox: false },
    winapay: { merchantId: '', apiKey: '', sandbox: false },
  });

  const [cards, setCards] = useState<PayCardRow[]>([]);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/payments');
        if (!alive) return;
        const gateways = asObject(d.gateways);
        const readCreds = (key: ProviderKey): GatewayCreds => {
          const o = asObject(gateways[key]);
          return { merchantId: strField(o.merchantId), apiKey: strField(o.apiKey), sandbox: boolField(o.sandbox) };
        };
        setOnlineEnabled(boolField(d.onlineEnabled));
        setCardToCardEnabled(boolField(d.cardToCardEnabled));
        setProvider(PROVIDERS.includes(d.provider as ProviderKey) ? (d.provider as ProviderKey) : 'zibal');
        setCreds({ zibal: readCreds('zibal'), zarinpal: readCreds('zarinpal'), idpay: readCreds('idpay'), winapay: readCreds('winapay') });
        const cardsRaw = Array.isArray(d.cards) ? d.cards : [];
        setCards(
          cardsRaw.slice(0, 5).map((c) => {
            const o = asObject(c);
            return {
              id: typeof o.id === 'string' ? o.id : undefined,
              bankName: strField(o.bankName),
              cardNumber: strField(o.cardNumber),
              holderName: strField(o.holderName),
            };
          })
        );
        setCardErrors({});
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات پرداخت ناموفق بود.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCreds = (key: ProviderKey, patch: Partial<GatewayCreds>) => {
    setCreds((prev) => {
      const next: Record<ProviderKey, GatewayCreds> = { ...prev };
      next[key] = { ...prev[key], ...patch };
      return next;
    });
  };

  const updateCard = (i: number, patch: Partial<PayCardRow>) => {
    setCards((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setCardErrors((prev) => {
      if (!prev[i]) return prev;
      const next = { ...prev };
      delete next[i];
      return next;
    });
  };

  const save = async () => {
    const errors: Record<number, string> = {};
    cards.forEach((c, i) => {
      if (!c.bankName.trim()) errors[i] = 'نام بانک را وارد کنید.';
      else if (!c.holderName.trim()) errors[i] = 'نام صاحب کارت را وارد کنید.';
      else if (!/^\d{16,24}$/.test(normalizeCardNumber(c.cardNumber))) errors[i] = 'شماره کارت باید ۱۶ تا ۲۴ رقم عددی باشد.';
    });
    if (Object.keys(errors).length > 0) {
      setCardErrors(errors);
      toast.error('اطلاعات کارت‌ها را بررسی و اصلاح کنید.');
      return;
    }
    setCardErrors({});

    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/payments', {
        onlineEnabled,
        cardToCardEnabled,
        provider,
        gateways: {
          zibal: { merchantId: creds.zibal.merchantId.trim(), sandbox: creds.zibal.sandbox },
          zarinpal: { merchantId: creds.zarinpal.merchantId.trim(), sandbox: creds.zarinpal.sandbox },
          idpay: { apiKey: creds.idpay.apiKey.trim(), sandbox: creds.idpay.sandbox },
          winapay: { merchantId: creds.winapay.merchantId.trim() },
        },
        cards: cards.map((c) => ({
          id: c.id,
          bankName: c.bankName.trim(),
          cardNumber: normalizeCardNumber(c.cardNumber),
          holderName: c.holderName.trim(),
        })),
      });
      toast.success('تنظیمات پرداخت ذخیره شد.');
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات پرداخت ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  const active = creds[provider];

  return (
    <>
      <div className="adm-page-head">
        <h2>درگاه پرداخت</h2>
        <p>درگاه پیش‌فرض فعلی: {PROVIDER_LABEL[provider]}</p>
      </div>

      <Card>
        <div className="adm-card-head"><strong>وضعیت</strong></div>
        <div className="adm-inline-row">
          <div>
            <div className="adm-inline-row__title">پرداخت آنلاین</div>
            <div className="adm-inline-row__desc">کاربران به درگاه {PROVIDER_LABEL[provider]} هدایت می‌شوند.</div>
          </div>
          <Toggle checked={onlineEnabled} onChange={setOnlineEnabled} label="فعال‌سازی پرداخت آنلاین" />
        </div>
        <div className="adm-inline-row">
          <div>
            <div className="adm-inline-row__title">کارت به کارت</div>
            <div className="adm-inline-row__desc">کاربر رسید واریز را بارگذاری می‌کند و مدیر آن را تأیید می‌کند.</div>
          </div>
          <Toggle checked={cardToCardEnabled} onChange={setCardToCardEnabled} label="فعال‌سازی کارت به کارت" />
        </div>
      </Card>

      <Card>
        <div className="adm-card-head"><strong>درگاه پیش‌فرض</strong></div>
        <div className="adm-picker" role="radiogroup" aria-label="انتخاب درگاه پرداخت پیش‌فرض">
          {PROVIDERS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={provider === key}
              className={`adm-picker__tile${provider === key ? ' is-active' : ''}`}
              onClick={() => setProvider(key)}
            >
              <span className="adm-picker__title">
                {PROVIDER_INFO[key].title}
                {key === 'zibal' && <Badge tone="muted">پیش‌فرض</Badge>}
                {provider === key && <Badge tone="brand">فعال</Badge>}
              </span>
              <span className="adm-picker__desc">{PROVIDER_INFO[key].desc}</span>
            </button>
          ))}
        </div>

        {/* Per-gateway settings reveal */}
        <div className="adm-reveal">
          {provider === 'idpay' ? (
            <Field label="کلید رابط برنامه‌نویسی" hint="کلید رابط برنامه‌نویسی درگاه آیدی‌پی را از پنل آیدی‌پی دریافت کنید.">
              <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={active.apiKey} onChange={(e) => updateCreds('idpay', { apiKey: e.target.value })} placeholder="مثلاً 4f7c1d30-..." />
            </Field>
          ) : (
            <Field label="شناسهٔ پذیرنده" hint={`شناسهٔ پذیرندهٔ درگاه ${PROVIDER_LABEL[provider]} را از پنل آن دریافت کنید.`}>
              <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={active.merchantId} onChange={(e) => updateCreds(provider, { merchantId: e.target.value })} placeholder="شناسهٔ پذیرنده" />
            </Field>
          )}
          {provider === 'winapay' ? (
            <div className="adm-note adm-note--info" role="note">
              <span aria-hidden="true">ℹ️</span>
              <span>ویناپی در تنظیمات فعلی پروژه محیط Sandbox جداگانه ندارد؛ مبلغ برای سرویس ویناپی از ریال به تومان تبدیل می‌شود.</span>
            </div>
          ) : (
            <div className="adm-inline-row">
              <div>
                <div className="adm-inline-row__title">محیط آزمایشی</div>
                <div className="adm-inline-row__desc">پرداخت‌ها در حالت سندباکس انجام می‌شوند و پول واقعی جابه‌جا نمی‌شود.</div>
              </div>
              <Toggle checked={active.sandbox} onChange={(v) => updateCreds(provider, { sandbox: v })} label="محیط آزمایشی درگاه" />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="adm-card-head">
          <strong>کارت‌های دریافت واریز ({faDigits(cards.length)} از {faDigits(5)})</strong>
          <Button
            size="sm"
            variant="soft"
            disabled={cards.length >= 5}
            onClick={() => setCards((prev) => [...prev, { bankName: '', cardNumber: '', holderName: '' }])}
          >
            + افزودن کارت
          </Button>
        </div>

        {cards.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0 }}>
            کارتی ثبت نشده است. برای فعال‌سازی کارت به کارت، حداقل یک کارت اضافه کنید.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {cards.map((c, i) => (
              <div key={c.id ?? `new-${i}`} className="adm-cardrow">
                <div className="adm-cardrow__fields">
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <Input value={c.bankName} onChange={(e) => updateCard(i, { bankName: e.target.value })} placeholder="نام بانک (مثلاً ملت)" aria-label={`نام بانک کارت ${faDigits(i + 1)}`} error={Boolean(cardErrors[i])} />
                  </div>
                  <div style={{ flex: 1.4, minWidth: 180 }}>
                    <Input dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }} value={c.cardNumber} onChange={(e) => updateCard(i, { cardNumber: e.target.value })} placeholder="6037997512345678" aria-label={`شماره کارت ${faDigits(i + 1)}`} error={Boolean(cardErrors[i])} />
                  </div>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <Input value={c.holderName} onChange={(e) => updateCard(i, { holderName: e.target.value })} placeholder="نام صاحب کارت" aria-label={`نام صاحب کارت ${faDigits(i + 1)}`} error={Boolean(cardErrors[i])} />
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setCards((prev) => prev.filter((_, j) => j !== i))} aria-label={`حذف کارت ${faDigits(i + 1)}`}>
                    حذف
                  </Button>
                </div>
                {cardErrors[i] && <div className="field-error" role="alert">{cardErrors[i]}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییرات پس از ذخیره برای همهٔ کاربران اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
