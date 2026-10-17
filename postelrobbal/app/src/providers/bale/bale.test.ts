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

  it('sends two photos as one official media-group request', async () => {
    httpMultipartJsonMock.mockResolvedValueOnce({
      status: 200,
      data: { ok: true, result: [{ message_id: 901 }, { message_id: 902 }] },
    });
    const adapter = new BaleAdapter();
    const result = await adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: 'album caption',
      parseMode: 'NONE',
      media: [
        { buffer: Buffer.from('first-photo'), filename: 'first.jpg', mime: 'image/jpeg' },
        { buffer: Buffer.from('second-photo'), filename: 'second.jpg', mime: 'image/jpeg' },
      ],
    });

    expect(result).toEqual({ ok: true, messageId: '901' });
    const [url, fields, files] = httpMultipartJsonMock.mock.calls[0] as [
      string,
      Record<string, string>,
      Array<{ fieldName: string; filename: string; contentType: string; data: Buffer }>,
    ];
    expect(url).toMatch(/\/sendMediaGroup$/);
    const media = JSON.parse(fields.media ?? '[]') as Array<Record<string, unknown>>;
    expect(media).toEqual([
      { type: 'photo', media: 'attach://file0', caption: 'album caption' },
      { type: 'photo', media: 'attach://file1' },
    ]);
    expect(files.map((file) => ({ fieldName: file.fieldName, filename: file.filename }))).toEqual([
      { fieldName: 'file0', filename: 'first.jpg' },
      { fieldName: 'file1', filename: 'second.jpg' },
    ]);
  });

  it('rejects media groups outside the documented 2–10 photo range', async () => {
    const adapter = new BaleAdapter();
    await expect(adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: '',
      media: [{ buffer: Buffer.from('only-photo'), filename: 'only.jpg', mime: 'image/jpeg' }],
    })).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpMultipartJsonMock).not.toHaveBeenCalled();
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
