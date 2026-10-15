import { describe, expect, it } from 'vitest';
import { resolveUniqueDeliveryButtons } from './delivery-buttons.js';

const platforms = ['telegram', 'bale', 'rubika'] as const;

describe('delivery button forward compatibility', () => {
  it.each(platforms)('deduplicates duplicate URL representations in legacy mode for %s', (platform) => {
    const buttons = resolveUniqueDeliveryButtons(platform, [
      { label: 'سایت', url: 'https://example.com/help' },
      { label: 'راهنما', target: { type: 'URL', value: 'https://example.com/help' } },
      { label: 'سایت قدیمی', url: 'https://example.com/help' },
      { label: 'کانال', target: { type: platform === 'telegram' ? 'TELEGRAM_ID' : platform === 'bale' ? 'BALE_ID' : 'RUBIKA_ID', value: 'postyar' } },
    ]);

    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toEqual({ label: 'سایت', url: 'https://example.com/help' });
  });

  it.each(['telegram', 'bale'] as const)('omits non-URL legacy actions that prevent forwarded keyboards on %s', (platform) => {
    const buttons = resolveUniqueDeliveryButtons(platform, [
      { label: 'سایت', url: 'https://example.com/help' },
      { label: 'عملیات قدیمی', callback: 'legacy-action' },
      { label: 'دکمه بدون مقصد' },
      { label: 'شماره قدیمی', url: 'tel:+989121234567' },
      { label: 'کانال', target: { type: 'URL', value: 'https://example.com/channel' } },
    ]);

    expect(buttons).toEqual([
      { label: 'سایت', url: 'https://example.com/help' },
      { label: 'کانال', url: 'https://example.com/channel' },
    ]);
    expect(buttons.every((button) => typeof button.url === 'string' && button.url.length > 0)).toBe(true);
  });

  it('resolves Telegram phone buttons to a forward-compatible HTTPS URL', () => {
    const buttons = resolveUniqueDeliveryButtons('telegram', [
      { label: 'تماس', target: { type: 'PHONE', value: '+989121234567' } },
    ]);
    expect(buttons).toEqual([
      { label: 'تماس', url: 'https://postyarhub.ir/api/v1/public/phone/989121234567' },
    ]);
  });

  it('keeps Rubika callback actions because Rubika uses a native inline keypad', () => {
    const buttons = resolveUniqueDeliveryButtons('rubika', [
      { label: 'راهنما', callback: 'help' },
      { label: 'کانال', url: 'https://rubika.ir/postyar' },
    ]);
    expect(buttons).toEqual([
      { label: 'راهنما', callback: 'help' },
      { label: 'کانال', url: 'https://rubika.ir/postyar' },
    ]);
  });

  it('deduplicates a URL carried in both legacy arrays without consuming the button limit', () => {
    const buttons = resolveUniqueDeliveryButtons('telegram', [
      { label: 'A', url: 'https://example.com/a' },
      { label: 'A old shape', url: 'https://example.com/a' },
      { label: 'B', url: 'https://example.com/b' },
      { label: 'C', url: 'https://example.com/c' },
    ], 3);

    expect(buttons.map((button) => button.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });
});
