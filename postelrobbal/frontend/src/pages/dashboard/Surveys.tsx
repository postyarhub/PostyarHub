import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import '../../styles/surveys.css';

type SurveyOption = { id: string; label: string; sortOrder: number };
type UserSurvey = { id: string; question: string; description: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED'; reviewNote: string | null; createdAt: string; options: SurveyOption[] };
const statusLabel: Record<UserSurvey['status'], string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأیید شده و منتشرشده', REJECTED: 'رد شده', CLOSED: 'بسته‌شده' };
function errorMessage(error: unknown): string { return error instanceof ApiRequestError ? error.message : 'عملیات انجام نشد؛ دوباره تلاش کنید.'; }

export default function Surveys() {
  const { me } = useAuth();
  const [items, setItems] = useState<UserSurvey[]>([]);
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await api.get<{ items: UserSurvey[] }>('/api/v1/surveys/mine'); setItems(data.items ?? []); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const cleanOptions = options.map((item) => item.trim()).filter(Boolean);
    if (question.trim().length < 8 || cleanOptions.length < 2 || cleanOptions.length > 8) { setError('سؤال باید حداقل ۸ نویسه و تعداد گزینه‌ها بین ۲ تا ۸ باشد.'); return; }
    if (new Set(cleanOptions.map((item) => item.toLocaleLowerCase('fa-IR'))).size !== cleanOptions.length) { setError('گزینه‌های تکراری مجاز نیستند.'); return; }
    setSending(true);
    try {
      await api.post<{ survey: UserSurvey }>('/api/v1/surveys', { question: question.trim(), description: description.trim(), options: cleanOptions });
      setQuestion(''); setDescription(''); setOptions(['', '']);
      setNotice('نظرسنجی برای بررسی مدیر ارسال شد و تا زمان تأیید عمومی نخواهد شد.');
      await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSending(false); }
  }
  return <div className="py-surveys-page">
    <header className="py-surveys-heading"><div><span className="py-survey-kicker">مشارکت در بهبود پُست‌یار</span><h1>نظرسنجی‌ها</h1><p>پیشنهاد نظرسنجی ثبت کنید؛ انتشار در صفحهٔ اصلی فقط پس از تأیید مدیر انجام می‌شود.</p></div>{me?.user?.role === 'SUPER_ADMIN' && <Link className="py-survey-secondary" to="/dashboard/admin/surveys">مدیریت و تأیید نظرسنجی‌ها</Link>}</header>
    <section className="py-survey-form-card"><h2>ثبت نظرسنجی جدید</h2><form onSubmit={submit} className="py-survey-editor">
      <label>سؤال نظرسنجی<input value={question} onChange={(e) => setQuestion(e.target.value)} minLength={8} maxLength={200} required placeholder="مثلاً کدام قابلیت بیشترین کمک را به شما می‌کند؟" /></label>
      <label>توضیح کوتاه <span className="py-surveys-muted">(اختیاری)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="هدف نظرسنجی یا توضیح تکمیلی" /></label>
      <div className="py-survey-options-editor"><div className="py-survey-editor-title"><strong>گزینه‌های پاسخ</strong><span className="py-surveys-muted">۲ تا ۸ گزینه</span></div>
        {options.map((item, index) => <div className="py-survey-option-input" key={index}><input aria-label={`گزینه ${index + 1}`} value={item} onChange={(e) => setOptions((current) => current.map((value, i) => i === index ? e.target.value : value))} maxLength={100} placeholder={`گزینه ${index + 1}`} required={index < 2} /><button type="button" className="py-survey-remove" aria-label={`حذف گزینه ${index + 1}`} disabled={options.length <= 2} onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}>×</button></div>)}
        <button type="button" className="py-survey-add-option" disabled={options.length >= 8} onClick={() => setOptions((current) => [...current, ''])}>+ افزودن گزینه</button>
      </div><div className="py-survey-form-footer"><span>نظرسنجی پس از بررسی مدیر قابل نمایش عمومی می‌شود.</span><button type="submit" className="py-survey-submit" disabled={sending}>{sending ? 'در حال ارسال…' : 'ارسال برای بررسی'}</button></div>
      {error && <p className="py-survey-error" role="alert">{error}</p>}{notice && <p className="py-survey-success" role="status">{notice}</p>}
    </form></section>
    <section className="py-surveys-history"><div className="py-survey-list-heading"><h2>نظرسنجی‌های من</h2><button type="button" className="py-survey-text-button" onClick={() => void load()}>تازه‌سازی</button></div>
      {loading ? <div className="py-survey-empty">در حال دریافت اطلاعات…</div> : items.length === 0 ? <div className="py-survey-empty">هنوز نظرسنجی ثبت نکرده‌اید.</div> : items.map((item) => <article className="py-survey-history-card" key={item.id}><div className="py-survey-history-main"><span className={`py-survey-status py-survey-status--${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span><h3>{item.question}</h3><div className="py-survey-history-options">{item.options.map((option) => <span key={option.id}>{option.label}</span>)}</div>{item.reviewNote && <p className="py-surveys-review-note">یادداشت مدیر: {item.reviewNote}</p>}</div><time>{new Date(item.createdAt).toLocaleDateString('fa-IR')}</time></article>)}
    </section>
  </div>;
}
