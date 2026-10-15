import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import '../../styles/surveys.css';

type AdminOption = { id: string; label: string; sortOrder: number };
type AdminSurvey = { id: string; creatorId: string; question: string; description: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED'; isFeatured: number; reviewNote: string | null; reviewedAt: string | null; createdAt: string; options: AdminOption[] };
const statusLabel: Record<AdminSurvey['status'], string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأیید شده', REJECTED: 'رد شده', CLOSED: 'بسته‌شده' };
function errorMessage(error: unknown): string { return error instanceof ApiRequestError ? error.message : 'عملیات انجام نشد؛ دوباره تلاش کنید.'; }

export default function AdminSurveys() {
  const [items, setItems] = useState<AdminSurvey[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await api.get<{ items: AdminSurvey[] }>('/api/v1/surveys/admin'); setItems(data.items ?? []); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function act(item: AdminSurvey, action: 'approve' | 'reject' | 'close') {
    setBusyId(item.id); setError(''); setNotice('');
    try {
      const path = `/api/v1/surveys/admin/${item.id}/${action}`;
      if (action === 'reject') await api.post(path, { note: notes[item.id] ?? '' }); else await api.post(path, {});
      setNotice(action === 'approve' ? 'نظرسنجی تأیید و به‌صورت خودکار به‌عنوان نظرسنجی برجستهٔ صفحهٔ اصلی منتشر شد.' : action === 'reject' ? 'نظرسنجی رد شد و در صفحهٔ اصلی نمایش داده نمی‌شود.' : 'نظرسنجی بسته و از صفحهٔ اصلی برداشته شد.');
      await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusyId(''); }
  }
  return <div className="py-surveys-page"><header className="py-surveys-heading"><div><span className="py-survey-kicker">کنترل انتشار عمومی</span><h1>مدیریت نظرسنجی‌ها</h1><p>با تأیید یک نظرسنجی، نظرسنجی برجستهٔ قبلی از صفحهٔ اصلی برداشته می‌شود.</p></div><button type="button" className="py-survey-secondary" onClick={() => void load()}>تازه‌سازی فهرست</button></header>
    {error && <p className="py-survey-error" role="alert">{error}</p>}{notice && <p className="py-survey-success" role="status">{notice}</p>}
    <section className="py-survey-admin-list">{loading ? <div className="py-survey-empty">در حال دریافت فهرست…</div> : items.length === 0 ? <div className="py-survey-empty">نظرسنجی‌ای برای بررسی ثبت نشده است.</div> : items.map((item) => <article className="py-survey-admin-card" key={item.id}>
      <div className="py-survey-admin-card-head"><span className={`py-survey-status py-survey-status--${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span>{item.isFeatured === 1 && <span className="py-survey-featured-label">نمایش در صفحهٔ اصلی</span>}</div>
      <h2>{item.question}</h2>{item.description && <p className="py-survey-admin-description">{item.description}</p>}
      <div className="py-survey-history-options">{item.options.map((option) => <span key={option.id}>{option.label}</span>)}</div>
      <div className="py-survey-admin-meta"><span>شناسه ثبت‌کننده: {item.creatorId}</span><time>{new Date(item.createdAt).toLocaleDateString('fa-IR')}</time></div>
      <label className="py-survey-review-field">یادداشت بررسی یا دلیل رد<textarea rows={2} maxLength={500} value={notes[item.id] ?? item.reviewNote ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))} placeholder="اختیاری؛ فقط در پنل مدیریت ثبت می‌شود" /></label>
      <div className="py-survey-admin-actions"><button type="button" className="py-survey-submit" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void act(item, 'approve')}>{busyId === item.id ? 'در حال ذخیره…' : 'تأیید و انتشار'}</button><button type="button" className="py-survey-reject" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void act(item, 'reject')}>رد نظرسنجی</button>{item.status === 'APPROVED' && <button type="button" className="py-survey-secondary" disabled={!!busyId} onClick={() => void act(item, 'close')}>توقف نمایش</button>}</div>
    </article>)}</section>
  </div>;
}
