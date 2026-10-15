export type ButtonTargetType = 'URL' | 'PHONE' | 'TELEGRAM_ID' | 'BALE_ID' | 'RUBIKA_ID';

export interface ButtonRow {
  label: string;
  targetType: ButtonTargetType;
  value: string;
}

export const MAX_BUTTONS_PER_CHANNEL = 8;

export const BUTTON_TARGET_LABEL: Record<ButtonTargetType, string> = {
  URL: 'لینک سایت',
  PHONE: 'شماره تلفن',
  TELEGRAM_ID: 'شناسه تلگرام',
  BALE_ID: 'شناسه بله',
  RUBIKA_ID: 'شناسه روبیکا',
};

export function normalizeButtonTarget(type: ButtonTargetType, value: string): string {
  const raw = value.trim();
  if (type === 'URL') {
    if (!raw) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.toString();
    } catch {
      return '';
    }
  }
  if (type === 'PHONE') {
    return raw.replace(/[^+\d]/g, '').replace(/(?!^)[+]/g, '');
  }
  return raw.replace(/^@+/, '').trim();
}

export function buttonTargetPlaceholder(type: ButtonTargetType): string {
  switch (type) {
    case 'URL': return 'https://example.com/page';
    case 'PHONE': return '+989121234567';
    case 'TELEGRAM_ID': return '@channel_id';
    case 'BALE_ID': return '@channel_id';
    case 'RUBIKA_ID': return '@channel_id';
  }
}

export function buttonTargetPreview(type: ButtonTargetType, value: string): string {
  const normalized = normalizeButtonTarget(type, value);
  if (!normalized) return value.trim();
  switch (type) {
    case 'URL': return normalized;
    case 'PHONE': return normalized;
    case 'TELEGRAM_ID': return `https://t.me/${normalized}`;
    case 'BALE_ID': return `https://ble.ir/${normalized}`;
    case 'RUBIKA_ID': return `https://rubika.ir/${normalized}`;
  }
}
