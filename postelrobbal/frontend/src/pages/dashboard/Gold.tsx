import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError, type ChannelDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Select } from '../../components/ui';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { faDateTime, faDigits, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

interface GoldConfig {
  sourceUrl?: string;
  templateText?: string;
  channelIds?: string[];
  frequencyMinutes?: number;
  changeOnly?: boolean;
  isEnabled?: boolean;
  lastRunAt?: string | null;
}

const FREQUENCIES = [15, 30, 60, 120, 180, 240];

export default function Gold() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sourceUrl, setSourceUrl] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [frequencyMinutes, setFrequencyMinutes] = useState(60);
  const [changeOnly, setChangeOnly] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cfg, chs] = await Promise.all([
        api.get<{ config?: GoldConfig }>('/api/v1/gold/config'),
        api.get<{ channels?: ChannelDto[] }>('/api/v1/channels').catch(() => ({ channels: [] as ChannelDto[] })),
      ]);
      const c = cfg.config ?? {};
      setSourceUrl(typeof c.sourceUrl === 'string' ? c.sourceUrl : '');
      setTemplateText(typeof c.templateText === 'string' ? c.templateText : '');
      setFrequencyMinutes(typeof c.frequencyMinutes === 'number' ? c.frequencyMinutes : 60);
      setChangeOnly(c.changeOnly !== false);
      setIsEnabled(c.isEnabled === true);
      setChannelIds(Array.isArray(c.channelIds) ? c.channelIds : []);
      setLastRunAt(c.lastRunAt ?? null);
      setChannels((chs.channels ?? []).filter((ch) => ch.status === 'ACTIVE'));
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 403 || err.code === 'FORBIDDEN')) {
        setForbidden(true);
      } else {
        setLoadError(err instanceof ApiRequestError ? err.message : 'دریافت تنظیمات نرخ لحظه‌ای ناموفق بود.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!sourceUrl.trim()) {
      toast.error('نشانی منبع نرخ را وارد کنید.');
      return;
    }
    if (!templateText.trim()) {
      toast.error('متن قالب را وارد کنید.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/v1/gold/config', {
        sourceUrl: sourceUrl.trim(),
        templateText: templateText.trim(),
        channelIds,
        frequencyMinutes,
        changeOnly,
        isEnabled,
        timezone: 'Asia/Tehran',
      });
      toast.success('تنظیمات نرخ لحظه‌ای ذخیره شد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ تنظیمات ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const d = await api.post<{ result?: { changed?: boolean; published?: boolean; message?: string | null } }>('/api/v1/gold/run');
      const r = d.result ?? {};
      if (r.published) toast.success('نرخ تازه دریافت و در کانال‌ها منتشر شد.');
      else if (r.changed) toast.info('نرخ تغییر کرده است؛ برای انتشار، افزونه را فعال کنید یا «فقط در صورت تغییر» را خاموش کنید.');
      else toast.info(r.message || 'بررسی انجام شد؛ تغییری در نرخ‌ها نبود.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'اجرای فوری ناموفق بود.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <PageLoading />;

  if (forbidden) {
    return (
      <div>
        <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 16 }}>ربات نرخ لحظه‌ای طلا و سکه</h1>
        <EmptyState
          icon="🪙"
          title="ماژول طلا در پلن فعلی شما فعال نیست"
          description="این امکان در پلن‌های بالاتر ارائه می‌شود؛ با ارتقای اشتراک می‌توانید نرخ دلار، سکه و طلای ۱۸ عیار را به‌صورت خودکار در کانال‌ها منتشر کنید."
          action={<Link to="/dashboard/subscription" className="btn btn-primary" style={{ display: 'inline-flex' }}>مشاهدهٔ پلن‌ها و ارتقا</Link>}
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        icon="🪙"
        title="خطا در دریافت تنظیمات"
        description={loadError}
        action={<Button onClick={() => void load()}>تلاش مجدد</Button>}
      />
    );
  }

  const toggleChannel = (id: string) => {
    setChannelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>ربات نرخ لحظه‌ای طلا و سکه</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
            دریافت خودکار نرخ دلار، سکه و طلا از منبع مورد اعتماد شما و انتشار در کانال‌ها.
            {lastRunAt ? ` آخرین اجرا: ${faRelative(lastRunAt)}` : ''}
          </p>
        </div>
        <Button variant="soft" onClick={() => void runNow()} loading={running}>اجرای فوری</Button>
      </div>

      <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
        <Card pad="lg">
          <Field label="نشانی منبع نرخ" required hint="صفحه‌ای که نرخ‌ها در آن منتشر می‌شود؛ مثلاً سایت رسمی بورس یا بازار مبادله.">
            <Input dir="ltr" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="نشانی امن منبع نرخ" />
          </Field>

          <Field
            label="متن قالب پیام"
            required
            hint="از نشانگرهای {دلار} {سکه امامی} {طلای ۱۸} (و یورو، درهم، لیر، انس و گرم) در متن استفاده کنید؛ به‌جای هر نشانگر، نرخ روز با رقم فارسی جای‌گذاری می‌شود."
          >
            <ContentComposerTextarea rows={6} value={templateText} onChange={(e) => setTemplateText(e.target.value)} placeholder={'📊 نرخ امروز:\nدلار: {دلار} تومان\nسکه امامی: {سکه امامی} تومان\nطلای ۱۸ عیار: {طلای ۱۸} تومان'} />
          </Field>

          <Field label="تناوب بررسی" required>
            <Select value={String(frequencyMinutes)} onChange={(e) => setFrequencyMinutes(Number(e.target.value))}>
              {FREQUENCIES.map((m) => (
                <option key={m} value={m}>هر {faDigits(m)} دقیقه</option>
              ))}
            </Select>
          </Field>

          <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
              <input type="checkbox" checked={changeOnly} onChange={(e) => setChangeOnly(e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
              فقط در صورت تغییر نرخ ارسال شود
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
              انتشار خودکار فعال باشد
            </label>
          </div>

          <Field label="کانال‌های انتشار" hint="فقط کانال‌های فعال فهرست می‌شوند. اگر کانالی نمی‌بینید، ابتدا آن را از بخش کانال‌ها تأیید کنید.">
            {channels.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px' }}>
                کانال فعالی ندارید. <Link to="/dashboard/channels">اتصال کانال</Link>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {channels.map((ch) => (
                  <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
                    <input
                      type="checkbox"
                      checked={channelIds.includes(ch.id)}
                      onChange={() => toggleChannel(ch.id)}
                      style={{ width: 17, height: 17, accentColor: 'var(--brand)' }}
                    />
                    <span>{ch.title || ch.channelRef}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>({ch.platform === 'telegram' ? 'تلگرام' : ch.platform === 'bale' ? 'بله' : 'روبیکا'})</span>
                  </label>
                ))}
              </div>
            )}
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
          </div>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>آخرین اجرا</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
            {lastRunAt ? faDateTime(lastRunAt) : 'هنوز اجرایی ثبت نشده است.'}
          </p>
        </Card>
      </div>
    </div>
  );
}
