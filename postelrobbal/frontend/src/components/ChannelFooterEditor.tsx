import { useEffect, useState } from 'react';
import { api, ApiRequestError, type ChannelDto } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Textarea } from './ui';
import { PlatformBadge } from './PlatformBadge';

type SavedFooterDto = {
  id: string;
  channelId: string;
  text: string;
  createdAt?: string;
};

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'عملیات کتابخانهٔ متن‌های انتهایی انجام نشد. دوباره تلاش کنید.';
}

function persianDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

export function ChannelFooterEditor({
  channel,
  value,
  onChange,
  maxLength,
  disabled = false,
}: {
  channel: ChannelDto;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [savedFooters, setSavedFooters] = useState<SavedFooterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const reloadSavedFooters = async () => {
    const data = await api.get<{ footers: SavedFooterDto[] }>(`/api/v1/channels/${channel.id}/saved-footers`);
    setSavedFooters(data.footers ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ footers: SavedFooterDto[] }>(`/api/v1/channels/${channel.id}/saved-footers`)
      .then((data) => { if (!cancelled) setSavedFooters(data.footers ?? []); })
      .catch((error: unknown) => { if (!cancelled) toast.error(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channel.id]);

  const saveFooter = async () => {
    const text = value.trim();
    if (!text) {
      toast.error('ابتدا متن انتهایی همین کانال را وارد کنید.');
      return;
    }
    if (text.length > maxLength) {
      toast.error(`متن انتهایی حداکثر ${persianDigits(maxLength)} نویسه است.`);
      return;
    }
    setSaving(true);
    try {
      await api.post<{ footer: SavedFooterDto }>(`/api/v1/channels/${channel.id}/saved-footers`, { text });
      await reloadSavedFooters();
      toast.success('متن انتهایی در کتابخانهٔ همین کانال ذخیره شد؛ مورد تکراری ساخته نمی‌شود.');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const useSavedFooter = (footer: SavedFooterDto) => {
    onChange(footer.text);
    toast.info('متن ذخیره‌شده جایگزین متن انتهایی فعلی همین کانال شد.');
  };

  const deleteSavedFooter = async (footer: SavedFooterDto) => {
    setDeletingId(footer.id);
    try {
      await api.del(`/api/v1/channels/${channel.id}/saved-footers/${footer.id}`);
      setSavedFooters((current) => current.filter((item) => item.id !== footer.id));
      toast.success('متن از کتابخانهٔ همین کانال حذف شد.');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setDeletingId('');
    }
  };

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: 'var(--surface)', display: 'grid', gap: 10, minWidth: 0 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13.5 }}>
            <PlatformBadge platform={channel.platform} />
            <span>متن انتهایی — {channel.title}</span>
          </strong>
          <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>متن‌های ذخیره‌شده فقط برای همین کانال هستند.</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{persianDigits(value.length)} از {persianDigits(maxLength)} نویسه</span>
      </header>

      <Textarea
        value={value}
        maxLength={maxLength}
        rows={2}
        disabled={disabled}
        placeholder="مثلاً @admin یا https://example.com"
        aria-label={`متن انتهایی برای ${channel.title}`}
        onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 66, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 13, lineHeight: 1.8, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Button size="sm" variant="soft" loading={saving} disabled={disabled || saving || !value.trim()} onClick={() => void saveFooter()}>
          ذخیره برای دفعات بعد
        </Button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 12 }}>کتابخانهٔ متن‌های انتهایی</strong>
          <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>فقط این کانال</span>
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>در حال بارگذاری متن‌های ذخیره‌شده…</div>
        ) : savedFooters.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.8 }}>هنوز متنی ذخیره نشده است. یک متن وارد کنید و «ذخیره برای دفعات بعد» را بزنید.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {savedFooters.map((footer) => (
              <div key={footer.id} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 10, display: 'grid', gap: 8, minWidth: 0 }}>
                <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12.5, lineHeight: 1.9 }}>{footer.text}</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="soft" disabled={disabled || deletingId !== ''} onClick={() => useSavedFooter(footer)}>
                    استفاده در پیام
                  </Button>
                  <Button size="sm" variant="ghost" loading={deletingId === footer.id} disabled={disabled || deletingId !== ''} onClick={() => void deleteSavedFooter(footer)}>
                    حذف ذخیره
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
