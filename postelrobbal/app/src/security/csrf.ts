import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';

/**
 * CSRF double-submit token bound to the session CSRF secret (§59 session contract).
 * Token = base64url(nonce).hmac(nonce+sessionSecret)
 */
export function issueCsrfToken(csrfSecret: string): string {
  const nonce = randomUUID().replace(/-/g, '');
  const sig = createHmac('sha256', loadEnv().CSRF_SECRET).update(`${nonce}.${csrfSecret}`).digest('base64url');
  return `${nonce}.${sig}`;
}

export function verifyCsrfToken(token: string | undefined, csrfSecret: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [nonce, sig] = token.split('.');
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', loadEnv().CSRF_SECRET).update(`${nonce}.${csrfSecret}`).digest('base64url');
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
