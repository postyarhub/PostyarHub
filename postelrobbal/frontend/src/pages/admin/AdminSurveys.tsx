import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import '../../styles/surveys.css';

type PollOption = { id: string; label: string; sortOrder: number; voteCount?: number; percentage?: number };
type Poll = { id: string; creatorId: string; question: string; description: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED'; isFeatured: number; reviewNote: string | null; createdAt: string; totalVotes?: number; options: PollOption[] };
type Feedback = { id: string; userId: string; displayName: string; message: string; showOnHomepage: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED'; reviewNote: string | null; createdAt: string };
type FeedbackStats = { total: number; pending: number; approved: number; rejected: number; closed: number; public: number };
const pollLabels: Record<Poll['status'], string> = { PENDING: 'پیش‌نویس/در انتظار', APPROVED: 'فعال', REJECTED: 'رد شده', CLOSED: 'بسته‌شده' };
const feedbackLabels: Record<Feedback['status'], string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأیید شده', REJECTED: 'رد شده', CLOSED: 'از نمایش خارج شده' };
function errorMessage(error: unknown): string { return error instanceof ApiRequestError ? error.message : 'عملیات انجام نشد؛ وضعیت را بررسی و دوباره تلاش کنید.'; }

export default function AdminSurveys() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats>({ total: 0, pending: 0, approved: 0, rejected: 0, closed: 0, public: 0 });
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [pollData, feedbackData] = await Promise.all([
        api.get<{ items: Poll[] }>('/api/v1/surveys/admin'),
        api.get<{ items: Feedback[]; stats: FeedbackStats }>('/api/v1/feedback/admin'),
      ]);
      setPolls(pollData.items ?? []); setFeedback(feedbackData.items ?? []); setFeedbackStats(feedbackData.stats ?? { total: 0, pending: 0, approved: 0, rejected: 0, closed: 0, public: 0 });
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const clean = options.map((value) => value.trim()).filter(Boolean);
    if (question.trim().length < 8 || clean.length < 2 || clean.length > 8 || new Set(clean.map((v) => v.toLocaleLowerCase('fa-IR'))).size !== clean.length) { setError('سؤال باید حداقل ۸ نویسه و گزینه‌ها باید بین ۲ تا ۸ مورد یکتا باشند.'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/surveys', { question: question.trim(), description: description.trim(), options: clean });
      setQuestion(''); setDescription(''); setOptions(['', '']); setNotice('نظرسنجی ساخته شد؛ برای نمایش عمومی آن را تأیید و فعال کنید.'); await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }
  async function pollAction(item: Poll, action: 'approve' | 'reject' | 'close') {
    setBusyId(item.id); setError(''); setNotice('');
    try { const path = `/api/v1/surveys/admin/${item.id}/${action}`; if (action === 'reject') await api.post(path, { note: notes[item.id] ?? '' }); else await api.post(path, {}); setNotice(action === 'approve' ? 'نظرسنجی فعال و در صفحهٔ اصلی نمایش داده شد.' : action === 'reject' ? 'نظرسنجی رد شد.' : 'نظرسنجی بسته شد.'); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusyId(''); }
  }
  async function feedbackAction(item: Feedback, action: 'approve' | 'reject' | 'hide') {
    setBusyId(item.id); setError(''); setNotice('');
    try { await api.post(`/api/v1/feedback/admin/${item.id}/${action}`, { note: notes[item.id] ?? '' }); setNotice(action === 'approve' ? (item.showOnHomepage === 1 ? 'نظر تأیید شد و برای نمایش عمومی مجاز است.' : 'نظر تأیید شد؛ چون اجازهٔ انتشار عمومی ثبت نشده، در صفحهٔ اصلی نمایش داده نمی‌شود.') : action === 'reject' ? 'نظر رد شد.' : 'نظر از نمایش عمومی خارج شد.'); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusyId(''); }
  }
  return <div className="py-surveys-page py-feedback-admin-page">
    <header className="py-surveys-heading"><div><span className="py-survey-kicker">مدیریت مشارکت کاربران</span><h1>نظرات و پیشنهادات</h1><p>ساخت نظرسنجی، مشاهدهٔ آمار رأی‌ها و بررسی نظرات کاربران از یک بخش.</p></div><button type="button" className="py-survey-secondary" onClick={() => void load()}>تازه‌سازی اطلاعات</button></header>
    {error && <p className="py-survey-error" role="alert">{error}</p>}{notice && <p className="py-survey-success" role="status">{notice}</p>}
    <section className="py-feedback-stats" aria-label="آمار نظرات کاربران"><article><span>کل نظرات</span><strong>{feedbackStats.total.toLocaleString('fa-IR')}</strong></article><article><span>در انتظار بررسی</span><strong>{feedbackStats.pending.toLocaleString('fa-IR')}</strong></article><article><span>تأییدشده</span><strong>{feedbackStats.approved.toLocaleString('fa-IR')}</strong></article><article><span>منتشرشده در صفحهٔ اصلی</span><strong>{feedbackStats.public.toLocaleString('fa-IR')}</strong></article></section>
    <section className="py-survey-form-card py-feedback-admin-create"><h2>ساخت نظرسنجی جدید</h2><p className="py-surveys-muted">ایجاد نظرسنجی فقط در اختیار مدیر است. پس از ساخت، آن را از فهرست پایین فعال کنید.</p><form onSubmit={createPoll} className="py-survey-editor">
      <label>سؤال نظرسنجی<input value={question} onChange={(e) => setQuestion(e.target.value)} minLength={8} maxLength={200} required placeholder="مثلاً کدام قابلیت پُست‌یار برای شما مفیدتر است؟" /></label>
      <label>توضیح کوتاه <span className="py-surveys-muted">(اختیاری)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} placeholder="توضیح تکمیلی" /></label>
      <div className="py-survey-options-editor"><div className="py-survey-editor-title"><strong>گزینه‌های پاسخ</strong><span className="py-surveys-muted">۲ تا ۸ گزینه</span></div>
        {options.map((value, index) => <div className="py-survey-option-input" key={index}><input aria-label={`گزینه ${index + 1}`} value={value} onChange={(e) => setOptions((prev) => prev.map((v, i) => i === index ? e.target.value : v))} maxLength={100} required={index < 2} placeholder={`گزینه ${index + 1}`} /><button className="py-survey-remove" type="button" disabled={options.length <= 2} aria-label={`حذف گزینه ${index + 1}`} onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}>×</button></div>)}
        <button className="py-survey-add-option" type="button" disabled={options.length >= 8} onClick={() => setOptions((prev) => [...prev, ''])}>+ افزودن گزینه</button>
      </div><div className="py-survey-form-footer"><span>هر نظرسنجی فعال، رأی‌ها و درصد گزینه‌ها را در همین صفحه نشان می‌دهد.</span><button className="py-survey-submit" type="submit" disabled={saving}>{saving ? 'در حال ذخیره…' : 'ساخت نظرسنجی'}</button></div>
    </form></section>
    <section className="py-feedback-admin-section"><div className="py-feedback-section-head"><div><h2>مدیریت نظرسنجی‌ها</h2><p>تعداد رأی کل و توزیع رأی هر گزینه به‌صورت آماری نمایش داده می‌شود.</p></div></div>
      {loading ? <div className="py-survey-empty">در حال دریافت اطلاعات…</div> : polls.length === 0 ? <div className="py-survey-empty">هنوز نظرسنجی‌ای ساخته نشده است.</div> : <div className="py-feedback-admin-list">{polls.map((item) => <article className="py-survey-admin-card" key={item.id}><div className="py-feedback-history-top"><span className={`py-survey-status py-survey-status--${item.status.toLowerCase()}`}>{pollLabels[item.status]}</span>{item.isFeatured === 1 && <span className="py-survey-featured-label">نمایش در صفحهٔ اصلی</span>}</div><h3>{item.question}</h3>{item.description && <p className="py-survey-admin-description">{item.description}</p>}<div className="py-feedback-poll-total"><strong>{(item.totalVotes ?? item.options.reduce((n, option) => n + (option.voteCount ?? 0), 0)).toLocaleString('fa-IR')}</strong><span>رأی ثبت‌شده</span><time>{new Date(item.createdAt).toLocaleDateString('fa-IR')}</time></div><div className="py-feedback-poll-options">{item.options.map((option) => { const total = item.totalVotes ?? item.options.reduce((n, o) => n + (o.voteCount ?? 0), 0); const n = option.voteCount ?? 0; const pct = option.percentage ?? (total ? Math.round(n * 100 / total) : 0); return <div className="py-feedback-poll-option" key={option.id}><div><span>{option.label}</span><strong>{n.toLocaleString('fa-IR')} · {pct.toLocaleString('fa-IR')}٪</strong></div><span className="py-feedback-poll-bar"><span style={{ width: `${pct}%` }} /></span></div>; })}</div><label className="py-survey-review-field">یادداشت مدیر<textarea rows={2} maxLength={500} value={notes[item.id] ?? item.reviewNote ?? ''} onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))} /></label><div className="py-survey-admin-actions"><button type="button" className="py-survey-submit" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void pollAction(item, 'approve')}>{item.status === 'APPROVED' ? 'فعال‌کردن/به‌روزرسانی' : 'تأیید و نمایش در صفحهٔ اصلی'}</button><button type="button" className="py-survey-reject" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void pollAction(item, 'reject')}>رد</button>{item.status === 'APPROVED' && <button type="button" className="py-survey-secondary" disabled={!!busyId} onClick={() => void pollAction(item, 'close')}>بستن نظرسنجی</button>}</div></article>)}</div>}
    </section>
    <section className="py-feedback-admin-section"><div className="py-feedback-section-head"><div><h2>نظرات ثبت‌شده توسط کاربران</h2><p>هیچ دیدگاهی پیش از بررسی مدیر و اجازهٔ صریح کاربر در صفحهٔ اصلی قرار نمی‌گیرد.</p></div></div>
      {loading ? <div className="py-survey-empty">در حال دریافت اطلاعات…</div> : feedback.length === 0 ? <div className="py-survey-empty">نظری برای بررسی ثبت نشده است.</div> : <div className="py-feedback-admin-list">{feedback.map((item) => <article className="py-survey-admin-card" key={item.id}><div className="py-feedback-history-top"><span className={`py-survey-status py-survey-status--${item.status.toLowerCase()}`}>{feedbackLabels[item.status]}</span><time>{new Date(item.createdAt).toLocaleDateString('fa-IR')}</time></div><h3>{item.displayName}</h3><p className="py-feedback-message">{item.message}</p><p className="py-surveys-muted">اجازهٔ نمایش عمومی: {item.showOnHomepage === 1 ? 'داده شده' : 'داده نشده'} · شناسهٔ حساب: {item.userId}</p><label className="py-survey-review-field">یادداشت بررسی/دلیل رد<textarea rows={2} maxLength={500} value={notes[item.id] ?? item.reviewNote ?? ''} onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))} placeholder="یادداشت مدیریتی؛ در سایت عمومی نمایش داده نمی‌شود" /></label><div className="py-survey-admin-actions"><button type="button" className="py-survey-submit" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void feedbackAction(item, 'approve')}>تأیید نظر</button><button type="button" className="py-survey-reject" disabled={!!busyId || item.status === 'CLOSED'} onClick={() => void feedbackAction(item, 'reject')}>رد نظر</button><button type="button" className="py-survey-secondary" disabled={!!busyId} onClick={() => void feedbackAction(item, 'hide')}>خروج از نمایش</button></div></article>)}</div>}
    </section>
  </div>;
}
