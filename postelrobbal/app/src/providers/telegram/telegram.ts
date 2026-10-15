import { httpJson, httpMultipartJson, HttpJsonParseError } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

/**
 * Telegram Bot API adapter — api.telegram.org.
 * Full capability set per Bot API: text, media, edit, delete, inline buttons,
 * webhook with secret_token, polling, HTML parse mode.
 */
const BASE = 'https://api.telegram.org';

interface TgResponse<T> { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { status, data } = await httpJson<TgResponse<T>>(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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

export class TelegramAdapter implements ProviderAdapter {
  readonly platform = 'telegram' as const;

  capabilities(): ProviderCapabilities {
    return {
      sendText: true, sendMedia: true, editMessage: true, deleteMessage: true,
      inlineButtons: true, replyKeyboard: true, webhook: true, polling: true,
      botIdentity: true, htmlParseMode: true,
    };
  }

  async verifyBot(token: string): Promise<BotIdentity> {
    const me = await call<{ id: number; username?: string; first_name: string }>(token, 'getMe', {});
    return { id: String(me.id), username: me.username ?? null, title: me.first_name };
  }

  async getChat(token: string, chatRef: string) {
    const chat = await call<{ id: number | string; type?: string; title?: string; username?: string }>(token, 'getChat', { chat_id: chatRef.trim() });
    const id = String(chat.id ?? '').trim();
    if (!id) throw makeProviderError('NOT_FOUND', 'مقصد تلگرام شناسهٔ معتبر ندارد.');
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
          throw makeProviderError('VALIDATION', 'لینک دکمهٔ تلگرام معتبر نیست.');
        }
        if (!['http:', 'https:', 'tg:'].includes(protocol)) {
          throw makeProviderError('VALIDATION', 'لینک دکمهٔ تلگرام باید http، https یا tg باشد.');
        }
      }
      if (b.callback && Buffer.byteLength(b.callback.trim(), 'utf8') > 64) {
        throw makeProviderError('VALIDATION', 'دادهٔ دکمهٔ تلگرام بیش از حد مجاز است.');
      }
      return b.url
        ? { text: label, url: b.url.trim() }
        : { text: label, callback_data: (b.callback ?? label).trim() };
    });
    const rows: Array<Array<
      | { text: string; url: string }
      | { text: string; callback_data: string }
    >> = [];
    for (let index = 0; index < buttons.length; index += 2) {
      rows.push(buttons.slice(index, index + 2));
    }
    return { inline_keyboard: rows };
  }

  async sendText(token: string, input: SendTextInput): Promise<SendResult> {
    const replyMarkup = this.buttons(input);
    const res = await call<{ message_id: number }>(token, 'sendMessage', {
      chat_id: input.chatRef,
      text: input.text,
      ...(input.parseMode === 'HTML' ? { parse_mode: 'HTML' } : {}),
      ...(input.parseMode === 'MARKDOWN' ? { parse_mode: 'MarkdownV2' } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      disable_web_page_preview: false,
    });
    if (!Number.isInteger(res.message_id) || res.message_id <= 0) {
      throw makeProviderError('UNKNOWN', 'پاسخ تلگرام شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId: String(res.message_id) };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const method = input.kind === 'photo' ? 'sendPhoto' : 'sendVideo';
    const replyMarkup = this.buttons(input);
    if (input.mediaBuffer) {
      const fields: Record<string, string> = { chat_id: input.chatRef };
      if (input.text) fields.caption = input.text;
      if (input.parseMode === 'HTML') fields.parse_mode = 'HTML';
      if (input.parseMode === 'MARKDOWN') fields.parse_mode = 'MarkdownV2';
      if (replyMarkup) fields.reply_markup = JSON.stringify(replyMarkup);
      const { status, data } = await httpMultipartJson<TgResponse<{ message_id: number }>>(`${BASE}/bot${token}/${method}`, fields, {
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
      if (!Number.isInteger(messageId) || messageId <= 0) throw makeProviderError('UNKNOWN', 'پاسخ تلگرام شناسهٔ پیام معتبر برنگرداند.');
      return { ok: true, messageId: String(messageId) };
    }
    if (!input.mediaUrl) throw makeProviderError('VALIDATION', 'رسانهٔ قابل ارسال مشخص نشده است.');
    const res = await call<{ message_id: number }>(token, method, {
      chat_id: input.chatRef,
      [input.kind === 'photo' ? 'photo' : 'video']: input.mediaUrl,
      caption: input.text || undefined,
      ...(input.parseMode === 'HTML' ? { parse_mode: 'HTML' } : {}),
      ...(input.parseMode === 'MARKDOWN' ? { parse_mode: 'MarkdownV2' } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!Number.isInteger(res.message_id) || res.message_id <= 0) {
      throw makeProviderError('UNKNOWN', 'پاسخ تلگرام شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId: String(res.message_id) };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    await call(token, 'editMessageCaption', { chat_id: chatRef, message_id: Number(messageId), caption });
  }

  async deleteMessage(token: string, chatRef: string, messageId: string): Promise<void> {
    await call(token, 'deleteMessage', { chat_id: chatRef, message_id: Number(messageId) });
  }

  async setWebhook(token: string, url: string, secret?: string): Promise<void> {
    await call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
  }

  async deleteWebhook(token: string): Promise<void> {
    await call(token, 'deleteWebhook', {});
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    return call<unknown[]>(token, 'getUpdates', { offset, limit: 50, timeout: 15 });
  }

  async getStickerSet(token: string, name: string) {
    return call<{
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
    }>(token, 'getStickerSet', { name });
  }

  async getFile(token: string, fileId: string) {
    return call<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>(token, 'getFile', { file_id: fileId });
  }
}
