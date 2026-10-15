import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError, type BotDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, Modal, PageLoading, Select, StatusBadge } from '../../components/ui';
import { faLabel, PLATFORM_FA, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

/** §22 — ربات‌ها بیرون ساخته می‌شوند (بات‌افدر/پنل‌ها) و اینجا فقط متصل می‌شوند. */
const PLATFORM_EMOJI: Record<string, string> = { telegram: '✈️', bale: '💠', rubika: '🔴' };

const BOT_STATUS_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

const BOT_MODE_FA: Record<string, string> = {
  WEBHOOK: 'وبهوک',
  POLLING: 'بررسی دوره‌ای',
};

const TOKEN_GUIDE_FA: Record<string, string> = {
  telegram: 'در ربات‌ساز رسمی تلگرام یک ربات بسازید و نشانهٔ دسترسی آن را اینجا وارد کنید.',
  bale: 'از ربات‌ساز رسمی بله نشانهٔ دسترسی بگیرید.',
  rubika: 'در روبیکا یک ربات بسازید و نشانهٔ دسترسی صادرشده را اینجا وارد کنید. اتصال روبیکا از وبهوک رسمی انجام می‌شود.',
};

type Platform = 'telegram' | 'bale' | 'rubika';

export default function Bots() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [platform, setPlatform] = useState<Platform>('telegram');
  const [token, setToken] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ items?: BotDto[]; bots?: BotDto[] }>('/api/v1/bots');
      setBots(d.items ?? d.bots ?? []);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت فهرست ربات‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (bot: BotDto, verb: 'verify' | 'enable' | 'disable', successMsg: string) => {
    setBusyId(bot.id);
    try {
      await api.post(`/api/v1/bots/${bot.id}/${verb}`);
      toast.success(successMsg);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'عملیات ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const submitAdd = async () => {
    if (token.trim().length < 10) {
      toast.error('توکن ربات را کامل وارد کنید.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/v1/bots', { platform, token: token.trim(), title: title.trim() || undefined });
      toast.success('ربات با موفقیت متصل شد.');
      setAddOpen(false);
      setToken('');
      setTitle('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'اتصال ربات ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>ربات‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>ربات‌های پلتفرم‌ها را متصل کنید تا کانال‌ها و گردش‌کارها کار کنند.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ اتصال ربات جدید</Button>
      </div>

      {bots.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="هنوز رباتی متصل نکرده‌اید"
          description="برای ارسال پیام به کانال‌ها، ابتدا یک ربات از بات‌افدر بسازید و توکن آن را اینجا وارد کنید."
          action={<Button onClick={() => setAddOpen(true)}>اتصال اولین ربات</Button>}
        />
      ) : (
        <div className="platform-columns-grid">
          {(['telegram', 'bale', 'rubika'] as const).map((platformGroup) => {
            const grouped = bots.filter((bot) => bot.platform === platformGroup);
            return <section key={platformGroup} aria-label={`ربات‌های ${PLATFORM_FA[platformGroup]}`} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <span aria-hidden="true" style={{ fontSize: 24 }}>{PLATFORM_EMOJI[platformGroup]}</span>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{PLATFORM_FA[platformGroup]}</h2>
                <span className="badge">{grouped.length.toLocaleString('fa-IR')} ربات</span>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {grouped.length ? grouped.map((bot) => (
            <Card key={bot.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 26 }} aria-hidden="true">{PLATFORM_EMOJI[bot.platform] ?? '🤖'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{bot.title || 'بدون نام'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    {faLabel(bot.platform, PLATFORM_FA)}
                    {bot.username ? ` · @${bot.username}` : ''}
                  </div>
                </div>
                <StatusBadge state={bot.status} labels={BOT_STATUS_FA} />
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'grid', gap: 3, marginBottom: 12 }}>
                <span>توکن: <span style={{ fontFamily: 'monospace' }}>{bot.tokenMasked || '—'}</span></span>
                <span>حالت دریافت پیام: {faLabel(bot.mode, BOT_MODE_FA)}</span>
                <span>آخرین فعالیت: {bot.lastEventAt ? faRelative(bot.lastEventAt) : 'هنوز ثبت نشده'}</span>
                <span>ایجاد: {faRelative(bot.createdAt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {bot.status === 'PENDING_VERIFY' && (
                  <Button size="sm" variant="soft" loading={busyId === bot.id} onClick={() => void action(bot, 'verify', 'ربات تأیید شد.')}>
                    تأیید
                  </Button>
                )}
                {bot.status !== 'ACTIVE' && (
                  <Button size="sm" variant="soft" loading={busyId === bot.id} onClick={() => void action(bot, 'enable', 'ربات فعال شد.')}>
                    فعال‌سازی
                  </Button>
                )}
                {bot.status === 'ACTIVE' && (
                  <Button size="sm" variant="ghost" loading={busyId === bot.id} onClick={() => void action(bot, 'disable', 'ربات غیرفعال شد.')}>
                    غیرفعال‌سازی
                  </Button>
                )}
                <Link to={`/dashboard/bots/${bot.id}`} className="btn btn-ghost btn-sm" style={{ display: 'inline-flex' }}>
                  مدیریت ربات ←
                </Link>
              </div>
            </Card>
          )) : <div style={{border:'1px dashed var(--border)',borderRadius:10,padding:12,color:'var(--text-2)',fontSize:12,lineHeight:1.8}}>هنوز رباتی برای این پلتفرم متصل نشده است.</div>}
              </div>
            </section>;
          })}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="اتصال ربات جدید">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
          ربات ابتدا در پلتفرم ساخته می‌شود (بات‌افدر یا پنل پلتفرم) و سپس با توکن اینجا متصل می‌گردد.
        </p>
        <Field label="پلتفرم" required>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
            <option value="rubika">روبیکا</option>
          </Select>
        </Field>
        {platform === 'rubika' && <div style={{ background: 'var(--info-soft)', color: 'var(--text)', borderRadius: 12, padding: '11px 14px', fontSize: 12.5, lineHeight: 1.9, marginBottom: 12 }}>رابط برنامه‌نویسی ربات روبیکا از قابلیت دریافت اطلاعات هویتی ربات برای احراز هویت و از قابلیت ثبت نشانی وبهوک برای دریافت رویدادها استفاده می‌کند. ربات باید در بخش مدیریت ربات‌های روبیکا ساخته شود و برای دریافت پیام‌های گروه و کانال، گزینهٔ دریافت همهٔ پیام‌ها نیز فعال باشد.</div>}
        <Field label="راهنمای دریافت توکن">
          <div style={{ background: 'var(--brand-soft)', color: 'var(--brand-strong)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
            {TOKEN_GUIDE_FA[platform]}
          </div>
        </Field>
        <Field label="توکن ربات" required>
          <Input dir="ltr" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." />
        </Field>
        <Field label="نام نمایشی ربات" hint="اگر خالی بماند، نام رسمی ربات از پلتفرم دریافت می‌شود.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً ربات خبری فروشگاه" />
        </Field>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button onClick={() => void submitAdd()} loading={saving}>اتصال ربات</Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>انصراف</Button>
        </div>
      </Modal>
    </div>
  );
}
