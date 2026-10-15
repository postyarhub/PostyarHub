import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError, type BotDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Select } from '../../components/ui';
import { faDigits, toLatinDigits } from '../../lib/format';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { useToast } from '../../lib/toast';

type StepType = 'MESSAGE' | 'BUTTONS' | 'AI' | 'WAIT' | 'CONDITION';

const STEP_TYPE_FA: Record<StepType, string> = {
  MESSAGE: 'ارسال پیام',
  BUTTONS: 'ارسال دکمه',
  AI: 'پاسخ هوش مصنوعی',
  WAIT: 'توقف',
  CONDITION: 'شرط',
};

const MAX_STEPS = 20;
const MAX_BRANCH = 10;
const MAX_NESTING = 2;

interface StepUi {
  key: string;
  type: StepType;
  text: string;
  prompt: string;
  seconds: string;
  variable: string;
  operator: 'EQUALS' | 'CONTAINS';
  value: string;
  buttons: Array<{ label: string; type: 'URL' | 'CALLBACK'; value: string }>;
  then: StepUi[];
  else: StepUi[];
}

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `step-${keySeq}-${Date.now()}`;
}

function newStep(type: StepType): StepUi {
  return {
    key: newKey(),
    type,
    text: '',
    prompt: '',
    seconds: '5',
    variable: '',
    operator: 'EQUALS',
    value: '',
    buttons: [{ label: '', type: 'URL', value: '' }],
    then: [],
    else: [],
  };
}

function countSteps(steps: StepUi[]): number {
  let n = 0;
  for (const s of steps) {
    n += 1;
    if (s.type === 'CONDITION') n += countSteps(s.then) + countSteps(s.else);
  }
  return n;
}

/** Defensive conversion of stored definitionJson (unknown) back into editor state. */
function parseSteps(raw: unknown): StepUi[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const type: StepType = o.type === 'BUTTONS' || o.type === 'AI' || o.type === 'WAIT' || o.type === 'CONDITION' ? o.type : 'MESSAGE';
    const buttons = Array.isArray(o.buttons)
      ? o.buttons.map((b) => {
          const bo = (b ?? {}) as Record<string, unknown>;
          if (typeof bo.callback === 'string') return { label: typeof bo.label === 'string' ? bo.label : '', type: 'CALLBACK' as const, value: bo.callback };
          return { label: typeof bo.label === 'string' ? bo.label : '', type: 'URL' as const, value: typeof bo.url === 'string' ? bo.url : '' };
        })
      : [{ label: '', type: 'URL' as const, value: '' }];
    return {
      key: newKey(),
      type,
      text: typeof o.text === 'string' ? o.text : '',
      prompt: typeof o.prompt === 'string' ? o.prompt : '',
      seconds: o.seconds === undefined || o.seconds === null ? '5' : String(o.seconds),
      variable: typeof o.variable === 'string' ? o.variable : '',
      operator: o.operator === 'CONTAINS' ? 'CONTAINS' : 'EQUALS',
      value: typeof o.value === 'string' ? o.value : '',
      buttons,
      then: parseSteps(o.then),
      else: parseSteps(o.else),
    };
  });
}

function toDefinitionSteps(steps: StepUi[]): Array<Record<string, unknown>> {
  return steps.map((s) => {
    if (s.type === 'MESSAGE') return { type: 'MESSAGE', text: s.text.trim() };
    if (s.type === 'BUTTONS') {
      const buttons = s.buttons
        .filter((b) => b.label.trim() && b.value.trim())
        .map((b) => b.type === 'CALLBACK'
          ? { label: b.label.trim(), callback: b.value.trim() }
          : { label: b.label.trim(), url: b.value.trim() });
      return { type: 'BUTTONS', text: s.text.trim(), buttons };
    }
    if (s.type === 'AI') return { type: 'AI', prompt: s.prompt.trim() };
    if (s.type === 'WAIT') return { type: 'WAIT', seconds: Number(toLatinDigits(s.seconds).trim() || '0') };
    return {
      type: 'CONDITION',
      variable: s.variable.trim(),
      operator: s.operator,
      value: s.value,
      then: toDefinitionSteps(s.then),
      else: toDefinitionSteps(s.else),
    };
  });
}

function StepCard({ step, level, onChange, onRemove, totalUsed }: {
  step: StepUi;
  level: number;
  onChange: (next: StepUi) => void;
  onRemove: () => void;
  totalUsed: number;
}) {
  const conditionAllowed = level < MAX_NESTING;
  const branchFull = (branch: StepUi[]) => branch.length >= MAX_BRANCH || totalUsed >= MAX_STEPS;

  const branchEditor = (branchKey: 'then' | 'else', title: string) => (
    <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
      {step[branchKey].length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}>هیچ مرحله‌ای در این شاخه نیست.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {step[branchKey].map((child, i) => (
            <StepCard
              key={child.key}
              step={child}
              level={level + 1}
              totalUsed={totalUsed}
              onChange={(next) => onChange({ ...step, [branchKey]: step[branchKey].map((x, j) => (j === i ? next : x)) })}
              onRemove={() => onChange({ ...step, [branchKey]: step[branchKey].filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      )}
      <Button size="sm" variant="soft" disabled={branchFull(step[branchKey])} onClick={() => onChange({ ...step, [branchKey]: [...step[branchKey], newStep('MESSAGE')] })}>
        + افزودن مرحله به شاخه
      </Button>
    </div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="badge badge-brand">مرحله</span>
        <Select
          value={step.type}
          onChange={(e) => onChange({ ...newStep(e.target.value as StepType), key: step.key })}
          style={{ maxWidth: 220 }}
          aria-label="نوع مرحله"
        >
          {Object.entries(STEP_TYPE_FA)
            .filter(([k]) => k !== 'CONDITION' || conditionAllowed)
            .map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
        </Select>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="danger" onClick={onRemove} aria-label="حذف مرحله">حذف مرحله</Button>
      </div>

      {(step.type === 'MESSAGE' || step.type === 'BUTTONS') && (
        <Field label="متن پیام" required>
          <ContentComposerTextarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="متن پیام…" />
        </Field>
      )}

      {step.type === 'BUTTONS' && (
        <Field label="دکمه‌ها" hint="برای هر دکمه، نشانی لینک اختیاری است.">
          <div style={{ display: 'grid', gap: 8 }}>
            {step.buttons.map((b, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'start' }}>
                <Input style={{ flex: '1 1 160px' }} value={b.label} onChange={(e) => onChange({ ...step, buttons: step.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="عنوان دکمه" />
                <Select style={{ flex: '0 1 150px' }} value={b.type} onChange={(e) => onChange({ ...step, buttons: step.buttons.map((x, j) => (j === i ? { ...x, type: e.target.value as 'URL' | 'CALLBACK' } : x)) })}><option value="URL">لینک</option><option value="CALLBACK">Callback</option></Select>
                <Input style={{ flex: '1 1 220px' }} dir="ltr" value={b.value} onChange={(e) => onChange({ ...step, buttons: step.buttons.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder={b.type === 'CALLBACK' ? 'menu:products' : 'https://…'} />
                <Button variant="ghost" size="sm" onClick={() => onChange({ ...step, buttons: step.buttons.filter((_, j) => j !== i) })} aria-label="حذف دکمه">✕</Button>
              </div>
            ))}
            {step.buttons.length < 8 && (
              <Button size="sm" variant="soft" onClick={() => onChange({ ...step, buttons: [...step.buttons, { label: '', type: 'URL', value: '' }] })}>+ افزودن دکمه</Button>
            )}
          </div>
        </Field>
      )}

      {step.type === 'AI' && (
        <Field label="دستور تولید پاسخ (پرامپت)" required hint="هوش مصنوعی با توجه به این دستور، پاسخ کاربر را می‌سازد.">
          <ContentComposerTextarea value={step.prompt} onChange={(e) => onChange({ ...step, prompt: e.target.value })} placeholder="مثلاً: به سبک دوستانه محصولات مشابه را پیشنهاد بده." />
        </Field>
      )}

      {step.type === 'WAIT' && (
        <Field label="مدت توقف (ثانیه)" required hint="بین ۱ تا ۶۰ ثانیه.">
          <Input
            type="text"
            inputMode="numeric"
            value={faDigits(step.seconds)}
            onChange={(e) => onChange({ ...step, seconds: toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 2) })}
            aria-label="مدت توقف به ثانیه"
            style={{ maxWidth: 160 }}
          />
        </Field>
      )}

      {step.type === 'CONDITION' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="متغیر" required>
              <Input value={step.variable} onChange={(e) => onChange({ ...step, variable: e.target.value })} placeholder="مثلاً lastMessage" />
            </Field>
            <Field label="عملگر" required>
              <Select value={step.operator} onChange={(e) => onChange({ ...step, operator: e.target.value === 'CONTAINS' ? 'CONTAINS' : 'EQUALS' })}>
                <option value="EQUALS">برابر است با</option>
                <option value="CONTAINS">شامل</option>
              </Select>
            </Field>
            <Field label="مقدار" required>
              <Input value={step.value} onChange={(e) => onChange({ ...step, value: e.target.value })} placeholder="مقدار مقایسه" />
            </Field>
          </div>
          {branchEditor('then', 'اگر شرط برقرار بود (آنگاه)')}
          {branchEditor('else', 'اگر شرط برقرار نبود (در غیر این صورت)')}
        </>
      )}
    </div>
  );
}

export default function WorkflowBuilder() {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [botId, setBotId] = useState('');
  const [nameFa, setNameFa] = useState('');
  const [steps, setSteps] = useState<StepUi[]>([newStep('MESSAGE')]);
  const [saving, setSaving] = useState(false);
  const loadToastShown = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.get<{ items?: BotDto[]; bots?: BotDto[] }>('/api/v1/bots');
        if (!alive) return;
        const list = d.items ?? d.bots ?? [];
        setBots(list);
        if (editId) {
          const wf = await api.get<{ items?: Array<Record<string, unknown>> }>(`/api/v1/workflows?page=1&pageSize=100`);
          if (!alive) return;
          const found = (wf.items ?? []).find((w) => w.id === editId);
          if (found) {
            setNameFa(typeof found.nameFa === 'string' ? found.nameFa : '');
            setBotId(typeof found.botId === 'string' ? found.botId : '');
            const def = (found.definitionJson ?? {}) as { steps?: unknown };
            const parsed = parseSteps(def.steps);
            setSteps(parsed.length > 0 ? parsed : [newStep('MESSAGE')]);
          } else {
            if (!loadToastShown.current) {
              toast.info('گردش‌کار برای ویرایش پیدا نشد؛ یک گردش‌کار جدید بسازید.');
              loadToastShown.current = true;
            }
          }
        }
      } catch (err) {
        toast.error(err instanceof ApiRequestError ? err.message : 'بارگذاری اطلاعات ناموفق بود.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const activeBots = useMemo(() => bots.filter((b) => b.status === 'ACTIVE'), [bots]);
  const used = countSteps(steps);

  const validate = useCallback((): string | null => {
    if (!botId) return 'ربات را انتخاب کنید.';
    if (!nameFa.trim()) return 'نام گردش‌کار را وارد کنید.';
    if (steps.length === 0) return 'حداقل یک مرحله لازم است.';
    const check = (list: StepUi[]): string | null => {
      for (const s of list) {
        if ((s.type === 'MESSAGE' || s.type === 'BUTTONS') && !s.text.trim()) return 'متن پیام مراحل را کامل کنید.';
        if (s.type === 'BUTTONS' && !s.buttons.some((b) => b.label.trim())) return 'برای مرحلهٔ دکمه، حداقل یک دکمه با عنوان وارد کنید.';
        if (s.type === 'AI' && !s.prompt.trim()) return 'دستور هوش مصنوعی در مراحل هوش مصنوعی را کامل کنید.';
        if (s.type === 'WAIT') {
          const sec = Number(toLatinDigits(s.seconds).trim());
          if (!Number.isInteger(sec) || sec < 1 || sec > 60) return 'مدت توقف باید عددی بین ۱ تا ۶۰ ثانیه باشد.';
        }
        if (s.type === 'CONDITION') {
          if (!s.variable.trim() || !s.value) return 'متغیر و مقدار شرط را کامل کنید.';
          const nested = check(s.then) ?? check(s.else);
          if (nested) return nested;
        }
      }
      return null;
    };
    return check(steps);
  }, [botId, nameFa, steps]);

  const save = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body = {
        botId,
        nameFa: nameFa.trim(),
        definition: { trigger: { kind: 'MESSAGE_RECEIVED' }, steps: toDefinitionSteps(steps) },
      };
      if (editId) {
        await api.put(`/api/v1/workflows/${editId}`, body);
        toast.success('گردش‌کار به‌روزرسانی شد.');
      } else {
        await api.post('/api/v1/workflows', body);
        toast.success('گردش‌کار ساخته شد.');
      }
      window.location.assign('/dashboard/workflows');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ گردش‌کار ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/dashboard/workflows" style={{ fontSize: 13 }}>← بازگشت به گردش‌کارها</Link>
        <h1 style={{ fontSize: 21, fontWeight: 800, marginTop: 8 }}>{editId ? 'ویرایش گردش‌کار' : 'ساخت گردش‌کار جدید'}</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          بدون کدنویسی، مراحل را اضافه کنید: پیام، دکمه، پاسخ هوش مصنوعی، توقف و شرط.
        </p>
      </div>

      {activeBots.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="هیچ ربات فعالی ندارید"
          description="گردش‌کار به یک ربات فعال نیاز دارد. ابتدا از بخش ربات‌ها یک ربات را فعال کنید."
          action={<Link to="/dashboard/bots" className="btn btn-primary" style={{ display: 'inline-flex' }}>رفتن به ربات‌ها</Link>}
        />
      ) : (
        <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
          <Card>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="ربات" required hint={editId ? "ربات پس از ایجاد گردش‌کار قابل تغییر نیست." : "فقط ربات‌های فعال در فهرست هستند."}>
                  <Select value={botId} onChange={(e) => setBotId(e.target.value)} disabled={Boolean(editId)}>
                    <option value="">— انتخاب ربات —</option>
                    {activeBots.map((b) => (
                      <option key={b.id} value={b.id}>{b.title || b.username || b.id}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="نام گردش‌کار" required>
                  <Input value={nameFa} onChange={(e) => setNameFa(e.target.value)} placeholder="مثلاً: خوش‌آمدگویی و معرفی فروشگاه" />
                </Field>
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>مراحل اجرا</h2>
            <span className={`badge ${used > MAX_STEPS - 3 ? 'badge-warning' : 'badge-muted'}`}>مرحله {faDigits(used)} از {faDigits(MAX_STEPS)}</span>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {steps.map((s, i) => (
              <StepCard
                key={s.key}
                step={s}
                level={1}
                totalUsed={used}
                onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button disabled={used >= MAX_STEPS} onClick={() => setSteps([...steps, newStep('MESSAGE')])}>+ افزودن مرحله</Button>
            <Button onClick={() => void save()} loading={saving} disabled={steps.length === 0}>
              {editId ? 'ذخیرهٔ تغییرات' : 'ساخت گردش‌کار'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
