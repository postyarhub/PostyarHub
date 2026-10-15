import { useEffect, useState } from 'react';
import { api, ApiRequestError, type ChannelDto } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Input, Select } from './ui';
import {
  BUTTON_TARGET_LABEL,
  MAX_BUTTONS_PER_CHANNEL,
  buttonTargetPlaceholder,
  buttonTargetPreview,
  normalizeButtonTarget,
  type ButtonRow,
  type ButtonTargetType,
} from '../lib/channelButtons';

type SavedButtonDto = {
  id: string;
  channelId: string;
  label: string;
  target: { type: ButtonTargetType; value: string };
  createdAt?: string;
};

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'عملیات کتابخانهٔ دکمه‌ها انجام نشد. دوباره تلاش کنید.';
}

function validateButton(row: ButtonRow): string | null {
  const label = row.label.trim();
  const value = normalizeButtonTarget(row.targetType, row.value);
  if (!label || !value) return 'عنوان و مقصد دکمه را کامل کنید.';
  if (row.targetType === 'URL' && !/^https?:\/\//i.test(value)) return 'لینک دکمه معتبر نیست.';
  if (row.targetType === 'PHONE' && !/^\+?[1-9]\d{6,14}$/.test(value)) return 'شمارهٔ تلفن معتبر نیست.';
  if (['TELEGRAM_ID', 'BALE_ID', 'RUBIKA_ID'].includes(row.targetType) && !/^[A-Za-z0-9_\u200c\u0600-\u06ff.]{2,190}$/.test(value)) {
    return 'شناسهٔ کانال معتبر نیست.';
  }
  return null;
}

export function ChannelButtonEditor({
  channel,
  rows,
  onRowsChange,
  onValidationError,
}: {
  channel: ChannelDto;
  rows: ButtonRow[];
  onRowsChange: (rows: ButtonRow[]) => void;
  onValidationError: (message: string) => void;
}) {
  const toast = useToast();
  const [savedButtons, setSavedButtons] = useState<SavedButtonDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRowIndex, setSavingRowIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState('');

  const reloadSavedButtons = async () => {
    const data = await api.get<{ buttons: SavedButtonDto[] }>(`/api/v1/channels/${channel.id}/saved-buttons`);
    setSavedButtons(data.buttons ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ buttons: SavedButtonDto[] }>(`/api/v1/channels/${channel.id}/saved-buttons`)
      .then((data) => { if (!cancelled) setSavedButtons(data.buttons ?? []); })
      .catch((error: unknown) => { if (!cancelled) toast.error(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channel.id]);

  const saveRow = async (index: number) => {
    const row = rows[index];
    if (!row) return;
    const issue = validateButton(row);
    if (issue) {
      onValidationError(issue);
      return;
    }
    const normalizedRow = { label: row.label.trim(), target: { type: row.targetType, value: normalizeButtonTarget(row.targetType, row.value) } };
    setSavingRowIndex(index);
    try {
      await api.post<{ button: SavedButtonDto }>(`/api/v1/channels/${channel.id}/saved-buttons`, normalizedRow);
      await reloadSavedButtons();
      onValidationError('');
      toast.success(`دکمهٔ «${normalizedRow.label}» در کتابخانهٔ همین کانال ذخیره شد.`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSavingRowIndex(null);
    }
  };

  const addSavedButton = (button: SavedButtonDto) => {
    if (rows.length >= MAX_BUTTONS_PER_CHANNEL) {
      toast.error(`برای هر کانال حداکثر ${MAX_BUTTONS_PER_CHANNEL} دکمه قابل افزودن است.`);
      return;
    }
    const duplicate = rows.some((row) => row.label.trim() === button.label && row.targetType === button.target.type && normalizeButtonTarget(row.targetType, row.value) === button.target.value);
    if (duplicate) {
      toast.info('این دکمه از قبل در پیام وجود دارد.');
      return;
    }
    onRowsChange([...rows, { label: button.label, targetType: button.target.type, value: button.target.value }]);
    onValidationError('');
  };

  const deleteSavedButton = async (button: SavedButtonDto) => {
    setDeletingId(button.id);
    try {
      await api.del(`/api/v1/channels/${channel.id}/saved-buttons/${button.id}`);
      setSavedButtons((current) => current.filter((item) => item.id !== button.id));
      toast.success(`دکمهٔ «${button.label}» از کتابخانهٔ این کانال حذف شد.`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setDeletingId('');
    }
  };

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: 'var(--surface)', display: 'grid', gap: 12, minWidth: 0 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 13.5 }}>{channel.title}</strong>
          <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--text-2)' }}>
            {channel.platform === 'telegram' ? 'تلگرام' : channel.platform === 'bale' ? 'بله' : 'روبیکا'} · دکمه‌ها و کتابخانه مخصوص همین کانال
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{rows.length} از {MAX_BUTTONS_PER_CHANNEL}</span>
      </header>

      <div style={{ display: 'grid', gap: 9 }}>
        <strong style={{ fontSize: 12 }}>دکمه‌های این پیام</strong>
        {rows.length === 0 && (
          <div style={{ border: '1px dashed var(--border)', borderRadius: 11, padding: 10, color: 'var(--text-2)', fontSize: 12, lineHeight: 1.9 }}>
            هنوز دکمه‌ای به این کانال اضافه نشده است. می‌توانید دکمه بسازید یا یکی از دکمه‌های ذخیره‌شده را از پایین اضافه کنید.
          </div>
        )}
        {rows.map((row, index) => (
          <div key={`${channel.id}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, display: 'grid', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 8, minWidth: 0 }}>
              <Input
                value={row.label}
                onChange={(event) => onRowsChange(rows.map((item, i) => i === index ? { ...item, label: event.target.value } : item))}
                placeholder="عنوان دکمه"
                aria-label={`عنوان دکمه ${index + 1} برای ${channel.title}`}
                maxLength={64}
              />
              <Select
                value={row.targetType}
                onChange={(event) => onRowsChange(rows.map((item, i) => i === index ? { ...item, targetType: event.target.value as ButtonTargetType, value: '' } : item))}
                aria-label={`عملکرد دکمه ${index + 1} برای ${channel.title}`}
              >
                {Object.entries(BUTTON_TARGET_LABEL).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
              </Select>
            </div>
            <Input
              style={{ width: '100%', boxSizing: 'border-box' }}
              dir="ltr"
              value={row.value}
              inputMode={row.targetType === 'PHONE' ? 'tel' : row.targetType === 'URL' ? 'url' : 'text'}
              onChange={(event) => onRowsChange(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))}
              placeholder={buttonTargetPlaceholder(row.targetType)}
              aria-label={`مقصد دکمه ${index + 1} برای ${channel.title}`}
              maxLength={255}
            />
            {row.targetType !== 'PHONE' && row.value.trim() && (
              <small dir="ltr" style={{ color: 'var(--text-2)', fontSize: 11, overflowWrap: 'anywhere' }}>
                {buttonTargetPreview(row.targetType, row.value)}
              </small>
            )}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <Button size="sm" variant="soft" loading={savingRowIndex === index} disabled={savingRowIndex !== null} onClick={() => void saveRow(index)}>
                ذخیره برای دفعات بعد
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { onRowsChange(rows.filter((_, i) => i !== index)); onValidationError(''); }}>
                حذف از پیام
              </Button>
            </div>
          </div>
        ))}
        {rows.length < MAX_BUTTONS_PER_CHANNEL && (
          <div>
            <Button size="sm" variant="soft" onClick={() => { onRowsChange([...rows, { label: '', targetType: 'URL', value: '' }]); onValidationError(''); }}>
              + ساخت دکمه جدید
            </Button>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 11, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 12 }}>کتابخانه دکمه‌های ذخیره‌شده</strong>
          <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>فقط برای همین کانال</span>
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>در حال بارگذاری دکمه‌های ذخیره‌شده…</div>
        ) : savedButtons.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.8 }}>هنوز دکمه‌ای ذخیره نشده است. کنار هر دکمهٔ ساخته‌شده، «ذخیره برای دفعات بعد» را بزنید.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 8 }}>
            {savedButtons.map((button) => (
              <div key={button.id} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 10, display: 'grid', gap: 7, minWidth: 0 }}>
                <strong style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{button.label}</strong>
                <small dir="ltr" style={{ color: 'var(--text-2)', fontSize: 10.5, overflowWrap: 'anywhere' }}>
                  {button.target.type === 'PHONE' ? button.target.value : buttonTargetPreview(button.target.type, button.target.value)}
                </small>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => addSavedButton(button)} disabled={rows.length >= MAX_BUTTONS_PER_CHANNEL}>افزودن به پیام</Button>
                  <Button size="sm" variant="ghost" loading={deletingId === button.id} disabled={deletingId !== ''} onClick={() => void deleteSavedButton(button)}>حذف ذخیره</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
