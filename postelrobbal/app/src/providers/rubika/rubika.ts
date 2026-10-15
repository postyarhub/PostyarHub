import { assertSafeUrl, httpBuffer, httpJson, HttpJsonParseError } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

const BASE = 'https://botapi.rubika.ir/v3';
interface RubikaResponse<T> { ok?: boolean; result?: T; data?: T; status?: string; message?: string; error_code?: number }

function unwrap<T>(data: RubikaResponse<T>): T {
  const result = data.result ?? data.data;
  if (result === undefined) throw mapHttpToProviderError(500, data.message ?? data.status ?? 'Rubika empty response');
  return result;
}

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { status, data } = await httpJson<RubikaResponse<T>>(`${BASE}/${token.trim()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 20_000,
  }).catch((err) => {
    if (err && typeof err === 'object' && 'providerClass' in err && 'userMessageFa' in err) throw err;
    if (err instanceof HttpJsonParseError) {
      throw mapHttpToProviderError(err.status, `HTTP ${err.status} ${err.contentType || ''}`, err);
    }
    throw makeProviderError('TRANSIENT', 'پلتفرم روبیکا موقتاً در دسترس نیست؛ دوباره تلاش می‌شود.', err);
  });
  if (data.ok === false || data.status?.toUpperCase() === 'ERROR') throw mapHttpToProviderError(data.error_code ?? status, data.message ?? data.status ?? `HTTP ${status}`);
  return unwrap(data);
}

function utf16Metadata(text: string, label: string, url: string): { type: 'Link'; from_index: number; length: number; link_url: string } {
  const from = text.length - label.length;
  return { type: 'Link', from_index: from, length: label.length, link_url: url };
}

export function decorateRubikaButtons(text: string, inlineButtons?: Array<{ label: string; url?: string; callback?: string }>): {
  text: string;
  metadata?: { meta_data_parts: Array<ReturnType<typeof utf16Metadata>> };
  inline_keypad?: { rows: Array<{ buttons: Array<{ id: string; type: 'Simple'; button_text: string }> }> };
} {
  let outputText = text;
  const linkMeta: Array<ReturnType<typeof utf16Metadata>> = [];
  const simpleButtons: Array<{ id: string; type: 'Simple'; button_text: string }> = [];

  for (const button of (inlineButtons ?? []).slice(0, 8)) {
    if (button.url) {
      const label = button.label || button.url;
      outputText += `\n${label}`;
      linkMeta.push(utf16Metadata(outputText, label, button.url));
    } else if (button.callback) {
      simpleButtons.push({
        id: button.callback.slice(0, 190),
        type: 'Simple',
        button_text: button.label.slice(0, 64),
      });
    }
  }

  const payload: {
    text: string;
    metadata?: { meta_data_parts: Array<ReturnType<typeof utf16Metadata>> };
    inline_keypad?: { rows: Array<{ buttons: Array<{ id: string; type: 'Simple'; button_text: string }> }> };
  } = { text: outputText };
  if (linkMeta.length) payload.metadata = { meta_data_parts: linkMeta };
  if (simpleButtons.length) {
    const rows: Array<{ buttons: Array<{ id: string; type: 'Simple'; button_text: string }> }> = [];
    for (let index = 0; index < simpleButtons.length; index += 2) {
      rows.push({ buttons: simpleButtons.slice(index, index + 2) });
    }
    payload.inline_keypad = { rows };
  }
  return payload;
}

export class RubikaAdapter implements ProviderAdapter {
  readonly platform = 'rubika' as const;

  capabilities(): ProviderCapabilities {
    return { sendText: true, sendMedia: true, editMessage: true, deleteMessage: true, inlineButtons: true, replyKeyboard: false, webhook: true, polling: false, botIdentity: true, htmlParseMode: false };
  }

  async verifyBot(token: string): Promise<BotIdentity> {
    const me = await call<{ bot?: { bot_id: string; username?: string; bot_title?: string; description?: string }; bot_id?: string; username?: string; bot_title?: string }>(token, 'getMe', {});
    const bot = me.bot ?? me;
    return { id: String(bot.bot_id ?? bot.username ?? ''), username: bot.username ?? null, title: bot.bot_title ?? 'ربات روبیکا' };
  }

  async getChat(token: string, chatRef: string) {
    const normalizedRef = chatRef.trim();
    if (!normalizedRef) {
      throw makeProviderError('VALIDATION', 'شناسهٔ کانال روبیکا نمی‌تواند خالی باشد.');
    }
    if (/^@+/.test(normalizedRef) || /^https?:\/\/(?:www\.)?rubika\.ir\//i.test(normalizedRef)) {
      throw makeProviderError('VALIDATION', 'برای روبیکا باید شناسهٔ واقعی chat_id را وارد کنید؛ روش «شناسایی خودکار» در صفحهٔ کانال ساده‌تر و پیشنهادی است.');
    }
    const res = await call<{ chat?: { chat_id?: string; id?: string; chat_type?: string; type?: string; title?: string; username?: string }; chat_id?: string; id?: string; chat_type?: string; type?: string; title?: string; username?: string }>(token, 'getChat', { chat_id: normalizedRef });
    const chat = res.chat ?? res;
    const id = String(chat.chat_id ?? chat.id ?? '').trim();
    if (!id) throw makeProviderError('NOT_FOUND', 'مقصد روبیکا شناسهٔ معتبر ندارد.');
    const type = String(chat.chat_type ?? chat.type ?? '').trim() || null;
    return { id, type, title: chat.title ?? null, username: chat.username ?? null };
  }

  async sendText(token: string, input: SendTextInput): Promise<SendResult> {
    const decorated = decorateRubikaButtons(input.text, input.inlineButtons);
    const payload: Record<string, unknown> = { chat_id: input.chatRef, ...decorated };
    const res = await call<{ message_id: string }>(token, 'sendMessage', payload);
    const messageId = String(res.message_id ?? '').trim();
    if (!messageId) {
      throw makeProviderError('UNKNOWN', 'پاسخ روبیکا شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const type = input.kind === 'photo' ? 'Image' : 'Video';
    const reservation = await call<{ upload_url: string }>(token, 'requestSendFile', { type });
    if (!reservation.upload_url) throw makeProviderError('UNKNOWN', 'آدرس آپلود فایل از روبیکا دریافت نشد.');
    let bytes: Buffer;
    let contentType: string;
    if (input.mediaBuffer) {
      bytes = input.mediaBuffer;
      contentType = (input.mediaMime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    } else {
      if (!input.mediaUrl) throw makeProviderError('VALIDATION', 'رسانهٔ قابل ارسال مشخص نشده است.');
      const source = await httpBuffer(input.mediaUrl, { timeoutMs: 25_000, ssrfGuard: true });
      if (source.status < 200 || source.status >= 300) throw mapHttpToProviderError(source.status, `media ${source.status}`);
      bytes = source.body;
      contentType = source.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    }
    if (input.kind === 'photo' && contentType && !contentType.startsWith('image/')) {
      throw makeProviderError('VALIDATION', 'فایل تصویر مقصد، محتوای تصویری معتبر برنگرداند.');
    }
    if (input.kind === 'video' && contentType && !contentType.startsWith('video/')) {
      throw makeProviderError('VALIDATION', 'فایل ویدئویی مقصد، محتوای ویدئویی معتبر برنگرداند.');
    }
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType || (input.kind === 'photo' ? 'image/jpeg' : 'video/mp4') }), input.mediaFilename ?? (input.kind === 'photo' ? 'postyar.jpg' : 'postyar.mp4'));
    await assertSafeUrl(reservation.upload_url);
    const uploadedRes = await fetch(reservation.upload_url, { method: 'POST', body: form, signal: AbortSignal.timeout(25_000) });
    const uploaded = await uploadedRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!uploadedRes.ok) throw mapHttpToProviderError(uploadedRes.status, String(uploaded.message ?? 'upload failed'));
    const fileId = String(uploaded.file_id ?? (uploaded.data as Record<string, unknown> | undefined)?.file_id ?? (uploaded.result as Record<string, unknown> | undefined)?.file_id ?? '');
    if (!fileId) throw makeProviderError('UNKNOWN', 'فایل در روبیکا بارگذاری شد اما شناسه فایل دریافت نشد.');
    const decorated = decorateRubikaButtons(input.text || '', input.inlineButtons);
    const payload: Record<string, unknown> = { chat_id: input.chatRef, file_id: fileId, ...decorated };
    const res = await call<{ message_id: string }>(token, 'sendFile', payload);
    const messageId = String(res.message_id ?? '').trim();
    if (!messageId) {
      throw makeProviderError('UNKNOWN', 'پاسخ روبیکا شناسهٔ پیام معتبر برنگرداند.');
    }
    return { ok: true, messageId };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    await call(token, 'editMessageText', { chat_id: chatRef, message_id: messageId, text: caption });
  }

  async deleteMessage(token: string, chatRef: string, messageId: string): Promise<void> {
    await call(token, 'deleteMessage', { chat_id: chatRef, message_id: messageId });
  }

  async setWebhook(token: string, url: string): Promise<void> {
    await call(token, 'updateBotEndpoints', { url, type: 'ReceiveUpdate' });
    await call(token, 'updateBotEndpoints', { url, type: 'ReceiveInlineMessage' });
  }

  async deleteWebhook(_token: string): Promise<void> {
    // Rubika documents endpoint updates, but not a deleteWebhook method.
    // Application-side disable therefore stops ingestion without inventing an undocumented API call.
  }

  async fetchUpdatesCursor(token: string, cursor?: string | null): Promise<{ updates: unknown[]; nextOffset?: string | null }> {
    const payload: Record<string, unknown> = { limit: 50 };
    if (cursor) payload.offset_id = cursor;
    const res = await call<{ updates?: unknown[]; next_offset_id?: string }>(token, 'getUpdates', payload);
    return { updates: res.updates ?? [], nextOffset: res.next_offset_id ?? null };
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    const res = await this.fetchUpdatesCursor(token, offset > 0 ? String(offset) : null);
    return res.updates;
  }
}
