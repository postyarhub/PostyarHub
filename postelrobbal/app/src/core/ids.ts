import { ulid } from 'ulid';
import { timingSafeEqual } from 'node:crypto';

/** Opaque, sortable public identifiers (§172: minimize internal id exposure). */
export const newId = (): string => ulid();
export const newToken = (bytes = 32): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
