import { describe, expect, it } from 'vitest';
import { extractBotMessage } from './bot-message.js';

describe('bot message extraction', () => {
  it('extracts Telegram callback_query chat, user, and button data', () => {
    expect(extractBotMessage({
      update_id: 101,
      callback_query: {
        id: 'cb-1',
        data: 'PLAN_BASIC',
        from: { id: 77, username: 'user_a', first_name: 'A' },
        message: { message_id: 12, text: 'انتخاب پلن', chat: { id: -100123 } },
      },
    })).toEqual({
      text: 'انتخاب پلن', chatId: '-100123', senderId: '77', username: 'user_a', displayName: 'A', buttonId: 'PLAN_BASIC',
    });
  });

  it('extracts Bale/Telegram ordinary messages without changing existing semantics', () => {
    expect(extractBotMessage({
      update_id: 102,
      message: { text: '/start', chat: { id: 55 }, from: { id: 66, username: 'user_b' } },
    })).toEqual({ text: '/start', chatId: '55', senderId: '66', username: 'user_b', displayName: null, buttonId: null });
  });

  it('extracts Rubika button callbacks into the same bounded buttonId field', () => {
    expect(extractBotMessage({
      update: { chat_id: 'rubika-chat', new_message: { chat_id: 'rubika-chat', sender_id: 'rubika-user', text: '', aux_data: { button_id: 'PLAN_PRO' } } },
    })).toEqual({ text: '', chatId: 'rubika-chat', senderId: 'rubika-user', username: null, displayName: null, buttonId: 'PLAN_PRO' });
  });
});
