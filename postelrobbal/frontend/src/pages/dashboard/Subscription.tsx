import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiRequestError, type PlanDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Modal, PageLoading, Select, StatusBadge } from '../../components/ui';
import { faDate, faDigits, faFileSize, faMoney, faNumber } from '../../lib/format';
import { computeCheckoutPreview } from '../../lib/pricing';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';

const SUBSCRIPTION_STATE_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  PENDING: 'در انتظار تأیید',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغوشده',
  TRIAL: 'دورهٔ آزمایشی',
};

const LIMIT_LABELS_FA: Record<string, string> = {
  max_channels: 'کانال',
  max_posts: 'پست در دوره',
  max_bots: 'ربات',
  max_schedules: 'زمان‌بندی همزمان',
  ai_monthly: 'درخواست هوش مصنوعی در ماه',
  storage_mb: 'فضای ذخیره‌سازی (مگابایت)',
};

const FEATURE_LABELS_FA: Record<string, string> = {
  gold_ticker: 'ربات نرخ لحظه‌ای طلا و سکه',
  auto_responder: 'پاسخگوی خودکار',
  woocommerce: 'اتصال وب‌سایت',
  wordpress_campaigns: 'کمپین‌های وب‌سایت و انتشار زمان‌بندی‌شده',
  content_summarization: 'خلاصه‌سازی هوشمند محتوای سایت',
};

/** Contract 14-contract item 1: public payment-method gating. */
interface CardInfo {
  id: string;
  bankName: string;
  cardNumber: string;
  holderName: string;
}

interface WalletDto { balanceRial?: number; }

interface PaymentSettingsDto {
  onlineEnabled: boolean;
  cardToCardEnabled: boolean;
  provider: string;
  cards?: CardInfo[];
}

type IntentResult =
  | { paymentId: string; redirectUrl: string }
  | { paymentId: string; reference: string; cards: CardInfo[] }
  | { paymentId: string; subscriptionId: string; balanceAfter: number; activated: true };

/** Contract item 3 gate errors → dedicated Persian copy, shown inline. */
const PAYMENT_GATE_FA: Record<string, string> = {
  GATEWAY_NOT_CONFIGURED:
    'درگاه پرداخت آنلاین هنوز پیکربندی نشده است؛ لطفاً روش کارت به کارت را انتخاب کنید یا بعداً تلاش کنید.',
  PAYMENT_METHOD_DISABLED:
    'این روش پرداخت در حال حاضر غیرفعال است؛ لطفاً روش دیگری را انتخاب کنید.',
};

const GATEWAY_LABEL_FA: Record<string, string> = {
  zibal: 'زیبال',
  zarinpal: 'زرین‌پال',
  idpay: 'آیدی‌پی',
  winapay: 'ویناپی',
};

function gatewayLabelFa(provider: string | undefined): string {
  return GATEWAY_LABEL_FA[provider ?? ''] ?? 'درگاه پرداخت آنلاین';
}

const RECEIPT_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf';

function limitText(value: number | undefined | null): string {
  if (!value || value <= 0) return 'نامحدود';
  return faNumber(value);
}

function formatCardNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function paymentErrorMessage(e: unknown): string {
  if (e instanceof ApiRequestError && PAYMENT_GATE_FA[e.code]) return PAYMENT_GATE_FA[e.code];
  if (e instanceof ApiRequestError) return e.message;
  return 'ایجاد درخواست پرداخت ناموفق بود. دوباره تلاش کنید.';
}

type PayStep = 'method' | 'card' | 'done';

interface PayIntent {
  paymentId: string;
  reference?: string;
  cards?: CardInfo[];
}

export default function Subscription() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanDto[]>([]);

  // Public payment gating (contract item 1)
  const [paySettings, setPaySettings] = useState<PaymentSettingsDto | null>(null);
  const [walletBalanceRial, setWalletBalanceRial] = useState(0);
  const [walletLoaded, setWalletLoaded] = useState(false);

  // Checkout modal (contract items 3 + 4)
  const [payPlan, setPayPlan] = useState<PlanDto | null>(null);
  const [step, setStep] = useState<PayStep>('method');
  const [months, setMonths] = useState(1);
  const [intent, setIntent] = useState<PayIntent | null>(null);
  const [payError, setPayError] = useState('');
  const [intentBusy, setIntentBusy] = useState<'online' | 'card_to_card' | 'wallet' | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, pay, wallet] = await Promise.all([
        api.get<{ plans?: PlanDto[] }>('/api/v1/subscriptions/plans'),
        api.get<PaymentSettingsDto>('/api/v1/payments/methods').catch(() => null),
        api.get<WalletDto>('/api/v1/wallet').catch(() => null),
      ]);
      setPlans(plansRes.plans ?? []);
      setPaySettings(pay);
      setWalletBalanceRial(Number(wallet?.balanceRial ?? 0));
      setWalletLoaded(Boolean(wallet));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت پلن‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPayModal = (plan: PlanDto) => {
    setPayPlan(plan);
    setStep('method');
    setMonths(1);
    setIntent(null);
    setPayError('');
    setReceiptFile(null);
  };

  const closePayModal = () => {
    setPayPlan(null);
    setIntent(null);
    setPayError('');
    setReceiptFile(null);
    setUploading(false);
    setIntentBusy(null);
  };

  const createIntent = async (method: 'online' | 'card_to_card' | 'wallet'): Promise<IntentResult | null> => {
    if (!payPlan) return null;
    setIntentBusy(method);
    setPayError('');
    try {
      // Contract item 3: POST /payments/intent {kind, planId, method, months}
      const d = await api.post<IntentResult>('/api/v1/payments/intent', {
        kind: 'subscription',
        planId: payPlan.id,
        method,
        months,
      });
      return d;
    } catch (err) {
      setPayError(paymentErrorMessage(err));
      return null;
    } finally {
      setIntentBusy(null);
    }
  };

  const payOnline = async () => {
    const d = await createIntent('online');
    if (d && 'redirectUrl' in d) {
      window.location.assign(d.redirectUrl);
    }
  };

  const payCardToCard = async () => {
    const d = await createIntent('card_to_card');
    if (d && 'reference' in d) {
      setIntent(d);
      setStep('card');
    }
  };

  const payWallet = async () => {
    const d = await createIntent('wallet');
    if (d && 'activated' in d && d.activated) {
      setWalletBalanceRial(Number(d.balanceAfter ?? 0));
      setStep('done');
      toast.success('اشتراک با موفقیت از کیف پول خریداری/تمدید شد.');
      await refresh();
    }
  };

  const pickReceipt = (file: File | null | undefined) => {
    if (!file) return;
    if (!RECEIPT_MIME_ALLOWED.has(file.type)) {
      toast.error('فرمت فایل مجاز نیست. تصویر (تصویر و سند مجاز (جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف) انتخاب کنید.');
      return;
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      toast.error('حجم فایل باید حداکثر ۵ مگابایت باشد.');
      return;
    }
    setReceiptFile(file);
  };

  const uploadReceipt = async () => {
    if (!intent || !receiptFile) return;
    setUploading(true);
    setPayError('');
    try {
      // Contract item 4: multipart field "file" (≤5MB, magic-byte checked).
      const fd = new FormData();
      fd.append('file', receiptFile);
      await api.postForm<{ paymentId: string; status: string }>(
        `/api/v1/payments/${intent.paymentId}/receipt`,
        fd
      );
      setStep('done');
      void refresh(); // session carries subscription state — refresh it
    } catch (err) {
      setPayError(err instanceof ApiRequestError ? err.message : 'بارگذاری رسید ناموفق بود. دوباره تلاش کنید.');
    } finally {
      setUploading(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} کپی شد.`);
    } catch {
      toast.error('کپی خودکار ممکن نشد؛ لطفاً دستی کپی کنید.');
    }
  };

  if (loading) return <PageLoading />;

  const current = me?.subscription ?? null;
  const currentPlanCode = current?.planCode ?? null;
  const onlineEnabled = paySettings?.onlineEnabled === true;
  const cardToCardEnabled = paySettings?.cardToCardEnabled === true;
  const modalCards = (intent?.cards ?? paySettings?.cards ?? []) as CardInfo[];
  const noMethodAvailable = !onlineEnabled && !cardToCardEnabled;
  const onlineGatewayLabel = gatewayLabelFa(paySettings?.provider);

  // Round 19: renewal/upgrade eligibility — an ACTIVE subscription whose expiry
  // is still in the future (includes the seeded free plan). Server recomputes
  // authoritatively; this preview mirrors its rules.
  const hasActiveSub = Boolean(
    current &&
      current.state === 'ACTIVE' &&
      current.expiresAt &&
      new Date(current.expiresAt).getTime() > Date.now()
  );
  const checkoutPreview = payPlan
    ? computeCheckoutPreview(payPlan.priceRial, payPlan.pricingJson, months, hasActiveSub)
    : null;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>اشتراک و پلن‌ها</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>پلن مناسب کسب‌وکار خود را انتخاب کنید؛ ارتقا بلافاصله پس از پرداخت فعال می‌شود.</p>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', marginBottom: 24 }}>
        {plans.length === 0 ? (
          <EmptyState icon="💎" title="پلنی برای نمایش نیست" description="فهرست پلن‌ها در دسترس نیست؛ کمی بعد دوباره تلاش کنید." />
        ) : (
          plans.map((plan) => {
            const isCurrent = currentPlanCode === plan.code;
            const features = plan.featuresJson ?? ({} as PlanDto['featuresJson']);
            const limits = plan.limitsJson ?? ({} as PlanDto['limitsJson']);
            const durationBadges = Object.entries(plan.pricingJson?.durationDiscounts ?? {})
              .filter(([, v]) => Number(v) > 0)
              .sort((a, b) => Number(a[0]) - Number(b[0]));
            return (
              <Card key={plan.id} pad="lg">
                {isCurrent && (
                  <span className="badge badge-success" style={{ marginBottom: 10 }}>پلن فعلی شما</span>
                )}
                <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{plan.nameFa}</h2>
                <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--brand-strong)', marginBottom: 14 }}>
                  {faMoney(plan.priceRial)}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}> / ماهانه</span>
                </div>

                {durationBadges.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {durationBadges.map(([m, v]) => (
                      <span
                        key={m}
                        className="badge badge-warning"
                        style={{ fontSize: 11.5 }}
                      >
                        🏷️ {faDigits(Number(m))} ماهه: {faDigits(Number(v))}٪ تخفیف
                      </span>
                    ))}
                  </div>
                )}

                <ul style={{ listStyle: 'none', display: 'grid', gap: 5, fontSize: 13, marginBottom: 14, color: 'var(--text-2)' }}>
                  {Object.entries(LIMIT_LABELS_FA).map(([key, label]) => (
                    <li key={key}>
                      ✔ {label}: <strong style={{ color: 'var(--text)' }}>{limitText(limits[key as keyof PlanDto['limitsJson']])}</strong>
                    </li>
                  ))}
                </ul>

                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginBottom: 16, display: 'grid', gap: 4, fontSize: 13 }}>
                  {Object.entries(FEATURE_LABELS_FA).map(([key, label]) => {
                    const on = features[key as keyof PlanDto['featuresJson']] === true;
                    return (
                      <span key={key} style={{ color: on ? 'var(--text)' : 'var(--text-2)' }}>
                        <span aria-hidden="true">{on ? '✔' : '✖'}</span> {label}
                      </span>
                    );
                  })}
                </div>

                <Button
                  block
                  variant={isCurrent ? 'ghost' : 'primary'}
                  onClick={() => openPayModal(plan)}
                >
                  {isCurrent ? 'تمدید اشتراک' : 'انتخاب این پلن'}
                </Button>
              </Card>
            );
          })
        )}
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', maxWidth: 900 }}>
        {current && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>اشتراک فعلی</h2>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 6, fontSize: 13.5 }}>
              <li>پلن: <strong>{current.planName}</strong></li>
              <li>تاریخ انقضا: <strong>{faDate(current.expiresAt)}</strong></li>
              <li>
                وضعیت: <StatusBadge state={current.state} labels={SUBSCRIPTION_STATE_FA} />
              </li>
            </ul>
          </Card>
        )}

        {!current && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>اشتراکی ندارید</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              برای استفاده از تمام امکانات، یکی از پلن‌ها را انتخاب کنید. پس از پرداخت موفق، اشتراک شما بلافاصله فعال می‌شود.
            </p>
          </Card>
        )}
      </div>

      {/* ---------- checkout modal: method → (card-to-card) → receipt → done ---------- */}
      <Modal
        open={Boolean(payPlan)}
        onClose={closePayModal}
        title={step === 'done' ? 'پرداخت ثبت شد' : 'تکمیل خرید اشتراک'}
      >
        {payPlan && step !== 'done' && checkoutPreview && (
          <div
            style={{
              background: 'var(--brand-soft)',
              border: '1px solid var(--brand)',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 14.5 }}>{payPlan.nameFa}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{faNumber(payPlan.priceRial / 10)} تومان × {faDigits(months)} ماه</div>
              </div>
              <strong style={{ fontSize: 17, color: 'var(--brand-strong)' }}>{faMoney(checkoutPreview.final)}</strong>
            </div>
            {checkoutPreview.totalPct > 0 && (
              <div style={{ borderTop: '1px dashed var(--brand)', paddingTop: 6, display: 'grid', gap: 3, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--text-2)' }}>قیمت بدون تخفیف</span>
                  <span style={{ textDecoration: 'line-through' }}>{faMoney(checkoutPreview.list)}</span>
                </div>
                {checkoutPreview.durationPct > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--success)' }}>
                    <span>🏷️ تخفیف خرید {faDigits(months)} ماهه</span>
                    <span>{faDigits(checkoutPreview.durationPct)}٪</span>
                  </div>
                )}
                {checkoutPreview.renewalPct > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--success)' }}>
                    <span>🎁 تخفیف تمدید / ارتقا (اشتراک فعال شما)</span>
                    <span>{faDigits(checkoutPreview.renewalPct)}٪</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}>
                  <span>سود شما از این خرید</span>
                  <span>{faMoney(checkoutPreview.discount)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'method' && (
          <>
            <Field label="مدت اشتراک" required hint="با انتخاب دوره‌های طولانی‌تر، در صورت تعریف تخفیف دوره‌ای، مبلغ کمتری پرداخت می‌کنید.">
              <Select value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 3, 6, 12].map((m) => {
                  const pct = payPlan?.pricingJson?.durationDiscounts?.[String(m)] ?? 0;
                  return (
                    <option key={m} value={m}>
                      {faDigits(m)} ماه{pct > 0 ? ` — ${faDigits(pct)}٪ تخفیف` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>

            {payError && (
              <div role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                {payError}
              </div>
            )}

            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 10px' }}>روش پرداخت را انتخاب کنید:</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {onlineEnabled && (
                <button type="button" className="pay-option" disabled={intentBusy !== null} onClick={() => void payOnline()}>
                  <span className="pay-option__icon" aria-hidden="true">💳</span>
                  <span>
                    <span className="pay-option__title">پرداخت آنلاین</span>
                    <span className="pay-option__desc">انتقال امن به درگاه {onlineGatewayLabel}؛ فعال‌سازی بلافاصله پس از پرداخت</span>
                  </span>
                </button>
              )}
              {cardToCardEnabled && (
                <button type="button" className="pay-option" disabled={intentBusy !== null} onClick={() => void payCardToCard()}>
                  <span className="pay-option__icon" aria-hidden="true">🏦</span>
                  <span>
                    <span className="pay-option__title">کارت به کارت</span>
                    <span className="pay-option__desc">واریز به کارت‌های سامانه و بارگذاری رسید؛ تأیید توسط مدیر</span>
                  </span>
                </button>
              )}
              {walletLoaded && (
                <button type="button" className="pay-option" disabled={intentBusy !== null || walletBalanceRial < (checkoutPreview?.final ?? Number.MAX_SAFE_INTEGER)} onClick={() => void payWallet()}>
                  <span className="pay-option__icon" aria-hidden="true">👛</span>
                  <span>
                    <span className="pay-option__title">پرداخت از کیف پول</span>
                    <span className="pay-option__desc">موجودی: {faMoney(walletBalanceRial)}{walletBalanceRial < (checkoutPreview?.final ?? Number.MAX_SAFE_INTEGER) ? ' — موجودی کافی نیست' : ' — فعال‌سازی فوری'}</span>
                  </span>
                </button>
              )}
              {noMethodAvailable && (
                <div style={{ background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid var(--warning)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                  در حال حاضر هیچ روش پرداختی فعال نیست؛ لطفاً با پشتیبانی تماس بگیرید.
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <Button variant="ghost" onClick={closePayModal}>انصراف</Button>
            </div>
          </>
        )}

        {step === 'card' && intent && payPlan && (
          <>
            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  background: 'var(--info-soft)',
                  border: '1px solid #93c5fd',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: 13,
                }}
              >
                <span>کد رهگیری پرداخت: <code dir="ltr" style={{ fontWeight: 700 }}>{intent.reference}</code></span>
                <Button size="sm" variant="ghost" onClick={() => void copyText(intent.reference ?? '', 'کد رهگیری')}>
                  کپی
                </Button>
              </div>

              {modalCards.length === 0 ? (
                <div style={{ background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid var(--warning)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                  شماره کارتی برای واریز ثبت نشده است؛ لطفاً با پشتیبانی تماس بگیرید.
                </div>
              ) : (
                modalCards.map((c) => (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{c.bankName}</strong>
                      <Button size="sm" variant="soft" onClick={() => void copyText(c.cardNumber.replace(/\D/g, ''), 'شماره کارت')}>
                        کپی شماره کارت
                      </Button>
                    </div>
                    <div dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 17, fontWeight: 800, letterSpacing: 2 }}>
                      {formatCardNumber(c.cardNumber)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>به نام {c.holderName}</div>
                  </div>
                ))
              )}

              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0 }}>
                مبلغ <strong style={{ color: 'var(--text)' }}>{checkoutPreview ? faMoney(checkoutPreview.final) : '—'}</strong> را واریز کنید، سپس فایل رسید را در همین
                صفحه بارگذاری کنید تا مدیر آن را تأیید کند.
              </p>
            </div>

            {payError && (
              <div role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                {payError}
              </div>
            )}

            <Field label="فایل رسید واریزی" required hint="جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف · حداکثر ۵ مگابایت">
              <div
                className="attach-zone"
                role="button"
                tabIndex={0}
                aria-label="انتخاب فایل رسید"
                onClick={() => receiptInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    receiptInputRef.current?.click();
                  }
                }}
              >
                <span className="attach-zone__icon" aria-hidden="true">🧾</span>
                <span>
                  <span className="attach-zone__title">{receiptFile ? 'تغییر فایل رسید' : 'انتخاب فایل رسید'}</span>
                  <span className="attach-zone__hint">تصویر یا پی‌دی‌اف رسید کارت به کارت</span>
                </span>
              </div>
            </Field>

            {receiptFile && (
              <div style={{ marginBottom: 12 }}>
                <span className="file-chip">
                  <span aria-hidden="true">{receiptFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                  <span className="file-chip__name">{receiptFile.name}</span>
                  <span className="file-chip__meta">{faFileSize(receiptFile.size)}</span>
                  <button
                    type="button"
                    className="file-chip__remove"
                    onClick={() => setReceiptFile(null)}
                    aria-label={`حذف فایل ${receiptFile.name}`}
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}

            <input
              ref={receiptInputRef}
              type="file"
              accept={RECEIPT_ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => {
                pickReceipt(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <Button onClick={() => void uploadReceipt()} loading={uploading} disabled={!receiptFile}>
                بارگذاری رسید
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('method');
                  setIntent(null);
                  setReceiptFile(null);
                  setPayError('');
                }}
                disabled={uploading}
              >
                بازگشت
              </Button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
            <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">✅</div>
            <h3 style={{ fontSize: 16.5, fontWeight: 800, marginBottom: 6 }}>رسید شما ثبت شد و در انتظار تأیید مدیر است</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 18 }}>
              پس از بررسی و تأیید رسید (معمولاً کمتر از یک ساعت کاری)، اشتراک شما فعال شده و اعلان آن را دریافت می‌کنید.
            </p>
            <Button onClick={closePayModal}>متوجه شدم</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
