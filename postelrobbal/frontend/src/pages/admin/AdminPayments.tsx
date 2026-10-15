import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageLoading, Pagination, Select, StatusBadge } from '../../components/ui';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { faDateTime, faDigits, faMoney } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { PAGE_SIZE, PAYMENT_STATE_FA, errText, strField, type AdminPaymentRow } from './shared';

/* ------------------------------------------------------------------ */
/* پرداخت‌ها — status filter + approve/review receipt flows + a full   */
/* detail popup (round 19 item 8): receipt image, amount breakdown,    */
/* payer identity, purchased plan and every stored field.              */
/* ------------------------------------------------------------------ */

function purposeFa(purpose?: string | null): string {
  if (purpose === 'SUBSCRIPTION') return 'اشتراک';
  if (purpose === 'WALLET_TOPUP') return 'شارژ کیف پول';
  return purpose || '—';
}

const GATEWAY_FA: Record<string, string> = {
  card_to_card: 'کارت به کارت',
  zarinpal: 'زرین‌پال',
  zibal: 'زیبال',
  idpay: 'آیدی‌پی',
  winapay: 'ویناپی',
};

/** Discount breakdown persisted by the round-19 pricing engine. */
interface PricingMeta {
  listAmountRial?: number;
  durationDiscountPercent?: number;
  renewalDiscountPercent?: number;
  totalDiscountPercent?: number;
  discountAmountRial?: number;
  finalAmountRial?: number;
}

function pricingOf(row: AdminPaymentRow): PricingMeta | null {
  const meta = (row as { metaJson?: { pricing?: PricingMeta } | null }).metaJson;
  const p = meta?.pricing;
  return p && typeof p === 'object' ? p : null;
}

function DetailItem({ label, value, ltr, strong }: { label: string; value: string; ltr?: boolean; strong?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{label}</span>
      <span
        dir={ltr ? 'ltr' : undefined}
        style={{
          textAlign: ltr ? 'left' : undefined,
          fontSize: 13,
          fontWeight: strong ? 700 : 500,
          wordBreak: ltr ? 'break-all' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function AdminPayments() {
  const toast = useToast();

  const [items, setItems] = useState<AdminPaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // detail popup (round 19)
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = items.find((p) => p.id === detailId) ?? null;
  const detailPricing = detail ? pricingOf(detail) : null;

  // approve (send {} — idempotent settle on the server)
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);

  // reject receipt with a required reason
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  const loadPayments = async (p: number, state: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (state) q.set('status', state);
      const d = await api.get<{ items?: AdminPaymentRow[]; total?: number; page?: number }>(`/api/v1/admin/payments?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت پرداخت‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPayments(page, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  const approveTarget = items.find((p) => p.id === approveId);

  const approvePayment = async () => {
    if (!approveId) return;
    setApproveBusy(true);
    try {
      await api.post(`/api/v1/admin/payments/${approveId}/approve`, {});
      toast.success('پرداخت تأیید و اعمال شد.');
      setApproveId(null);
      await loadPayments(page, status);
    } catch (err) {
      toast.error(errText(err, 'تأیید پرداخت ناموفق بود.'));
    } finally {
      setApproveBusy(false);
    }
  };

  const rejectPayment = async () => {
    if (!rejectId) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      toast.error('دلیل رد را بنویسید (حداقل ۳ نویسه).');
      return;
    }
    setRejectBusy(true);
    try {
      await api.post(`/api/v1/admin/payments/${rejectId}/reject`, { reason });
      toast.success('پرداخت رد شد.');
      setRejectId(null);
      setRejectReason('');
      await loadPayments(page, status);
    } catch (err) {
      toast.error(errText(err, 'رد پرداخت ناموفق بود.'));
    } finally {
      setRejectBusy(false);
    }
  };

  const canReview = detail?.state === 'CREATED' || detail?.state === 'PENDING_REVIEW';

  return (
    <>
      <div className="adm-page-head">
        <h2>پرداخت‌ها</h2>
        <p>بررسی و تأیید پرداخت‌های آنلاین و رسیدهای کارت به کارت</p>
      </div>

      <Card>
        <div className="adm-toolbar">
          <div style={{ minWidth: 220 }}>
            <Select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              aria-label="فیلتر وضعیت پرداخت"
            >
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(PAYMENT_STATE_FA).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="💳" title="پرداختی یافت نشد" description="با تغییر فیلتر وضعیت، دوباره جستجو کنید." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>بابت</th>
                    <th>کاربر</th>
                    <th>زمان</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(p.id)}>
                      <td data-label="مبلغ" style={{ fontWeight: 700 }}>{faMoney(p.amountRial)}</td>
                      <td data-label="وضعیت"><StatusBadge state={p.state ?? ''} labels={PAYMENT_STATE_FA} /></td>
                      <td data-label="بابت">{purposeFa(p.purpose)}</td>
                      <td data-label="کاربر" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{p.userEmail || (p.tenantId ? p.tenantId.slice(0, 10) : '—')}</td>
                      <td data-label="زمان">{faDateTime(p.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="adm-table-actions">
                          <Button size="sm" variant="soft" onClick={() => setDetailId(p.id)}>جزئیات</Button>
                          {(p.state === 'CREATED' || p.state === 'PENDING_REVIEW') && (
                            <Button size="sm" variant="soft" onClick={() => setApproveId(p.id)}>تأیید</Button>
                          )}
                          {p.state === 'PENDING_REVIEW' && (
                            <Button size="sm" variant="ghost" onClick={() => { setRejectId(p.id); setRejectReason(''); }}>رد رسید</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>

      {/* ---------- round 19: full payment detail popup ---------- */}
      <Modal open={detailId !== null} onClose={() => setDetailId(null)} title="جزئیات پرداخت" large>
        {!detail ? (
          <PageLoading />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusBadge state={detail.state ?? ''} labels={PAYMENT_STATE_FA} />
                <strong style={{ fontSize: 16 }}>{faMoney(detail.amountRial)}</strong>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{purposeFa(detail.purpose)}</span>
              </div>
              <code dir="ltr" style={{ fontSize: 11, color: 'var(--text-2)' }}>{detail.id}</code>
            </div>

            {detailPricing && Number(detailPricing.totalDiscountPercent ?? 0) > 0 && (
              <div
                style={{
                  background: 'var(--success-soft)',
                  border: '1px solid var(--success)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 14,
                  fontSize: 12.5,
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>قیمت بدون تخفیف ({faDigits(Number(detail.months ?? 1))} ماه)</span>
                  <span style={{ textDecoration: 'line-through' }}>{faMoney(Number(detailPricing.listAmountRial ?? 0))}</span>
                </div>
                {Number(detailPricing.durationDiscountPercent ?? 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>تخفیف خرید دوره‌ای</span>
                    <span>{faDigits(Number(detailPricing.durationDiscountPercent))}٪</span>
                  </div>
                )}
                {Number(detailPricing.renewalDiscountPercent ?? 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>تخفیف تمدید / ارتقا</span>
                    <span>{faDigits(Number(detailPricing.renewalDiscountPercent))}٪</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}>
                  <span>سود کاربر</span>
                  <span>{faMoney(Number(detailPricing.discountAmountRial ?? 0))}</span>
                </div>
              </div>
            )}

            {/* receipt */}
            {detail.receiptMediaId ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginBottom: 6 }}>رسید واریزی</div>
                <a
                  href={`/api/v1/media/${detail.receiptMediaId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-block', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}
                  title="مشاهدهٔ رسید در تب جدید"
                >
                  <img
                    src={`/api/v1/media/${detail.receiptMediaId}`}
                    alt="رسید واریزی کاربر"
                    loading="lazy"
                    style={{ display: 'block', maxWidth: '100%', maxHeight: 320, objectFit: 'contain', background: 'var(--surface-2)' }}
                  />
                </a>
                {strField(detail.receiptNote) && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '6px 0 0' }}>
                    یادداشت کاربر: {strField(detail.receiptNote)}
                  </p>
                )}
              </div>
            ) : (
              detail.purpose === 'SUBSCRIPTION' && detail.gateway !== 'card_to_card' && (
                <div className="adm-note adm-note--info" role="status" style={{ marginBottom: 14 }}>
                  <span aria-hidden="true">ℹ️</span>
                  <span>این پرداخت آنلاین است و رسید کارت به کارت ندارد.</span>
                </div>
              )
            )}

            {/* everything else, 2-col */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 14,
              }}
            >
              <DetailItem
                label="کاربر"
                value={
                  `${strField(detail.userFirstName)} ${strField(detail.userLastName)}`.trim() ||
                  strField(detail.userEmail) ||
                  '—'
                }
                strong
              />
              <DetailItem label="ایمیل کاربر" value={strField(detail.userEmail) || '—'} ltr />
              <DetailItem label="موبایل کاربر" value={strField(detail.userMobile) ? faDigits(strField(detail.userMobile)) : '—'} ltr />
              <DetailItem label="پلن خریداری‌شده" value={strField(detail.planNameFa) || (detail.purpose === 'WALLET_TOPUP' ? '— (شارژ کیف پول)' : '—')} strong />
              <DetailItem label="مدت اشتراک" value={detail.purpose === 'SUBSCRIPTION' ? `${faDigits(Number(detail.months ?? 1))} ماه` : '—'} />
              <DetailItem label="مبلغ نهایی" value={faMoney(detail.amountRial)} strong />
              <DetailItem label="درگاه" value={GATEWAY_FA[detail.gateway ?? ''] ?? 'درگاه نامشخص'} />
              <DetailItem label="کد رهگیری" value={strField(detail.reference) || '—'} ltr />
              <DetailItem label="شناسهٔ درگاه" value={strField(detail.gatewayRef) || '—'} ltr />
              <DetailItem label="زمان ثبت" value={faDateTime(detail.createdAt)} />
              <DetailItem label="زمان تأیید" value={detail.verifiedAt ? faDateTime(detail.verifiedAt) : '—'} />
              <DetailItem label="بررسی‌کننده" value={detail.reviewedByName || '—'} />
              <DetailItem label="زمان بازبینی" value={detail.reviewedAt ? faDateTime(detail.reviewedAt) : '—'} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
              {canReview && (
                <>
                  <Button onClick={() => setApproveId(detail.id)}>تأیید پرداخت</Button>
                  {detail.state === 'PENDING_REVIEW' && (
                    <Button variant="ghost" onClick={() => { setRejectId(detail.id); setRejectReason(''); }}>رد رسید</Button>
                  )}
                </>
              )}
              <Button variant="ghost" onClick={() => setDetailId(null)}>بستن</Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={approveId !== null}
        onClose={() => setApproveId(null)}
        onConfirm={() => void approvePayment()}
        title="تأیید پرداخت"
        message={`تأیید پرداخت ${faMoney(approveTarget?.amountRial)} باعث فعال‌سازی اشتراک یا شارژ کیف پول کاربر می‌شود. ادامه می‌دهید؟`}
        danger
        busy={approveBusy}
      />

      <Modal open={rejectId !== null} onClose={() => setRejectId(null)} title="رد رسید پرداخت">
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
          دلیل رد برای کاربر ارسال می‌شود؛ پس از رد، پرداخت قابل بررسی مجدد نیست.
        </p>
        <Field label="دلیل رد" required hint="مثلاً: مبلغ رسید با فاکتور مطابقت ندارد یا تصویر ناخوانا است.">
          <ContentComposerTextarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="دلیل رد رسید…" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="danger" loading={rejectBusy} disabled={rejectReason.trim().length < 3} onClick={() => void rejectPayment()}>
            رد پرداخت
          </Button>
          <Button variant="ghost" onClick={() => setRejectId(null)}>انصراف</Button>
        </div>
      </Modal>
    </>
  );
}
