import { describe, expect, it } from 'vitest';
import {
  normalizeButtonTargetValue,
  normalizeButtonWebUrl,
  resolveButtonTargetUrl,
} from './button-target.js';

describe('typed publishing button targets', () => {
  it('maps explicit platform IDs independently of delivery platform', () => {
    expect(resolveButtonTargetUrl('telegram', { type: 'TELEGRAM_ID', value: '@postyar' })).toBe('https://t.me/postyar');
    expect(resolveButtonTargetUrl('telegram', { type: 'BALE_ID', value: '@postyar' })).toBe('https://ble.ir/postyar');
    expect(resolveButtonTargetUrl('bale', { type: 'RUBIKA_ID', value: '@postyar' })).toBe('https://rubika.ir/postyar');
  });

  it('normalizes bare website addresses to https and preserves http(s)', () => {
    expect(normalizeButtonWebUrl('postyarhub.ir/help')).toBe('https://postyarhub.ir/help');
    expect(normalizeButtonWebUrl('https://example.com/a?x=1')).toBe('https://example.com/a?x=1');
    expect(resolveButtonTargetUrl('bale', { type: 'URL', value: 'http://example.com' })).toBe('http://example.com');
  });

  it('normalizes platform IDs without requiring @', () => {
    expect(normalizeButtonTargetValue('TELEGRAM_ID', '@postyar')).toBe('postyar');
    expect(normalizeButtonTargetValue('BALE_ID', 'postyar')).toBe('postyar');
    expect(normalizeButtonTargetValue('RUBIKA_ID', '@postyar')).toBe('postyar');
  });

  it('validates phone input and uses the HTTPS bridge on every platform', () => {
    expect(normalizeButtonTargetValue('PHONE', '+98 912-123-4567')).toBe('+989121234567');
    expect(resolveButtonTargetUrl('telegram', { type: 'PHONE', value: '+989121234567' })).toBe('https://postyarhub.ir/api/v1/public/phone/989121234567');
    expect(resolveButtonTargetUrl('bale', { type: 'PHONE', value: '+989121234567' })).toBe('https://postyarhub.ir/api/v1/public/phone/989121234567');
    expect(resolveButtonTargetUrl('rubika', { type: 'PHONE', value: '+989121234567' })).toBe('https://postyarhub.ir/api/v1/public/phone/989121234567');
  });

  it('keeps legacy USERNAME routing functional', () => {
    expect(resolveButtonTargetUrl('telegram', { type: 'USERNAME', value: '@postyar' })).toBe('https://t.me/postyar');
    expect(resolveButtonTargetUrl('bale', { type: 'USERNAME', value: '@postyar' })).toBe('https://ble.ir/postyar');
    expect(resolveButtonTargetUrl('rubika', { type: 'USERNAME', value: '@postyar' })).toBe('https://rubika.ir/postyar');
  });
});
