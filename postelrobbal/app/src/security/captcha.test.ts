import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeCaptchaIssuanceSlot, issueCaptcha, verifyCaptcha } from './captcha.js';

const TEST_SECRET = 'postyar-captcha-regression-secret-2026-10-14';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function expectedAnswer(captchaId: string, binding: string): string {
  const key = createHash('sha256').update(TEST_SECRET).digest();
  const bindingDigest = createHash('sha256').update(String(binding || '')).digest('hex');
  const digest = createHmac('sha256', key)
    .update(`postyar-captcha:v3:${captchaId}:${bindingDigest}`)
    .digest();
  return Array.from({ length: 5 }, (_, i) => ALPHABET[(digest[i] ?? 0) % ALPHABET.length] ?? 'A').join('');
}

beforeEach(() => {
  process.env.CSRF_SECRET = TEST_SECRET;
});

describe('CAPTCHA anti-automation controls', () => {
  it('consumes a challenge on the first failed verification attempt', () => {
    const binding = `failed-attempt-${Date.now()}-${Math.random()}`;
    const challenge = issueCaptcha(binding);
    const answer = expectedAnswer(challenge.captchaId, binding);
    const wrong = answer === 'AAAAA' ? 'BBBBB' : 'AAAAA';
    expect(verifyCaptcha(challenge.captchaId, wrong, binding)).toBe(false);
    expect(verifyCaptcha(challenge.captchaId, answer, binding)).toBe(false);
  });

  it('accepts a valid challenge only once', () => {
    const binding = `valid-attempt-${Date.now()}-${Math.random()}`;
    const challenge = issueCaptcha(binding);
    const answer = expectedAnswer(challenge.captchaId, binding);
    expect(verifyCaptcha(challenge.captchaId, answer, binding)).toBe(true);
    expect(verifyCaptcha(challenge.captchaId, answer, binding)).toBe(false);
  });

  it('limits challenge issuance per binding without a Redis dependency', () => {
    const binding = `issuance-test-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i += 1) expect(consumeCaptchaIssuanceSlot(binding)).toBe(true);
    expect(consumeCaptchaIssuanceSlot(binding)).toBe(false);
  });
});
