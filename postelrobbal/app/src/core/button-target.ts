import type { Platform } from '../providers/types.js';

export type ButtonTargetType =
  | 'URL'
  | 'PHONE'
  | 'TELEGRAM_ID'
  | 'BALE_ID'
  | 'RUBIKA_ID'
  // Legacy rows created before the explicit platform-id contract.
  | 'USERNAME';

const BUTTON_ID_RE = /^[A-Za-z0-9_\u200c\u0600-\u06ff.]{2,190}$/;
const BUTTON_PHONE_RE = /^\+?[1-9]\d{6,14}$/;

/**
 * Normalize a user-entered website address to a provider-safe HTTP(S) URL.
 * Bare domains are accepted and get an https:// prefix; existing http(s)
 * URLs are preserved after trimming. Other schemes are rejected.
 */
export function normalizeButtonWebUrl(rawValue: string): string {
  const raw = rawValue.trim();
  if (!raw) throw new Error('BUTTON_URL_EMPTY');
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('BUTTON_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('BUTTON_URL_SCHEME');
  }
  return candidate;
}

/** Normalize and validate the value according to its typed UI action. */
export function normalizeButtonTargetValue(type: ButtonTargetType, rawValue: string): string {
  const value = rawValue.trim();
  if (type === 'URL') return normalizeButtonWebUrl(value);

  if (type === 'PHONE') {
    const phone = value.replace(/[^+\d]/g, '').replace(/(?!^)[+]/g, '');
    if (!BUTTON_PHONE_RE.test(phone)) throw new Error('BUTTON_PHONE_INVALID');
    return phone;
  }

  const id = value.replace(/^@+/, '').trim();
  if (!BUTTON_ID_RE.test(id)) throw new Error('BUTTON_ID_INVALID');
  return id;
}

/**
 * Resolve a typed publishing target to a provider-consumable URL.
 * Explicit platform IDs always use their own platform URL, regardless of the
 * destination platform carrying the message. Legacy USERNAME remains scoped
 * to the destination platform for backward compatibility.
 */
export function resolveButtonTargetUrl(
  platform: Platform,
  target: { type: ButtonTargetType; value: string },
): string {
  const value = normalizeButtonTargetValue(target.type, target.value);

  switch (target.type) {
    case 'URL':
      return value;
    case 'PHONE': {
      const digits = value.replace(/^\+/, '');
      // Use the public HTTPS bridge on every platform. Telegram's tg:// phone
      // deep link is less portable in forwarded keyboards; this endpoint
      // validates the number and redirects to tel: only after button activation.
      const publicApi = (process.env.API_URL ?? 'https://postyarhub.ir').replace(/\/$/, '');
      return `${publicApi}/api/v1/public/phone/${encodeURIComponent(digits)}`;
    }
    case 'TELEGRAM_ID':
      return `https://t.me/${value}`;
    case 'BALE_ID':
      return `https://ble.ir/${value}`;
    case 'RUBIKA_ID':
      return `https://rubika.ir/${value}`;
    case 'USERNAME': {
      const username = value;
      switch (platform) {
        case 'telegram':
          return `https://t.me/${username}`;
        case 'bale':
          return `https://ble.ir/${username}`;
        case 'rubika':
          return `https://rubika.ir/${username}`;
        default: {
          const exhaustive: never = platform;
          throw new Error(`BUTTON_PLATFORM_UNSUPPORTED:${exhaustive}`);
        }
      }
    }
    default: {
      const exhaustive: never = target.type;
      throw new Error(`BUTTON_TARGET_UNSUPPORTED:${exhaustive}`);
    }
  }
}
