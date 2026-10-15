import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, Field, Select, StatCard } from '../../components/ui';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';

/** نام فارسی ارائه‌دهندگان — هیچ متنی انگلیسی در رابط نمایش داده نمی‌شود (§43). */
const PROVIDERS: Array<{ key: string; label: string }> = [
  { key: 'openai', label: 'اوپن‌ای‌آی' },
  { key: 'gemini', label: 'جیمینای' },
  { key: 'deepseek', label: 'دیپ‌سیک' },
  { key: 'anthropic', label: 'کلاد' },
  { key: 'mistral', label: 'میسترال' },
  { key: 'openrouter', label: 'اوپن‌روتر' },
];

interface AiJob {
  status?: string | null;
  outputText?: string | null;
  errorCode?: string | null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function Ai() {
  const toast = useToast();
  const [usageLoading, setUsageLoading] = useState(true);
  const [used, setUsed] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [limit, setLimit] = useState<number | null>(null);

  const [text, setText] = useState('');
  const [provider, setProvider] = useState('openai');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const usage = await api.get<{ requestCount?: number; tokenCount?: number }>('/api/v1/ai/usage');
        if (!alive) return;
        setUsed(Number(usage.requestCount ?? 0));
        setTokens(Number(usage.tokenCount ?? 0));
        const me = await api
          .get<{ plan?: { limits?: { ai_monthly?: number } } }>('/api/v1/subscriptions/me')
          .catch(() => null);
        if (!alive) return;
        const l = me?.plan?.limits?.ai_monthly;
        setLimit(typeof l === 'number' ? l : null);
      } catch {
        // usage card stays at zero
      } finally {
        if (alive) setUsageLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // polling loop: every 2 seconds until terminal state
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await api.get<{ job?: AiJob }>(`/api/v1/ai/jobs/${jobId}`);
        if (!alive) return;
        const j = d.job ?? null;
        setJob(j);
        const st = j?.status ?? '';
        if (st !== 'COMPLETED' && st !== 'FAILED') {
          timerRef.current = window.setTimeout(() => void tick(), 2000);
        }
      } catch {
        if (alive) timerRef.current = window.setTimeout(() => void tick(), 3000);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [jobId]);

  const generate = useCallback(async () => {
    if (!text.trim()) {
      toast.error('متن یا موضوع کپشن را وارد کنید.');
      return;
    }
    setSubmitting(true);
    setJob(null);
    setJobId(null);
    try {
      const d = await api.post<{ jobId?: string }>('/api/v1/ai/caption', { text: text.trim(), provider });
      if (!d.jobId) {
        toast.error('درخواست ساخته نشد؛ دوباره تلاش کنید.');
        return;
      }
      setJobId(d.jobId);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ارسال درخواست ناموفق بود.');
    } finally {
      setSubmitting(false);
    }
  }, [text, provider, toast]);

  const status = job?.status ?? null;
  const running = submitting || (jobId !== null && status === null) || status === 'QUEUED' || status === 'RUNNING';

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>هوش مصنوعی</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>کپشن‌های آمادهٔ انتشار با کمک دستیار هوشمند پُست‌یار.</p>
      </div>

      {!usageLoading && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: 20 }}>
          <StatCard
            icon="🧠"
            bg="var(--brand-soft)"
            value={limit !== null && limit > 0 ? `${faNumber(used)} از ${faNumber(limit)}` : faNumber(used)}
            label="درخواست هوش مصنوعی در این ماه"
          />
          <StatCard icon="🔤" bg="var(--info-soft)" value={faNumber(tokens)} label="نویسه‌های مصرفی این ماه" />
        </div>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', maxWidth: 1000 }}>
        <Card pad="lg">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>کپشن‌ساز هوش مصنوعی</h2>
          <Field label="موضوع یا متن پایه" required hint="دربارهٔ محصول، خدمت یا خبری که می‌خواهید بنویسید توضیح دهید.">
            <ContentComposerTextarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: معرفی تخفیف ۲۰ درصدی نوروزی روی کرم مرطوب‌کنندهٔ پوست" />
          </Field>
          <Field label="ارائه‌دهندهٔ هوش مصنوعی" hint="اگر ارائه‌دهندهٔ انتخابی در دسترس نباشد، سرویس به‌صورت خودکار از تنظیمات پیش‌فرض استفاده می‌کند.">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => void generate()} loading={submitting}>ساخت کپشن</Button>
        </Card>

        <Card pad="lg">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>خروجی</h2>
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', fontSize: 14 }}>
              <span className="spinner" aria-hidden="true" />
              <span>هوش مصنوعی در حال نوشتن است…</span>
            </div>
          )}
          {!running && status === 'FAILED' && (
            <EmptyState
              icon="⛔"
              title="تولید کپشن ناموفق بود"
              description={
                job?.errorCode === 'AI_QUOTA_EXCEEDED'
                  ? 'سهمیهٔ هوش مصنوعی پلن شما تمام شده است؛ ماه آینده دوباره در دسترس خواهد بود یا پلن را ارتقا دهید.'
                  : 'سرویس هوش مصنوعی نتوانست پاسخ بسازد. چند لحظه بعد دوباره تلاش کنید.'
              }
            />
          )}
          {!running && status === 'COMPLETED' && (
            <>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 2, background: 'var(--surface-2)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                {job?.outputText || '—'}
              </div>
              <Button
                variant="soft"
                onClick={() => {
                  void copyText(job?.outputText ?? '').then((ok) => {
                    if (ok) toast.success('کپشن کپی شد.');
                    else toast.error('کپی انجام نشد؛ متن را دستی انتخاب کنید.');
                  });
                }}
              >
                کپی
              </Button>
            </>
          )}
          {!running && !status && (
            <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
              موضوع را در فرم مقابل بنویسید و دکمهٔ «ساخت کپشن» را بزنید؛ نتیجه اینجا نمایش داده می‌شود.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
