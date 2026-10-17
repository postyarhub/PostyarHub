import { httpJson, httpMultipartJson, HttpJsonParseError } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, SendMediaGroupInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

/**
 * Bale adapter — tapi.bale.ai implements the Telegram Bot API protocol
 * Normal Bot API requests use the documented JSON encoding. Declared deltas:
 * deleteMessage unsupported; HTML parse mode unreliable → plain text default
 * (reference bug 9.2: "strip HTML for Bale" — we encode that as a capability).
 */
const BASE = 'https://tapi.bale.ai';

interface BaleResponse<T> { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }

export function formEncode(payload: Record<string, unknown>): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form.toString();
}

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { status, data } = await httpJson<BaleResponse<T>>(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formEncode(payload),
    timeoutMs: 20_000,
  }).catch((err) => {
    if (err && typeof err === 'object' && 'providerClass' in err && 'userMessageFa' in err) throw err;
    if (err instanceof HttpJsonParseError) {
      throw mapHttpToProviderError(err.status, `HTTP ${err.status} ${err.contentType || ''}`, err);
    }
    throw makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', err);
  });
  if (!data.ok || data.result === undefined) {
    const description = data.description ?? `HTTP ${status}`;
    const error = mapHttpToProviderError(data.error_code ?? status, description, new Error(description));
    const retryAfterSeconds = data.parameters?.retry_after;
    if (Number.isFinite(retryAfterSeconds) && (retryAfterSeconds ?? 0) > 0) {
      error.retryAfterMs = Math.min(3_600_000, Math.ceil((retryAfterSeconds as number) * 1000));
    }
    throw error;
  }
  return data.result;
}

async function resolveChatId(token: string, chatRef: string): Promise<string> {
  const ref = chatRef.trim();
  if (!ref.startsWith('@')) return ref;
  const chat = await call<{ id: number | string }>(token, 'getChat', { chat_id: ref });
  const id = String(chat.id ?? '').trim();
  if (!id) throw makeProviderError('NOT_FOUND', 'مقصد بله شناسهٔ معتبر ندارد.');
  return id;
}

export class BaleAdapter implements ProviderAdapter {
  readonly platform = 'bale' as const;

  capabilities(): ProviderCapabilities {
    return {
      sendText: true, sendMedia: true, editMessage: true, deleteMessage: false,
      inlineButtons: true, replyKeyboard: true, webhook: true, polling: true,
      botIdentity: true, htmlParseMode: false,
    };
  }

  async verifyBot(token: string): Promise<BotIdentity> {
    const me = await call<{ id: number; username?: string; first_name: string }>(token, 'getMe', {});
    return { id: String(me.id), username: me.username ?? null, title: me.first_name };
  }

  async getChat(token: string, chatRef: string) {
    const chat = await call<{ id: number | string; type?: string; title?: string; username?: string }>(token, 'getChat', { chat_id: chatRef.trim() });
    const id = String(chat.id ?? '').trim();
    if (!id) throw makeProviderError('NOT_FOUND', 'مقصد بله شناسهٔ معتبر ندارد.');
    return { id, type: chat.type ?? null, title: chat.title ?? null, username: chat.username ?? null };
  }

  private buttons(input: { inlineButtons?: Array<{ label: string; url?: string; callback?: string }> }) {
    if (!input.inlineButtons?.length) return undefined;
    const buttons = input.inlineButtons.map((b) => {
      const label = String(b.label ?? '').trim();
      if (!label) throw makeProviderError('VALIDATION', 'عنوان دکمه نمی‌تواند خالی باشد.');
      if (b.url) {
        let protocol = '';
        try { protocol = new URL(b.url.trim()).protocol; } catch {
          throw makeProviderError('VALIDATION', 'لینک دکمهٔ بله معتبر نیست.');
        }
        if (!['http:', 'https:'].includes(protocol)) {
          throw makeProviderError('VALIDATION', 'لینک دکمهٔ بله باید http یا https باشد.');
        }
      }
      if (b.callback && Buffer.byteLength(b.callback.trim(), 'utf8') > 64) {
        throw makeProviderError('VALIDATION', 'دادهٔ دکمهٔ بله بیش از حد مجاز است.');
      }
      return b.url
        ? { text: label, url: b.url.trim() }
        : { text: label, callback_data: (b.callback ?? label).trim() };
    });
    const rows: Array<Array<
      | { text: string; url: string }
      | { text: string; callback_data: string }
    >> = [];
    // Keep short Persian labels compact in pairs; isolate a long label only
    // when a two-column row is likely to clip it in the Bale client. This is
    // a conservative visual-width estimate, not a change to button actions.
    const visualWidth = (label: string): number => Array.from(label).reduce((width, character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (/\s/u.test(character)) return width + 0.35;
      if (codePoint >= 0x1f000 || (codePoint >= 0x2600 && codePoint <= 0x27ff)) return width + 2;
      if (codePoint <= 0x7f) {
        if (/[ilI.,:;!|]/u.test(character)) return width + 0.45;
        if (/[MW@#%&]/u.test(character)) return width + 1.25;
        return width + 0.75;
      }
      return width + 1;
    }, 0);
    for (let index = 0; index < buttons.length;) {
      // TS strict/noUncheckedIndexedAccess treats indexed reads as possibly
      // undefined. Narrow both elements before reading their text or emitting
      // a row; this is defensive at runtime as well as type-safe.
      const current = buttons[index];
      if (!current) {
        index += 1;
        continue;
      }
      const currentWidth = visualWidth(current.text);
      const next = buttons[index + 1];
      const nextWidth = next ? visualWidth(next.text) : Number.POSITIVE_INFINITY;
      if (next && currentWidth <= 12 && nextWidth <= 12 && currentWidth + nextWidth <= 22) {
        rows.push(buttons.slice(index, index + 2));
        index += 2;
      } else {
        rows.push([current]);
        index += 1;
      }
    }
    return { inline_keyboard: rows };
  }

  async sendText(token: string, input: SendTextInput): Promise<SendResult> {
    const chatId = await resolveChatId(token, input.chatRef);
    const replyMarkup = this.buttons(input);
    const res = await call<{ message_id: number }>(token, 'sendMessage', {
      chat_id: chatId,
      text: input.text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!Number.isInteger(res.message_id) || res.message_id <= 0) {
      throw makeProviderError('UNKNOWN', 'پاسخ بله شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId: String(res.message_id) };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const method = input.kind === 'photo' ? 'sendPhoto' : 'sendVideo';
    const chatId = await resolveChatId(token, input.chatRef);
    const replyMarkup = this.buttons(input);
    if (input.mediaBuffer) {
      const fields: Record<string, string> = { chat_id: chatId };
      if (input.text) fields.caption = input.text;
      if (replyMarkup) fields.reply_markup = JSON.stringify(replyMarkup);
      const { status, data } = await httpMultipartJson<BaleResponse<{ message_id: number }>>(`${BASE}/bot${token}/${method}`, fields, {
        fieldName: input.kind === 'photo' ? 'photo' : 'video',
        filename: input.mediaFilename ?? (input.kind === 'photo' ? 'postyar.jpg' : 'postyar.mp4'),
        contentType: input.mediaMime ?? (input.kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
        data: input.mediaBuffer,
      }, 30_000).catch((err) => {
        if (err && typeof err === 'object' && 'providerClass' in err && 'userMessageFa' in err) throw err;
        if (err instanceof HttpJsonParseError) {
          throw mapHttpToProviderError(err.status, `HTTP ${err.status} ${err.contentType || ''}`, err);
        }
        throw makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', err);
      });
      if (!data.ok || data.result === undefined) {
        const description = data.description ?? `HTTP ${status}`;
        const error = mapHttpToProviderError(data.error_code ?? status, description, new Error(description));
        const retryAfterSeconds = data.parameters?.retry_after;
        if (Number.isFinite(retryAfterSeconds) && (retryAfterSeconds ?? 0) > 0) {
          error.retryAfterMs = Math.min(3_600_000, Math.ceil((retryAfterSeconds as number) * 1000));
        }
        throw error;
      }
      const messageId = data.result.message_id;
      if (!Number.isInteger(messageId) || messageId <= 0) throw makeProviderError('UNKNOWN', 'پاسخ بله شناسهٔ پیام معتبر برنگرداند.');
      return { ok: true, messageId: String(messageId) };
    }
    if (!input.mediaUrl) throw makeProviderError('VALIDATION', 'رسانهٔ قابل ارسال مشخص نشده است.');
    const res = await call<{ message_id: number }>(token, method, {
      chat_id: chatId,
      [input.kind === 'photo' ? 'photo' : 'video']: input.mediaUrl,
      caption: input.text || undefined,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!Number.isInteger(res.message_id) || res.message_id <= 0) {
      throw makeProviderError('UNKNOWN', 'پاسخ بله شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId: String(res.message_id) };
  }

  async sendMediaGroup(token: string, input: SendMediaGroupInput): Promise<SendResult> {
    if (input.media.length < 2 || input.media.length > 10) {
      throw makeProviderError('VALIDATION', 'برای ارسال آلبوم باید بین ۲ تا ۱۰ تصویر انتخاب شود.');
    }
    if (input.text.length > 1024) {
      throw makeProviderError('VALIDATION', 'متن همراه آلبوم حداکثر ۱۰۲۴ نویسه است.');
    }

    const chatId = await resolveChatId(token, input.chatRef);
    const media = input.media.map((item, index) => ({
      type: 'photo',
      media: `attach://file${index}`,
      ...(index === 0 && input.text ? { caption: input.text } : {}),
    }));
    const fields = {
      chat_id: chatId,
      media: JSON.stringify(media),
    };
    const files = input.media.map((item, index) => ({
      fieldName: `file${index}`,
      filename: item.filename,
      contentType: item.mime || 'image/jpeg',
      data: item.buffer,
    }));

    const { status, data } = await httpMultipartJson<BaleResponse<Array<{ message_id: number }>>>(
      `${BASE}/bot${token}/sendMediaGroup`,
      fields,
      files,
      30_000,
    ).catch((err) => {
      if (err && typeof err === 'object' && 'providerClass' in err && 'userMessageFa' in err) throw err;
      if (err instanceof HttpJsonParseError) {
        throw mapHttpToProviderError(err.status, `HTTP ${err.status} ${err.contentType || ''}`, err);
      }
      throw makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', err);
    });

    if (!data.ok || !Array.isArray(data.result) || data.result.length !== input.media.length) {
      const description = data.description ?? `HTTP ${status}`;
      const error = mapHttpToProviderError(data.error_code ?? status, description, new Error(description));
      const retryAfterSeconds = data.parameters?.retry_after;
      if (Number.isFinite(retryAfterSeconds) && (retryAfterSeconds ?? 0) > 0) {
        error.retryAfterMs = Math.min(3_600_000, Math.ceil((retryAfterSeconds as number) * 1000));
      }
      throw error;
    }

    const firstMessageId = data.result[0]?.message_id;
    if (!Number.isInteger(firstMessageId) || (firstMessageId ?? 0) <= 0) {
      throw makeProviderError('UNKNOWN', 'پاسخ بله شناسهٔ پیام معتبر برای آلبوم برنگرداند.');
    }
    return { ok: true, messageId: String(firstMessageId) };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    const chatId = await resolveChatId(token, chatRef);
    await call(token, 'editMessageCaption', { chat_id: chatId, message_id: Number(messageId), caption });
  }

  async setWebhook(token: string, url: string, secret?: string): Promise<void> {
    // Bale supports webhook without secret_token header; the URL path carries
    // an unguessable per-bot id and we additionally validate the update shape.
    await call(token, 'setWebhook', { url, allowed_updates: ['message', 'callback_query'] });
    void secret;
  }

  async deleteWebhook(token: string): Promise<void> {
    await call(token, 'deleteWebhook', {});
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    return call<unknown[]>(token, 'getUpdates', { offset, limit: 50, timeout: 15 });
  }
}
