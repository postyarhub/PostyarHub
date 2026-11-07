import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TelegramAdapter } from './telegram.js';

const { httpJsonMock, httpMultipartJsonMock } = vi.hoisted(() => ({
  httpJsonMock: vi.fn(),
  httpMultipartJsonMock: vi.fn(),
}));

vi.mock('../../core/http.js', () => ({
  httpJson: httpJsonMock,
  httpMultipartJson: httpMultipartJsonMock,
  HttpJsonParseError: class HttpJsonParseError extends Error {},
}));

describe('Telegram media delivery payload', () => {
  beforeEach(() => {
    httpJsonMock.mockReset();
    httpMultipartJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: { message_id: 123 } } });
    httpMultipartJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: { message_id: 456 } } });
  });

  it('preserves MarkdownV2 parse mode for media captions', async () => {
    const adapter = new TelegramAdapter();
    const result = await adapter.sendMedia('TOKEN', {
      chatRef: '-100123',
      text: '*hello*',
      parseMode: 'MARKDOWN',
      mediaUrl: 'https://postyar.example/media.jpg',
      kind: 'photo',
    });

    expect(result.messageId).toBe('123');
    const [, request] = httpJsonMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(request.body) as Record<string, unknown>;
    expect(payload.parse_mode).toBe('MarkdownV2');
  });

  it('builds the provider-required nested inline keyboard for media delivery', async () => {
    const adapter = new TelegramAdapter();
    const buttons = [
      { label: 'سایت', url: 'https://example.com' },
      { label: 'تلگرام', url: 'https://t.me/example' },
      { label: 'روبیکا', url: 'https://rubika.ir/example' },
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
    expect(markup.inline_keyboard).toEqual([[{ text: 'سایت', url: 'https://example.com' }, { text: 'تلگرام', url: 'https://t.me/example' }], [{ text: 'روبیکا', url: 'https://rubika.ir/example' }]]);
  });

  it('sends two photos as one official media-group request', async () => {
    httpMultipartJsonMock.mockResolvedValueOnce({
      status: 200,
      data: { ok: true, result: [{ message_id: 901 }, { message_id: 902 }] },
    });
    const adapter = new TelegramAdapter();
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
    const adapter = new TelegramAdapter();
    await expect(adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: '',
      media: [{ buffer: Buffer.from('only-photo'), filename: 'only.jpg', mime: 'image/jpeg' }],
    })).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpMultipartJsonMock).not.toHaveBeenCalled();
  });

  it('uploads two photos through sendMediaGroup as one album', async () => {
    httpMultipartJsonMock.mockResolvedValueOnce({
      status: 200,
      data: { ok: true, result: [{ message_id: 101 }, { message_id: 102 }] },
    });
    const adapter = new TelegramAdapter();
    const result = await adapter.sendMediaGroup('TOKEN', {
      chatRef: '-100123',
      text: 'album caption',
      parseMode: 'HTML',
      media: [
        { buffer: Buffer.from('photo-one'), filename: 'one.jpg', mime: 'image/jpeg' },
        { buffer: Buffer.from('photo-two'), filename: 'two.jpg', mime: 'image/jpeg' },
      ],
    });

    expect(result).toEqual({ ok: true, messageId: '101' });
    const [url, fields, files] = httpMultipartJsonMock.mock.calls[0] as [
      string,
      Record<string, string>,
      Array<{ fieldName: string; filename: string; data: Buffer }>,
    ];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMediaGroup');
    const payload = JSON.parse(fields.media ?? '') as Array<{ type: string; media: string; caption?: string; parse_mode?: string }>;
    expect(payload).toEqual([
      { type: 'photo', media: 'attach://file0', caption: 'album caption', parse_mode: 'HTML' },
      { type: 'photo', media: 'attach://file1' },
    ]);
    expect(files).toHaveLength(2);
    expect(files.map((file) => [file.fieldName, file.filename])).toEqual([
      ['file0', 'one.jpg'],
      ['file1', 'two.jpg'],
    ]);
  });

  it('rejects an unsupported button scheme before provider send', async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.sendText('TOKEN', {
      chatRef: '-100123',
      text: 'hello',
      inlineButtons: [{ label: 'bad', url: 'tel:+989121234567' }],
    })).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpJsonMock).not.toHaveBeenCalled();
  });
});

describe('Telegram published message editing', () => {
  beforeEach(() => {
    httpJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({ status: 200, data: { ok: true, result: true } });
  });

  it('keeps the original channel and message ID when editing text and captions', async () => {
    const adapter = new TelegramAdapter();
    await adapter.editMessageText('TOKEN', '-100123', '901', '<b>updated</b>', 'HTML');
    const [textUrl, textOptions] = httpJsonMock.mock.calls[0] as [string, { body?: string }];
    expect(textUrl).toBe('https://api.telegram.org/botTOKEN/editMessageText');
    expect(JSON.parse(textOptions.body ?? '')).toEqual({
      chat_id: '-100123', message_id: 901, text: '<b>updated</b>', parse_mode: 'HTML',
    });

    await adapter.editMessageCaption('TOKEN', '-100123', '902', 'new caption', 'MARKDOWN');
    const [captionUrl, captionOptions] = httpJsonMock.mock.calls[1] as [string, { body?: string }];
    expect(captionUrl).toBe('https://api.telegram.org/botTOKEN/editMessageCaption');
    expect(JSON.parse(captionOptions.body ?? '')).toEqual({
      chat_id: '-100123', message_id: 902, caption: 'new caption', parse_mode: 'MarkdownV2',
    });
  });
});
