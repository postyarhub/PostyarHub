import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../lib/api';
import '../styles/surveys.css';

type PublicOption = { id: string; label: string; sortOrder: number; voteCount: number };
type PublicSurvey = { id: string; question: string; description: string | null; createdAt: string; options: PublicOption[]; totalVotes: number; hasVoted: boolean };
function errorMessage(error: unknown): string { return error instanceof ApiRequestError ? error.message : 'ثبت رأی انجام نشد. چند لحظه بعد دوباره تلاش کنید.'; }

export default function HomeSurvey() {
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [choice, setChoice] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.get<{ survey: PublicSurvey | null }>('/api/v1/surveys/featured').then((data) => { if (active) setSurvey(data.survey); })
      .catch(() => { if (active) setSurvey(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function vote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!survey || !choice || sending || survey.hasVoted) return;
    setSending(true); setError(''); setMessage('');
    try {
      const result = await api.post<{ survey: PublicSurvey | null }>(`/api/v1/surveys/${survey.id}/vote`, { optionId: choice });
      setSurvey(result.survey); setMessage('رأی شما با موفقیت ثبت شد.');
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiRequestError && e.status === 409) {
        try { const latest = await api.get<{ survey: PublicSurvey | null }>('/api/v1/surveys/featured'); setSurvey(latest.survey); } catch { /* keep the visible data */ }
      }
    } finally { setSending(false); }
  }
  if (loading || !survey) return null;
  return <section className="py-survey-wrap" aria-labelledby="py-survey-title"><div className="py-survey-card">
    <div className="py-survey-intro"><span className="py-survey-kicker"><span className="py-survey-live-dot" /> صدای شما مهم است</span><h2 id="py-survey-title">در نظرسنجی پُست‌یار شرکت کنید</h2><p>با انتخاب یک گزینه، به بهتر شدن تجربهٔ پُست‌یار کمک کنید.</p></div>
    <div className="py-survey-question"><h3>{survey.question}</h3>{survey.description && <p>{survey.description}</p>}
      <form onSubmit={vote}><div className="py-survey-options" role="radiogroup" aria-label={survey.question}>{survey.options.map((option) => {
        const percentage = survey.totalVotes > 0 ? Math.round((option.voteCount / survey.totalVotes) * 100) : 0;
        return <label key={option.id} className={`py-survey-option${choice === option.id ? ' is-selected' : ''}${survey.hasVoted ? ' is-result' : ''}`}>
          {!survey.hasVoted && <input type="radio" name="postyar-survey-option" value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />}
          <span className="py-survey-option-label">{option.label}</span>{survey.hasVoted && <span className="py-survey-percent">{percentage.toLocaleString('fa-IR')}٪</span>}
          {survey.hasVoted && <span className="py-survey-progress" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></span>}
        </label>;
      })}</div><div className="py-survey-actions">{survey.hasVoted ? <span className="py-survey-voted"><span aria-hidden="true">✓</span> رأی شما ثبت شده است</span> : <button className="py-survey-submit" type="submit" disabled={!choice || sending}>{sending ? 'در حال ثبت…' : 'ثبت رأی'} <span aria-hidden="true">←</span></button>}<span className="py-survey-total">{survey.totalVotes.toLocaleString('fa-IR')} شرکت‌کننده</span></div>
        {error && <p className="py-survey-error" role="alert">{error}</p>}{message && <p className="py-survey-success" role="status">{message}</p>}
      </form><p className="py-survey-privacy">رأی به‌صورت ناشناس ثبت می‌شود؛ نتایج فقط به شکل آماری نمایش داده می‌شوند.</p>
    </div>
  </div></section>;
}
