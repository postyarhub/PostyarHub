import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Pagination, StatCard, StatusBadge } from '../../components/ui';
import { faDateTime, faMoney, faNumber, toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';

const ENTRY_KIND_FA: Record<string, string> = { CREDIT: 'واریز', DEBIT: 'برداشت', REFUND: 'بازگشت وجه', BONUS: 'هدیه', PAYMENT: 'پرداخت', ADJUSTMENT: 'اصلاح' };
const CREDIT_KINDS = new Set(['CREDIT', 'REFUND', 'BONUS']);
const PAYMENT_STATE_FA: Record<string, string> = { CREATED: 'ایجادشده', REDIRECTED: 'هدایت به درگاه', VERIFIED: 'تأییدشده', FAILED: 'ناموفق', CANCELLED: 'لغوشده', REFUNDED: 'بازگشت‌شده', PENDING_REVIEW: 'در انتظار تأیید رسید' };
const PURPOSE_FA: Record<string, string> = { SUBSCRIPTION: 'اشتراک', WALLET_TOPUP: 'شارژ کیف پول' };

type PayMethod = 'online' | 'card_to_card';
interface LedgerRow { id: string; entryKind?: string; amountRial?: number; balanceAfter?: number; memoFa?: string | null; createdAt?: string | null; }
interface PaymentRow { id: string; purpose?: string | null; amountRial?: number; state?: string | null; createdAt?: string | null; }
interface CardInfo { id?: string; bankName: string; cardNumber: string; holderName: string; }
interface PaymentMethods { onlineEnabled: boolean; cardToCardEnabled: boolean; cards: CardInfo[]; }

export default function Wallet() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [balanceRial, setBalanceRial] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupBusy, setTopupBusy] = useState(false);
  const [convertAmount, setConvertAmount] = useState('');
  const [convertBusy, setConvertBusy] = useState(false);
  const [methods, setMethods] = useState<PaymentMethods>({ onlineEnabled: false, cardToCardEnabled: false, cards: [] });
  const [payMethod, setPayMethod] = useState<PayMethod>('online');
  const [pendingPayment, setPendingPayment] = useState<{ paymentId: string; reference: string; cards: CardInfo[] } | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const loadWallet = useCallback(async () => {
    const d = await api.get<{ balanceRial?: number; pointsBalance?: number; ledger?: LedgerRow[]; transactions?: LedgerRow[] }>('/api/v1/wallet');
    setBalanceRial(Number(d.balanceRial ?? 0)); setPointsBalance(Number(d.pointsBalance ?? 0)); setLedger(d.ledger ?? d.transactions ?? []);
  }, []);
  const loadPayments = useCallback(async (page: number) => {
    setPaymentsLoading(true);
    try { const d = await api.get<{ items?: PaymentRow[]; total?: number; page?: number }>(`/api/v1/payments?page=${page}`); setPayments(d.items ?? []); setPaymentsTotal(Number(d.total ?? 0)); setPaymentsPage(Number(d.page ?? page)); }
    catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'دریافت تاریخچهٔ پرداخت‌ها ناموفق بود.'); }
    finally { setPaymentsLoading(false); }
  }, [toast]);
  const loadMethods = useCallback(async () => {
    try {
      const d = await api.get<PaymentMethods>('/api/v1/payments/methods');
      setMethods(d);
      setPayMethod(d.onlineEnabled ? 'online' : (d.cardToCardEnabled ? 'card_to_card' : 'online'));
    } catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'دریافت روش‌های پرداخت ناموفق بود.'); }
  }, [toast]);
  useEffect(() => { void (async () => { try { await Promise.all([loadWallet(), loadMethods()]); } catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'دریافت اطلاعات کیف پول ناموفق بود.'); } finally { setLoading(false); } })(); void loadPayments(1); }, [loadWallet, loadMethods, loadPayments, toast]);
  const parseAmount = (input: string): number => { const digits = toLatinDigits(input).replace(/[^\d]/g, ''); const n = Number(digits); return Number.isFinite(n) ? n : NaN; };
  const submitTopup = async () => {
    const toman = parseAmount(topupAmount);
    if (!Number.isInteger(toman) || toman < 10000) { toast.error('حداقل مبلغ شارژ ۱۰٬۰۰۰ تومان است.'); return; }
    if (payMethod === 'card_to_card' && (!methods.cardToCardEnabled || methods.cards.length === 0)) { toast.error('پرداخت کارت‌به‌کارت در حال حاضر در دسترس نیست.'); return; }
    if (payMethod === 'online' && !methods.onlineEnabled) { toast.error('پرداخت آنلاین در حال حاضر فعال نیست.'); return; }
    setTopupBusy(true);
    try {
      const d = await api.post<{ redirectUrl?: string; paymentId?: string; reference?: string; cards?: CardInfo[] }>('/api/v1/payments/wallet-topup', { amountRial: toman * 10, method: payMethod });
      if (payMethod === 'online' && d.redirectUrl) { window.location.href = d.redirectUrl; return; }
      if (payMethod === 'card_to_card' && d.paymentId && d.reference) { setPendingPayment({ paymentId: d.paymentId, reference: d.reference, cards: d.cards ?? methods.cards }); setReceipt(null); setReceiptNote(''); toast.success('درخواست شارژ ثبت شد؛ مبلغ را کارت‌به‌کارت و سپس رسید را ارسال کنید.'); }
      else toast.error('روش پرداخت پاسخ معتبر برنگرداند.');
    } catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'ایجاد درخواست شارژ ناموفق بود.'); }
    finally { setTopupBusy(false); }
  };
  const submitReceipt = async () => {
    if (!pendingPayment || !receipt) { toast.error('رسید پرداخت را انتخاب کنید.'); return; }
    if (receipt.size > 5 * 1024 * 1024) { toast.error('حجم رسید باید حداکثر ۵ مگابایت باشد.'); return; }
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(receipt.type)) { toast.error('فرمت رسید باید جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف باشد.'); return; }
    const fd = new FormData(); fd.append('file', receipt); if (receiptNote.trim()) fd.append('note', receiptNote.trim());
    setReceiptBusy(true);
    try { await api.postForm<{ paymentId: string; status: string }>(`/api/v1/payments/${pendingPayment.paymentId}/receipt`, fd); toast.success('رسید با موفقیت ثبت شد و برای بررسی مدیریت ارسال گردید.'); setPendingPayment(null); setReceipt(null); setReceiptNote(''); setTopupAmount(''); await loadPayments(1); }
    catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'ثبت رسید ناموفق بود.'); }
    finally { setReceiptBusy(false); }
  };
  const onReceiptChange = (e: ChangeEvent<HTMLInputElement>) => setReceipt(e.target.files?.[0] ?? null);
  const submitConvert = async () => { const points = parseAmount(convertAmount); if (!Number.isInteger(points) || points < 100) { toast.error('حداقل امتیاز قابل تبدیل ۱۰۰ امتیاز است.'); return; } if (points > pointsBalance) { toast.error('امتیاز شما کافی نیست.'); return; } setConvertBusy(true); try { const d = await api.post<{ amountRial?: number }>('/api/v1/wallet/convert-points', { points }); toast.success(`${faMoney(d.amountRial ?? points * 10)} به موجودی کیف پول شما اضافه شد.`); setConvertAmount(''); await loadWallet(); } catch (err) { toast.error(err instanceof ApiRequestError ? err.message : 'تبدیل امتیاز ناموفق بود.'); } finally { setConvertBusy(false); } };
  const signedMoney = (kind: string | undefined, amount: number | undefined): string => { const a = Number(amount ?? 0); const sign = CREDIT_KINDS.has(kind ?? '') ? '+' : '−'; return `${sign}${faMoney(Math.abs(a))}`; };
  if (loading) return <PageLoading />;
  return <div>
    <div style={{ marginBottom: 18 }}><h1 style={{ fontSize: 21, fontWeight: 800 }}>کیف پول</h1><p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>شارژ حساب، تبدیل امتیاز و پیگیری تراکنش‌ها.</p></div>
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: 20 }}><StatCard icon="💰" bg="var(--success-soft)" value={faMoney(balanceRial)} label="موجودی کیف پول" /><StatCard icon="🎯" bg="var(--brand-soft)" value={faNumber(pointsBalance)} label="امتیاز فعلی" /></div>
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 24 }}>
      <Card>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>شارژ کیف پول</h2>
        <Field label="مبلغ (تومان)" required hint="حداقل ۱۰٬۰۰۰ تومان."><Input inputMode="numeric" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="مثلاً ۲۰۰٬۰۰۰" /></Field>
        {(methods.onlineEnabled || methods.cardToCardEnabled) && <Field label="روش پرداخت" required><div style={{ display:'grid', gap:8, gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))' }}>
          {methods.onlineEnabled && <button type="button" onClick={() => setPayMethod('online')} style={{ padding:12, borderRadius:12, border:'1px solid', borderColor:payMethod==='online'?'var(--brand)':'var(--border)', background:payMethod==='online'?'var(--brand-soft)':'transparent', cursor:'pointer', textAlign:'right' }}><strong>پرداخت آنلاین</strong><div style={{ fontSize:12, color:'var(--text-2)', marginTop:4 }}>انتقال به درگاه بانکی</div></button>}
          {methods.cardToCardEnabled && <button type="button" onClick={() => setPayMethod('card_to_card')} style={{ padding:12, borderRadius:12, border:'1px solid', borderColor:payMethod==='card_to_card'?'var(--brand)':'var(--border)', background:payMethod==='card_to_card'?'var(--brand-soft)':'transparent', cursor:'pointer', textAlign:'right' }}><strong>کارت‌به‌کارت</strong><div style={{ fontSize:12, color:'var(--text-2)', marginTop:4 }}>واریز به کارت‌های پُست‌یار و ارسال رسید</div></button>}
        </div></Field>}
        {!methods.onlineEnabled && methods.cardToCardEnabled && <div className="adm-note adm-note--success" style={{ marginBottom:12 }}><span>روش فعال فعلی: کارت‌به‌کارت</span></div>}
        {!methods.onlineEnabled && !methods.cardToCardEnabled && <div className="adm-note adm-note--warning" style={{ marginBottom:12 }}><span>در حال حاضر هیچ روش پرداختی برای شارژ کیف پول فعال نیست.</span></div>}
        {payMethod==='card_to_card' && methods.cards.length>0 && <div style={{ display:'grid', gap:8, marginBottom:12 }}>{methods.cards.map((c,i)=><div key={c.id ?? i} style={{ border:'1px solid var(--border)', borderRadius:10, padding:10 }}><strong>{c.bankName}</strong><div dir="ltr" style={{ letterSpacing:1, marginTop:4 }}>{c.cardNumber}</div><div style={{ fontSize:12, color:'var(--text-2)', marginTop:4 }}>{c.holderName}</div></div>)}</div>}
        <Button onClick={() => void submitTopup()} loading={topupBusy} disabled={!methods.onlineEnabled && !methods.cardToCardEnabled}>ایجاد درخواست شارژ</Button>
      </Card>
      <Card><h2 style={{ fontSize:15,fontWeight:700,marginBottom:10 }}>تبدیل امتیاز به موجودی</h2><Field label="تعداد امتیاز" required hint="هر ۱۰ امتیاز = ۱۰ تومان؛ حداقل تبدیل ۱۰۰ امتیاز."><Input inputMode="numeric" value={convertAmount} onChange={(e)=>setConvertAmount(e.target.value)} placeholder="مثلاً ۱۰۰" /></Field><Button variant="soft" onClick={()=>void submitConvert()} loading={convertBusy}>تبدیل امتیاز</Button></Card>
    </div>
    {pendingPayment && <Card><h2 style={{fontSize:15,fontWeight:700,marginBottom:8}}>ارسال رسید شارژ</h2><p style={{fontSize:13,color:'var(--text-2)',lineHeight:2}}>مبلغ را به یکی از کارت‌های بالا واریز کنید. شماره پیگیری این درخواست:</p><div dir="ltr" style={{fontWeight:800,background:'var(--surface-2)',padding:10,borderRadius:8,marginBottom:12,textAlign:'center'}}>{pendingPayment.reference}</div><Field label="رسید پرداخت" required hint="جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف — حداکثر ۵ مگابایت"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onReceiptChange} /></Field><Field label="توضیح تکمیلی"><Input value={receiptNote} onChange={(e)=>setReceiptNote(e.target.value)} placeholder="اختیاری" /></Field><div style={{display:'flex',gap:10}}><Button onClick={()=>void submitReceipt()} loading={receiptBusy}>ثبت رسید</Button><Button variant="ghost" onClick={()=>setPendingPayment(null)}>بعداً ارسال می‌کنم</Button></div></Card>}
    <h2 style={{ fontSize:17,fontWeight:800,marginBottom:12 }}>گردش حساب (۲۰ تراکنش اخیر)</h2><Card><div className="table-wrap"><table className="table"><thead><tr><th>نوع</th><th>مبلغ</th><th>موجودی پس از تراکنش</th><th>شرح</th><th>زمان</th></tr></thead><tbody>{ledger.length===0?<tr><td colSpan={5} style={{textAlign:'center',color:'var(--text-2)'}}>تراکنشی ثبت نشده است.</td></tr>:ledger.map(row=><tr key={row.id}><td><span className="badge badge-info">{ENTRY_KIND_FA[row.entryKind ?? ''] ?? 'رویداد مالی'}</span></td><td style={{fontWeight:700}}>{signedMoney(row.entryKind,row.amountRial)}</td><td>{faMoney(row.balanceAfter)}</td><td>{row.memoFa || '—'}</td><td>{faDateTime(row.createdAt)}</td></tr>)}</tbody></table></div></Card>
    <h2 style={{ fontSize:17,fontWeight:800,margin:'26px 0 12px' }}>تاریخچهٔ پرداخت‌ها</h2><Card>{paymentsLoading?<PageLoading/>:payments.length===0?<EmptyState icon="🧾" title="پرداختی ثبت نشده است" description="پس از اولین خرید یا شارژ، رسید اینجا نمایش داده می‌شود."/>:<><div className="table-wrap"><table className="table"><thead><tr><th>بابت</th><th>مبلغ</th><th>وضعیت</th><th>زمان</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{PURPOSE_FA[p.purpose ?? ''] ?? 'پرداخت'}</td><td style={{fontWeight:700}}>{faMoney(p.amountRial)}</td><td><StatusBadge state={p.state ?? ''} labels={PAYMENT_STATE_FA}/></td><td>{faDateTime(p.createdAt)}</td></tr>)}</tbody></table></div><Pagination page={paymentsPage} pageSize={20} total={paymentsTotal} onPage={(page)=>void loadPayments(page)}/></>}</Card>
  </div>;
}
