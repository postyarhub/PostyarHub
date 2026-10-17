import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import '../../styles/surveys.css';

type FeedbackItem = { id: string; displayName: string; message: string; showOnHomepage: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED'; statusLabel?: string; reviewNote: string | null; createdAt: string };
const labels: Record<FeedbackItem['status'], string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأیید شده', REJECTED: 'رد شده', CLOSED: 'از نمایش خارج شده' };
function errorMessage(error: unknown): string { return error instanceof ApiRequestError ? error.message : 'ثبت نظر انجام نشد؛ دوباره تلاش کنید.'; }

export default function Surveys() {
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [showOnHomepage, setShowOnHomepage] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api.get<{ items: FeedbackItem[] }>('/api/v1/feedback/mine'); setItems(result.items ?? []); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (message.trim().length < 30) { setError('متن نظر باید حداقل ۳۰ نویسه باشد.'); return; }
    setSending(true);
    try {
      await api.post('/api/v1/feedback', { displayName: displayName.trim(), message: message.trim(), showOnHomepage });
      setMessage(''); setNotice('نظر شما ثبت شد و پس از بررسی مدیر دربارهٔ انتشار آن تصمیم‌گیری می‌شود.');
      await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSending(false); }
  }
  return <div className="py-surveys-page py-feedback-page">
    <header className="py-surveys-heading"><div><span className="py-survey-kicker">صدای کاربران پُست‌یار</span><h1>نظرات و پیشنهادات</h1><p>تجربه، پیشنهاد یا انتقاد خود را با ما در میان بگذارید. انتشار عمومی فقط پس از تأیید مدیر و با اجازهٔ شما انجام می‌شود.</p></div></header>
    <section className="py-survey-form-card py-feedback-compose"><h2>ثبت نظر جدید</h2><form onSubmit={submit} className="py-survey-editor">
      <label>نام نمایشی<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={80} required placeholder="نامی که برای نمایش انتخاب می‌کنید" /></label>
      <label>نظر یا پیشنهاد شما<textarea value={message} onChange={(e) => setMessage(e.target.value)} minLength={30} maxLength={2000} rows={6} required placeholder="تجربهٔ استفاده از پُست‌یار، پیشنهادهای شما یا بخشی که می‌تواند بهتر شود…" /></label>
      <label className="py-feedback-consent"><input type="checkbox" checked={showOnHomepage} onChange={(e) => setShowOnHomepage(e.target.checked)} /><span>اجازه می‌دهم در صورت تأیید مدیر، نام نمایشی و متن این نظر در صفحهٔ اصلی پُست‌یار منتشر شود.</span></label>
      <p className="py-surveys-muted">این انتخاب اختیاری است. نظر شما بدون اجازهٔ نمایش عمومی در صفحهٔ اصلی منتشر نمی‌شود.</p>
      {error && <p className="py-survey-error" role="alert">{error}</p>}{notice && <p className="py-survey-success" role="status">{notice}</p>}
      <div className="py-survey-form-footer"><span>وضعیت بررسی را در همین صفحه پیگیری می‌کنید.</span><button type="submit" className="py-survey-submit" disabled={sending}>{sending ? 'در حال ثبت…' : 'ارسال برای بررسی'}</button></div>
    </form></section>
    <section className="py-feedback-history"><div className="py-feedback-section-head"><div><h2>نظرهای ثبت‌شدهٔ شما</h2><p>نتیجهٔ بررسی و وضعیت انتشار هر مورد در این بخش نمایش داده می‌شود.</p></div><button className="py-survey-secondary" type="button" onClick={() => void load()}>تازه‌سازی</button></div>
      {loading ? <div className="py-survey-empty">در حال دریافت سوابق…</div> : items.length === 0 ? <div className="py-survey-empty">هنوز نظری ثبت نکرده‌اید.</div> : <div className="py-feedback-history-grid">{items.map((item) => <article className="py-feedback-history-card" key={item.id}><div className="py-feedback-history-top"><span className={`py-survey-status py-survey-status--${item.status.toLowerCase()}`}>{item.statusLabel ?? labels[item.status]}</span><time>{new Date(item.createdAt).toLocaleDateString('fa-IR')}</time></div><p>{item.message}</p>{item.showOnHomepage === 1 && <span className="py-feedback-consent-state">اجازهٔ نمایش عمومی ثبت شده</span>}{item.reviewNote && <p className="py-surveys-review-note">یادداشت مدیر: {item.reviewNote}</p>}</article>)}</div>}
    </section>
  </div>;
}
