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
  it('sends ordinary photo posts as unprotected individual Bale messages', async () => {
    const adapter = new BaleAdapter();
    const result = await adapter.sendMedia('TOKEN', {
      chatRef: '-100123',
      text: 'متن پست',
      mediaBuffer: Buffer.from('jpeg-bytes'),
      mediaFilename: 'postyar.jpg',
      mediaMime: 'image/jpeg',
      kind: 'photo',
    });

    expect(result).toEqual({ ok: true, messageId: '456' });
    const [url, fields] = httpMultipartJsonMock.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('https://tapi.bale.ai/botTOKEN/sendPhoto');
    expect(fields.chat_id).toBe('-100123');
    expect(fields.caption).toBe('متن پست');
    expect(fields.protect_content).toBeUndefined();
  });

  it('uses the documented sendMediaGroup endpoint for ordered photo albums', async () => {
    httpMultipartJsonMock.mockResolvedValue({
      status: 200,
      data: { ok: true, result: [{ message_id: 456 }, { message_id: 457 }] },
    });
    const adapter = new BaleAdapter();
    const result = await adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: 'آلبوم تصاویر',
      media: [
        { buffer: Buffer.from('photo-one'), filename: 'one.jpg', mime: 'image/jpeg' },
        { buffer: Buffer.from('photo-two'), filename: 'two.jpg', mime: 'image/jpeg' },
      ],
    });

    expect(result.messageId).toBe('456');
    const [url, fields, files] = httpMultipartJsonMock.mock.calls[0] as [
      string,
      Record<string, string>,
      Array<{ fieldName: string; filename: string; data: Buffer }>,
    ];
    expect(url).toContain('/sendMediaGroup');
    expect(fields.chat_id).toBe('-100123');
    const media = JSON.parse(fields.media ?? '[]') as Array<{ type: string; media: string; caption?: string }>;
    expect(media).toEqual([
      { type: 'photo', media: 'attach://file0', caption: 'آلبوم تصاویر' },
      { type: 'photo', media: 'attach://file1' },
    ]);
    expect(files.map((file) => [file.fieldName, file.filename])).toEqual([
      ['file0', 'one.jpg'],
      ['file1', 'two.jpg'],
    ]);
  });

  it('rejects album sizes outside the documented 2–10 photo range before any request', async () => {
    const adapter = new BaleAdapter();
    await expect(adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: '',
      media: [{ buffer: Buffer.from('one'), filename: 'one.jpg', mime: 'image/jpeg' }],
    })).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpMultipartJsonMock).not.toHaveBeenCalled();
    expect(httpJsonMock).not.toHaveBeenCalled();
  });

});

describe('Bale published message editing', () => {
  beforeEach(() => {
    httpJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: true } });
  });

  it('edits existing text and captions without changing the target chat or message', async () => {
    const adapter = new BaleAdapter();
    await adapter.editMessageText('TOKEN', '-100123', '901', 'updated text');
    const [textUrl, textOptions] = httpJsonMock.mock.calls[0] as [string, { body?: string }];
    expect(textUrl).toBe('https://tapi.bale.ai/botTOKEN/editMessageText');
    const textPayload = new URLSearchParams(textOptions.body ?? '');
    expect(textPayload.get('chat_id')).toBe('-100123');
    expect(textPayload.get('message_id')).toBe('901');
    expect(textPayload.get('text')).toBe('updated text');

    await adapter.editMessageCaption('TOKEN', '-100123', '902', 'new caption');
    const [captionUrl, captionOptions] = httpJsonMock.mock.calls[1] as [string, { body?: string }];
    expect(captionUrl).toBe('https://tapi.bale.ai/botTOKEN/editMessageCaption');
    const captionPayload = new URLSearchParams(captionOptions.body ?? '');
    expect(captionPayload.get('chat_id')).toBe('-100123');
    expect(captionPayload.get('message_id')).toBe('902');
    expect(captionPayload.get('caption')).toBe('new caption');
  });
});
