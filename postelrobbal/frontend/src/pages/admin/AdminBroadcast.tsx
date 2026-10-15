import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select } from '../../components/ui';
import { faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { ROLE_FA, errText, strField, type AdminUserRow } from './shared';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';

/* ------------------------------------------------------------------ */
/* اطلاع‌رسانی — targeted broadcast (round 19).                         */
/* Recipients: ALL | a role group | a plan group | specific members.    */
/* Backend: GET /admin/broadcast/targets + POST /admin/broadcast.       */
/* ------------------------------------------------------------------ */

type TargetKind = 'ALL' | 'ROLE' | 'PLAN' | 'USERS';

interface TargetsData {
  roles?: Array<{ role: string; count: number }>;
  plans?: Array<{ id: string; nameFa: string; subscribers: number }>;
}

const TARGET_TILES: Array<{ kind: TargetKind; icon: string; label: string; desc: string }> = [
  { kind: 'ALL', icon: '📢', label: 'همهٔ کاربران', desc: 'ارسال برای تمام کاربران فعال سامانه' },
  { kind: 'ROLE', icon: '👥', label: 'گروه کاربری', desc: 'یک نقش مشخص (کاربر، پشتیبان، مدیر)' },
  { kind: 'PLAN', icon: '💎', label: 'گروه اشتراک', desc: 'دارندگان اشتراک فعال یک پلن' },
  { kind: 'USERS', icon: '🙋', label: 'عضو یا اعضای خاص', desc: 'انتخاب دستی افراد مشخص' },
];

const ROLE_FILTER_FA: Record<string, string> = {
  USER: 'کاربران عادی',
  SUPPORT: 'پشتیبانان',
  SUPER_ADMIN: 'مدیران',
};

export default function AdminBroadcast() {
  const toast = useToast();

  const [titleFa, setTitleFa] = useState('');
  const [bodyFa, setBodyFa] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // targeting
  const [kind, setKind] = useState<TargetKind>('ALL');
  const [targets, setTargets] = useState<TargetsData | null>(null);
  const [role, setRole] = useState('USER');
  const [planId, setPlanId] = useState('');
  const [picked, setPicked] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<AdminUserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    api
      .get<TargetsData>('/api/v1/admin/broadcast/targets')
      .then(setTargets)
      .catch(() => setTargets(null));
  }, []);

  // debounced user search for the specific-members picker
  useEffect(() => {
    const term = search.trim();
    if (kind !== 'USERS' || term.length < 2) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const d = await api.get<{ items?: AdminUserRow[] }>(
          `/api/v1/admin/users?search=${encodeURIComponent(term)}&page=1&pageSize=8`
        );
        if (searchSeq.current === seq) setSearchResults(d.items ?? []);
      } catch {
        if (searchSeq.current === seq) setSearchResults([]);
      } finally {
        if (searchSeq.current === seq) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, kind]);

  const pickUser = (u: AdminUserRow) => {
    if (picked.some((p) => p.id === u.id)) return;
    setPicked((prev) => [...prev, u]);
    setSearch('');
    setSearchResults([]);
  };

  const ready = titleFa.trim().length >= 3 && bodyFa.trim().length >= 3 && (
    kind === 'ALL' ||
    (kind === 'ROLE' && role !== '') ||
    (kind === 'PLAN' && planId !== '') ||
    (kind === 'USERS' && picked.length > 0)
  );

  const targetSummary = (): string => {
    switch (kind) {
      case 'ALL':
        return 'همهٔ کاربران فعال سامانه';
      case 'ROLE': {
        const c = targets?.roles?.find((r) => r.role === role)?.count;
        return `${ROLE_FILTER_FA[role] ?? ROLE_FA[role] ?? role}${typeof c === 'number' ? ` (${faNumber(c)} کاربر)` : ''}`;
      }
      case 'PLAN': {
        const p = targets?.plans?.find((x) => x.id === planId);
        return p ? `دارندگان اشتراک فعال «${p.nameFa}» (${faNumber(p.subscribers)} کاربر)` : 'گروه اشتراک انتخاب‌شده';
      }
      case 'USERS':
        return `${faNumber(picked.length)} عضو انتخاب‌شده`;
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const target =
        kind === 'ALL'
          ? { kind: 'ALL' as const }
          : kind === 'ROLE'
            ? { kind: 'ROLE' as const, role: role as 'USER' | 'SUPPORT' | 'SUPER_ADMIN' }
            : kind === 'PLAN'
              ? { kind: 'PLAN' as const, planId }
              : { kind: 'USERS' as const, userIds: picked.map((p) => p.id) };
      const d = await api.post<{ recipients?: number }>('/api/v1/admin/broadcast', {
        titleFa: titleFa.trim(),
        bodyFa: bodyFa.trim(),
        target,
      });
      const count = typeof d?.recipients === 'number' ? d.recipients : null;
      const msg = count === null
        ? 'پیام با موفقیت ارسال شد.'
        : `پیام با موفقیت برای ${faNumber(count)} کاربر ارسال شد.`;
      toast.success(msg);
      setResult(`${msg} — گیرندگان: ${targetSummary()}`);
      setTitleFa('');
      setBodyFa('');
      setPicked([]);
      setConfirmOpen(false);
    } catch (err) {
      toast.error(errText(err, 'ارسال اطلاع‌رسانی ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head">
        <h2>اطلاع‌رسانی</h2>
        <p>ارسال اعلان به همهٔ کاربران، یک گروه کاربری/اشتراک یا اعضای خاص — داخل پیشخوان نمایش داده می‌شود</p>
      </div>

      {result && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>{result}</span>
        </div>
      )}

      <Card>
        <div className="adm-subhead">گیرندگان</div>
        <div
          role="radiogroup"
          aria-label="انتخاب گیرندگان پیام"
          style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: 18 }}
        >
          {TARGET_TILES.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="radio"
              aria-checked={kind === t.kind}
              onClick={() => setKind(t.kind)}
              style={{
                textAlign: 'right',
                border: `1.5px solid ${kind === t.kind ? 'var(--brand)' : 'var(--border)'}`,
                background: kind === t.kind ? 'var(--brand-soft)' : 'transparent',
                borderRadius: 12,
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'grid',
                gap: 2,
                color: 'var(--text)',
              }}
            >
              <strong style={{ fontSize: 13.5 }}>
                <span aria-hidden="true" style={{ marginLeft: 6 }}>{t.icon}</span>
                {t.label}
              </strong>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t.desc}</span>
            </button>
          ))}
        </div>

        {kind === 'ROLE' && (
          <Field label="گروه کاربری" hint="پیام فقط برای کاربران فعال با این نقش ارسال می‌شود.">
            <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="انتخاب گروه کاربری">
              {(targets?.roles?.length ? targets.roles.map((r) => r.role) : ['USER', 'SUPPORT', 'SUPER_ADMIN']).map((r) => {
                const c = targets?.roles?.find((x) => x.role === r)?.count;
                return (
                  <option key={r} value={r}>
                    {ROLE_FILTER_FA[r] ?? ROLE_FA[r] ?? r}{typeof c === 'number' ? ` — ${faNumber(c)} کاربر` : ''}
                  </option>
                );
              })}
            </Select>
          </Field>
        )}

        {kind === 'PLAN' && (
          <Field label="گروه اشتراک (پلن)" hint="پیام برای دارندگان اشتراک فعال این پلن ارسال می‌شود.">
            {targets?.plans && targets.plans.length > 0 ? (
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="انتخاب پلن">
                <option value="">— انتخاب پلن —</option>
                {targets.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameFa} — {faNumber(p.subscribers)} مشترک فعال
                  </option>
                ))}
              </Select>
            ) : (
              <EmptyState icon="💎" title="پلنی موجود نیست" description="ابتدا از بخش «اشتراک‌ها» یک پلن تعریف کنید." />
            )}
          </Field>
        )}

        {kind === 'USERS' && (
          <>
            <Field label="جستجوی عضو" hint="نمایش، نام خانوادگی یا ایمیل را بنویسید و از نتایج انتخاب کنید (حداکثر ۵۰۰ عضو).">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="مثلاً سارا یا sara@…"
                aria-label="جستجوی کاربر برای اطلاع‌رسانی"
              />
            </Field>
            {searching && <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>در حال جستجو…</p>}
            {searchResults.length > 0 && (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  maxHeight: 220,
                  overflowY: 'auto',
                  marginBottom: 12,
                }}
              >
                {searchResults.map((u) => {
                  const chosen = picked.some((p) => p.id === u.id);
                  const name = `${strField(u.firstName)} ${strField(u.lastName)}`.trim() || u.email || u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => pickUser(u)}
                      disabled={chosen}
                      style={{
                        display: 'flex',
                        width: '100%',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        cursor: chosen ? 'default' : 'pointer',
                        textAlign: 'right',
                        color: 'var(--text)',
                      }}
                    >
                      <span style={{ fontSize: 13 }}>
                        <strong>{name}</strong>
                        <span style={{ color: 'var(--text-2)', fontSize: 11.5, marginRight: 8 }} dir="ltr">
                          {strField(u.email)}
                        </span>
                      </span>
                      {chosen ? <Badge tone="success">انتخاب‌شده</Badge> : <Badge tone="muted">افزودن</Badge>}
                    </button>
                  );
                })}
              </div>
            )}
            {picked.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {picked.map((u) => {
                  const name = `${strField(u.firstName)} ${strField(u.lastName)}`.trim() || u.email || u.id;
                  return (
                    <span key={u.id} className="file-chip" style={{ padding: '4px 8px' }}>
                      <span className="file-chip__name">{name}</span>
                      <button
                        type="button"
                        className="file-chip__remove"
                        onClick={() => setPicked((prev) => prev.filter((p) => p.id !== u.id))}
                        aria-label={`حذف ${name} از گیرندگان`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div className="adm-subhead">متن پیام</div>
        <Field label="عنوان پیام" required hint="حداقل ۳ نویسه">
          <Input value={titleFa} onChange={(e) => setTitleFa(e.target.value)} placeholder="مثلاً به‌روزرسانی مهم سامانه" />
        </Field>
        <Field label="متن پیام" required hint="این متن برای گیرندگان انتخاب‌شده به‌عنوان اعلان ارسال می‌شود.">
          <ContentComposerTextarea rows={6} value={bodyFa} onChange={(e) => setBodyFa(e.target.value)} placeholder="متن پیام…" />
        </Field>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!ready}
          title={ready ? undefined : 'عنوان، متن و گیرندگان را کامل کنید.'}
        >
          ارسال اطلاع‌رسانی
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => void send()}
        title="ارسال اطلاع‌رسانی"
        message={`این پیام برای «${targetSummary()}» ارسال می‌شود و پس از ارسال قابل لغو نیست. ادامه می‌دهید؟`}
        danger
        busy={busy}
      />
    </>
  );
}
