import { describe, expect, it, vi } from 'vitest';
import { RubikaAdapter, decorateRubikaButtons } from './rubika.js';

const { httpJsonMock } = vi.hoisted(() => ({ httpJsonMock: vi.fn() }));

vi.mock('../../core/http.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/http.js')>('../../core/http.js');
  return {
    ...actual,
    httpJson: httpJsonMock,
  };
});

describe('Rubika channel reference contract', () => {
  it('rejects obvious public username and URL forms before making a provider request', async () => {
    const adapter = new RubikaAdapter();
    await expect(adapter.getChat('TOKEN', '@postyarhub')).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    await expect(adapter.getChat('TOKEN', 'https://rubika.ir/postyarhub')).rejects.toMatchObject({ providerClass: 'VALIDATION' });
    expect(httpJsonMock).not.toHaveBeenCalled();
  });

  it('lets Rubika decide whether an arbitrary non-empty chat_id is valid', async () => {
    httpJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({
      status: 200,
      data: { ok: true, result: { chat: { chat_id: 'chat-xyz-123', chat_type: 'Channel', title: 'PostYar', username: 'postyarhub' } } },
    });
    const adapter = new RubikaAdapter();
    const chat = await adapter.getChat('TOKEN', ' chat-xyz-123 ');
    expect(chat).toEqual({ id: 'chat-xyz-123', type: 'Channel', title: 'PostYar', username: 'postyarhub' });
    const [, options] = httpJsonMock.mock.calls[0] as [string, { body?: string }];
    expect(JSON.parse(options.body ?? '').chat_id).toBe('chat-xyz-123');
  });

  it('uses a canonical chat_id unchanged', async () => {
    httpJsonMock.mockReset();
    httpJsonMock.mockResolvedValue({
      status: 200,
      data: { ok: true, result: { chat: { chat_id: 'c0QFtn0C1I022abcd29f1d60c9ce5b08', chat_type: 'Channel', title: 'PostYar', username: 'postyarhub' } } },
    });
    const adapter = new RubikaAdapter();
    const chat = await adapter.getChat('TOKEN', ' c0QFtn0C1I022abcd29f1d60c9ce5b08 ');
    expect(chat.id).toBe('c0QFtn0C1I022abcd29f1d60c9ce5b08');
    const [, options] = httpJsonMock.mock.calls[0] as [string, { body?: string }];
    expect(JSON.parse(options.body ?? '').chat_id).toBe('c0QFtn0C1I022abcd29f1d60c9ce5b08');
  });
});

describe('Rubika media button payload', () => {
  it('retains URL metadata and callback keypad data for file sends', () => {
    const payload = decorateRubikaButtons('caption', [
      { label: 'سایت', url: 'https://example.com' },
      { label: 'کانال', callback: 'open-channel' },
      { label: 'راهنما', callback: 'open-help' },
    ]);
    expect(payload.text).toContain('caption');
    expect(payload.text).toContain('سایت');
    expect(payload.metadata?.meta_data_parts[0]?.link_url).toBe('https://example.com');
    expect(payload.inline_keypad?.rows).toEqual([
      { buttons: [
        { id: 'open-channel', type: 'Simple', button_text: 'کانال' },
        { id: 'open-help', type: 'Simple', button_text: 'راهنما' },
      ] },
    ]);
  });
});
