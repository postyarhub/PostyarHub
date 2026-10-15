/**
 * Provider abstraction (ADR-0005, §16): capability-declaring adapters.
 * Never emulate a capability a platform does not support (§15).
 */
export type Platform = 'telegram' | 'bale' | 'rubika';

export interface ProviderCapabilities {
  sendText: boolean;
  sendMedia: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  inlineButtons: boolean;
  replyKeyboard: boolean;
  webhook: boolean;
  polling: boolean;
  botIdentity: boolean;
  htmlParseMode: boolean;
}

export interface BotIdentity {
  id: string;
  username: string | null;
  title: string;
}

export interface ChatInfo {
  id: string;
  type: string | null;
  title: string | null;
  username: string | null;
}

export interface SendTextInput {
  chatRef: string;
  text: string;
  parseMode?: 'NONE' | 'HTML' | 'MARKDOWN';
  inlineButtons?: Array<{ label: string; url?: string; callback?: string }>;
}

export interface SendMediaInput extends SendTextInput {
  /** Legacy/provider-compatible HTTP source. New delivery uses mediaBuffer. */
  mediaUrl?: string;
  /** Preferred: provider receives bytes uploaded directly from private storage. */
  mediaBuffer?: Buffer;
  mediaFilename?: string;
  mediaMime?: string;
  kind: 'photo' | 'video';
}

export interface SendResult {
  ok: true;
  messageId: string;
}

export interface ProviderAdapter {
  readonly platform: Platform;
  capabilities(): ProviderCapabilities;
  /** Verify bot token via getMe; throws classified errors. */
  verifyBot(token: string): Promise<BotIdentity>;
  /** Verify/read a destination without sending a message. */
  getChat(token: string, chatRef: string): Promise<ChatInfo>;
  sendText(token: string, input: SendTextInput): Promise<SendResult>;
  sendMedia(token: string, input: SendMediaInput): Promise<SendResult>;
  editMessageCaption?(token: string, chatRef: string, messageId: string, caption: string): Promise<void>;
  deleteMessage?(token: string, chatRef: string, messageId: string): Promise<void>;
  setWebhook?(token: string, url: string, secret?: string): Promise<void>;
  deleteWebhook?(token: string): Promise<void>;
  fetchUpdates?(token: string, offset: number): Promise<unknown[]>;
  fetchUpdatesCursor?(token: string, cursor?: string | null): Promise<{ updates: unknown[]; nextOffset?: string | null }>;
  getStickerSet?(token: string, name: string): Promise<{
    name: string;
    title: string;
    sticker_type: string;
    stickers: Array<{
      file_id: string;
      file_unique_id: string;
      type: string;
      width: number;
      height: number;
      is_animated?: boolean;
      is_video?: boolean;
      thumbnail?: { file_id: string };
      emoji?: string;
      custom_emoji_id?: string;
    }>;
  }>;
  getFile?(token: string, fileId: string): Promise<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>;
}

/** Error classification for provider failures (§114, §185). */
export type ProviderErrorClass =
  | 'TRANSIENT' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'NOT_FOUND'
  | 'VALIDATION' | 'BLOCKED' | 'UNKNOWN';

export interface ProviderError extends Error {
  providerClass: ProviderErrorClass;
  userMessageFa: string;
  /** Provider-advised wait before repeating a rate-limited request. */
  retryAfterMs?: number;
}

export function makeProviderError(providerClass: ProviderErrorClass, userMessageFa: string, cause?: unknown): ProviderError {
  const err = new Error(userMessageFa) as ProviderError;
  err.providerClass = providerClass;
  err.userMessageFa = userMessageFa;
  if (cause) (err as { cause?: unknown }).cause = cause;
  return err;
}

export function mapHttpToProviderError(status: number, description: string, cause?: unknown): ProviderError {
  const d = description.toLowerCase();
  if (status === 401 || d.includes('unauthorized'))
    return makeProviderError('UNAUTHORIZED', 'توکن ربات/کانال نامعتبر است. ربات را دوباره متصل کنید.', cause);
  if (d.includes('blocked') || d.includes('kicked') || d.includes('not enough rights') || status === 403 || d.includes('forbidden'))
    return makeProviderError('BLOCKED', 'ارسال به این مقصد مجاز نیست یا دسترسی ربات کافی نیست.', cause);
  if (status === 404 || d.includes('chat not found'))
    return makeProviderError('NOT_FOUND', 'مقصد (کانال/گفتگو) یافت نشد یا ربات عضو آن نیست.', cause);
  if (status === 429 || d.includes('too many requests'))
    return makeProviderError('RATE_LIMITED', 'محدودیت نرخ ارسال پلتفرم؛ بعداً تلاش می‌شود.', cause);
  if (status === 400 && (d.includes('parse') || d.includes('reply_markup') || d.includes('keyboard') || d.includes('button') || d.includes('url')))
    return makeProviderError('VALIDATION', 'یکی از دکمه‌ها یا لینک‌های پیام برای این پلتفرم معتبر نیست.', cause);
  if (status === 400 && (d.includes('photo') || d.includes('video') || d.includes('media') || d.includes('file')))
    return makeProviderError('VALIDATION', 'رسانهٔ پیوست‌شده برای این پلتفرم قابل انتشار نیست.', cause);
  if (status >= 500 || d.includes('timeout') || d.includes('bad gateway'))
    return makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', cause);
  return makeProviderError('UNKNOWN', 'ارسال به پلتفرم ناموفق بود.', cause);
}
