import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, PageLoading, StatCard } from '../../components/ui';
import { faDate, faDigits, faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';

interface ReferredRow {
  firstName?: string | null;
  joinedAt?: string | null;
  referralId?: string;
  state?: string;
}

interface RewardRow {
  id: string;
  referralId?: string;
  rewardKind?: string | null;
  amount?: number | null;
  createdAt?: string | null;
}

interface ReferralSummary {
  code?: string;
  referred?: ReferredRow[];
  rewards?: RewardRow[];
  totalPoints?: number;
  pointsBalance?: number;
  pendingCount?: number;
}

const REWARD_KIND_FA: Record<string, string> = {
  REGISTER: 'جایزهٔ ثبت‌نام',
  FIRST_PURCHASE: 'جایزهٔ اولین خرید',
};

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

export default function Referrals() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<ReferralSummary>('/api/v1/referrals/me');
      setSummary(d);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت اطلاعات زیرمجموعه‌گیری ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageLoading />;

  const code = summary?.code ?? '';
  const referred = summary?.referred ?? [];
  const rewards = summary?.rewards ?? [];
  const rewardedReferralIds = new Set(rewards.map((r) => r.referralId).filter((x): x is string => typeof x === 'string'));

  const shareLink = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>زیرمجموعه‌گیری</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          با معرفی پُست‌یار به دوستان، {faDigits(100)} امتیاز به‌ازای هر کاربر جدید بگیرید؛ هر امتیاز ۱ تومان ارزش دارد.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: 20 }}>
        <StatCard icon="🎯" bg="var(--brand-soft)" value={faNumber(referred.length)} label="کاربر معرفی‌شده" />
        <StatCard icon="⭐" bg="var(--success-soft)" value={faNumber(summary?.totalPoints ?? 0)} label="مجموع امتیاز جایزه" />
        <StatCard icon="⏳" bg="var(--warning-soft)" value={faNumber(summary?.pendingCount ?? 0)} label="در انتظار تکمیل ثبت‌نام" />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', maxWidth: 1000 }}>
        <Card pad="lg">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>کد معرف شما</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <code dir="ltr" style={{ flex: 1, minWidth: 160, background: 'var(--brand-soft)', color: 'var(--brand-strong)', border: '1px dashed var(--brand)', borderRadius: 10, padding: '10px 16px', fontSize: 18, fontWeight: 800, textAlign: 'center' }}>
              {code || '—'}
            </code>
            <Button
              onClick={() => {
                void copyText(code).then((ok) => {
                  if (ok) toast.success('کپی کد معرف انجام شد.');
                  else toast.error('کپی انجام نشد؛ دستی انتخاب و کپی کنید.');
                });
              }}
            >
              کپی کد معرف
            </Button>
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>لینک دعوت</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code dir="ltr" style={{ flex: 1, minWidth: 200, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, wordBreak: 'break-all' }}>
              {shareLink}
            </code>
            <Button
              variant="soft"
              size="sm"
              onClick={() => {
                void copyText(shareLink).then((ok) => {
                  if (ok) toast.success('لینک دعوت کپی شد.');
                  else toast.error('کپی انجام نشد؛ دستی انتخاب و کپی کنید.');
                });
              }}
            >
              کپی لینک
            </Button>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 12 }}>
            کافی است دوستانتان با این لینک ثبت‌نام کنند؛ امتیاز جایزه به‌صورت خودکار به حساب شما اضافه می‌شود و می‌توانید آن را در بخش کیف پول به موجودی تبدیل کنید.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>کاربران معرفی‌شده</h2>
          {referred.length === 0 ? (
            <EmptyState icon="👥" title="هنوز کسی را معرفی نکرده‌اید" description="لینک دعوت را در شبکه‌های اجتماعی به اشتراک بگذارید." />
          ) : (
            <ul style={{ listStyle: 'none', display: 'grid', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
              {referred.map((r, i) => {
                const state = r.state ?? (r.referralId && rewardedReferralIds.has(r.referralId) ? 'REWARDED' : 'REGISTERED');
                return (
                  <li key={r.referralId ?? `ref-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: '1px dashed var(--border)', paddingBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{r.firstName || 'کاربر مهمان'}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{faDate(r.joinedAt)}</span>
                    <span className={`badge ${state === 'REWARDED' ? 'badge-success' : 'badge-muted'}`}>
                      {state === 'REWARDED' ? 'جایزه داده شد' : 'ثبت‌شده'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {rewards.length > 0 && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>جایزه‌های دریافتی</h2>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', fontSize: 13.5 }}>
              {rewards.map((r) => (
                <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px dashed var(--border)', paddingBottom: 6, flexWrap: 'wrap' }}>
                  <span>{REWARD_KIND_FA[r.rewardKind ?? ''] ?? 'جایزه'}</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>{faNumber(r.amount ?? 0)} امتیاز</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{faDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
