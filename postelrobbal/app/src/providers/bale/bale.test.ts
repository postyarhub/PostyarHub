import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BaleAdapter, formEncode } from './bale.js';

const { httpJsonMock, httpMultipartJsonMock } = vi.hoisted(() => ({
  httpJsonMock: vi.fn(),
  httpMultipartJsonMock: vi.fn(),
}));

vi.mock('../../core/http.js', () => ({
  httpJson: httpJsonMock,
  httpMultipartJson: httpMultipartJsonMock,
  HttpJsonParseError: class HttpJsonParseError extends Error {},
}));

describe('Bale request encoding and inline keyboard payload', () => {
  beforeEach(() => {
    httpJsonMock.mockReset();
    httpMultipartJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: { message_id: 123 } } });
    httpMultipartJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: { message_id: 456 } } });
  });

  it('form-encodes structured reply markup as JSON', () => {
    const encoded = formEncode({
      chat_id: '-100',
      text: 'hello',
      reply_markup: { inline_keyboard: [[{ text: 'site', url: 'https://example.com' }]] },
    });
    const parsed = new URLSearchParams(encoded);
    expect(parsed.get('chat_id')).toBe('-100');
    expect(parsed.get('text')).toBe('hello');
    expect(JSON.parse(parsed.get('reply_markup') ?? '')).toEqual({
      inline_keyboard: [[{ text: 'site', url: 'https://example.com' }]],
    });
  });

  it('keeps short Bale labels paired and gives only a long label a full-width row', async () => {
    const adapter = new BaleAdapter();
    const buttons = [
      { label: 'کانال تلگرام', url: 'https://t.me/example' },
      { label: 'کانال بله', url: 'https://ble.ir/example' },
      { label: 'وب‌سایت پست‌یار 🌐', url: 'https://example.com' },
      { label: 'کانال روبیکا', url: 'https://rubika.ir/example' },
      { label: 'شماره تماس', url: 'https://example.com/contact' },
    ];
    await adapter.sendMedia('TOKEN', {
      chatRef: '-100123',
      text: 'caption',
      mediaBuffer: Buffer.from('jpeg-bytes'),
      mediaFilename: 'postyar.jpg',
      mediaMime: 'image/jpeg',
      kind: 'photo',
      inlineButtons: buttons,
    });

    const [, fields] = httpMultipartJsonMock.mock.calls[0] as [string, Record<string, string>];
    const markup = JSON.parse(fields.reply_markup ?? '') as { inline_keyboard: unknown };
    expect(markup.inline_keyboard).toEqual([
      [
        { text: 'کانال تلگرام', url: 'https://t.me/example' },
        { text: 'کانال بله', url: 'https://ble.ir/example' },
      ],
      [{ text: 'وب‌سایت پست‌یار 🌐', url: 'https://example.com' }],
      [
        { text: 'کانال روبیکا', url: 'https://rubika.ir/example' },
        { text: 'شماره تماس', url: 'https://example.com/contact' },
      ],
    ]);
  });

  it('rejects tel URLs before provider send', async () => {
    const adapter = new BaleAdapter();
    await expect(adapter.sendText('TOKEN', {
      chatRef: '-100123',
      text: 'hello',
      inlineButtons: [{ label: 'phone', url: 'tel:+989121234567' }],
    })).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpJsonMock).not.toHaveBeenCalled();
  });
});
