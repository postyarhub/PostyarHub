import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => ({
  values: new Map<string, { value: string; expiresAt: number }>(),
  counts: new Map<string, number>(),
}));

vi.mock('../queue/connection.js', () => ({
  getRedis: () => ({
    eval: async (_script: string, _keyCount: number, key: string, ttl: string) => {
      const next = (redisState.counts.get(key) ?? 0) + 1;
      redisState.counts.set(key, next);
      return next;
    },
    set: async (key: string, value: string, _expiryMode: string, ttl: number, nx: string) => {
      const current = redisState.values.get(key);
      if (current && current.expiresAt > Date.now()) return null;
      redisState.values.set(key, { value, expiresAt: Date.now() + Number(ttl) * 1000 });
      return 'OK';
    },
  }),
}));

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
  redisState.values.clear();
  redisState.counts.clear();
});

describe('CAPTCHA anti-automation controls', () => {
  it('consumes a challenge on the first failed verification attempt', async () => {
    const binding = `failed-attempt-${Date.now()}-${Math.random()}`;
    const challenge = issueCaptcha(binding);
    const answer = expectedAnswer(challenge.captchaId, binding);
    const wrong = answer === 'AAAAA' ? 'BBBBB' : 'AAAAA';
    expect(await verifyCaptcha(challenge.captchaId, wrong, binding)).toBe(false);
    expect(await verifyCaptcha(challenge.captchaId, answer, binding)).toBe(false);
  });

  it('accepts a valid challenge only once', async () => {
    const binding = `valid-attempt-${Date.now()}-${Math.random()}`;
    const challenge = issueCaptcha(binding);
    const answer = expectedAnswer(challenge.captchaId, binding);
    expect(await verifyCaptcha(challenge.captchaId, answer, binding)).toBe(true);
    expect(await verifyCaptcha(challenge.captchaId, answer, binding)).toBe(false);
  });

  it('limits challenge issuance by a shared binding bucket', async () => {
    const binding = `issuance-test-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i += 1) expect(await consumeCaptchaIssuanceSlot(binding)).toBe(true);
    expect(await consumeCaptchaIssuanceSlot(binding)).toBe(false);
  });
});
