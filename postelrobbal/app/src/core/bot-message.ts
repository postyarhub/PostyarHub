export interface ExtractedBotMessage {
  text: string;
  chatId: string | null;
  senderId: string | null;
  username: string | null;
  displayName: string | null;
  buttonId?: string | null;
}

interface TgMessageLike {
  text?: unknown;
  caption?: unknown;
  chat?: { id?: unknown } | undefined;
  chat_id?: unknown;
  from?: { id?: unknown; username?: unknown; first_name?: unknown; last_name?: unknown } | undefined;
  from_id?: unknown;
  sender?: { chat_id?: unknown; sender_id?: unknown } | undefined;
}

function asId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.length > 0 && v.length <= 190) return v;
  return null;
}

/** Tolerant extractor for Telegram/Bale update shapes and Rubika-like payloads. */
export function extractBotMessage(payload: unknown): ExtractedBotMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const rubikaMessage = (root.update && typeof root.update === 'object' ? root.update as Record<string, unknown> : null);
  const rubikaInline = (root.inline_message && typeof root.inline_message === 'object' ? root.inline_message as Record<string, unknown> : null);
  if (rubikaMessage || rubikaInline) {
    const source = rubikaMessage ?? rubikaInline!;
    const msg = rubikaMessage && typeof source.new_message === 'object' ? source.new_message as Record<string, unknown> : source;
    const aux = msg.aux_data && typeof msg.aux_data === 'object' ? msg.aux_data as Record<string, unknown> : {};
    const text = typeof msg.text === 'string' ? msg.text : '';
    const chatId = asId(source.chat_id) ?? asId(msg.chat_id);
    const senderId = asId(msg.sender_id) ?? asId(source.sender_id);
    const buttonId = asId(aux.button_id);
    if (!chatId && !senderId && !text && !buttonId) return null;
    return { text, chatId, senderId, username: null, displayName: null, buttonId };
  }

  // Telegram/Bale callback buttons are delivered under callback_query. The
  // callback remains bound to the callback's originating message/chat/user.
  const callback = root['callback_query'];
  if (callback && typeof callback === 'object' && !Array.isArray(callback)) {
    const cb = callback as Record<string, unknown>;
    const message = cb['message'];
    const msg = message && typeof message === 'object' ? message as TgMessageLike : null;
    const from = cb['from'];
    const fromObj = from && typeof from === 'object' ? from as Record<string, unknown> : null;
    const text = msg
      ? (typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '')
      : '';
    const chatId = msg ? (asId(msg.chat?.id) ?? asId(msg.chat_id) ?? asId(msg.sender?.chat_id)) : null;
    const senderId = asId(fromObj?.['id']) ?? (msg ? asId(msg.from?.id) ?? asId(msg.from_id) ?? asId(msg.sender?.sender_id) : null);
    const username = typeof fromObj?.['username'] === 'string'
      ? String(fromObj['username']).slice(0, 190)
      : (typeof msg?.from?.username === 'string' ? msg.from.username.slice(0, 190) : null);
    const first = typeof fromObj?.['first_name'] === 'string'
      ? String(fromObj['first_name'])
      : (typeof msg?.from?.first_name === 'string' ? msg.from.first_name : '');
    const last = typeof fromObj?.['last_name'] === 'string'
      ? String(fromObj['last_name'])
      : (typeof msg?.from?.last_name === 'string' ? msg.from.last_name : '');
    const displayName = `${first} ${last}`.trim().slice(0, 190) || null;
    const buttonId = asId(cb['data']);
    if (!chatId && !senderId && !text && !buttonId) return null;
    return { text, chatId, senderId, username, displayName, buttonId };
  }

  const msgRaw = root['message'] ?? root['edited_message'] ?? root;
  if (!msgRaw || typeof msgRaw !== 'object') return null;
  const msg = msgRaw as TgMessageLike;
  const text = typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '';
  const chatId = asId(msg.chat?.id) ?? asId(msg.chat_id) ?? asId(msg.sender?.chat_id);
  const senderId = asId(msg.from?.id) ?? asId(msg.from_id) ?? asId(msg.sender?.sender_id);
  const username = typeof msg.from?.username === 'string' ? msg.from.username.slice(0, 190) : null;
  const first = typeof msg.from?.first_name === 'string' ? msg.from.first_name : '';
  const last = typeof msg.from?.last_name === 'string' ? msg.from.last_name : '';
  const displayName = `${first} ${last}`.trim().slice(0, 190) || null;
  if (!chatId && !senderId && !text) return null;
  return { text, chatId, senderId, username, displayName, buttonId: null };
}
