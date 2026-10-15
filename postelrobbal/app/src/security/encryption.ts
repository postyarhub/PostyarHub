import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';

/**
 * AES-256-GCM at-rest encryption for provider credentials (§92).
 * Output: v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 */
function key(): Buffer {
  return Buffer.from(loadEnv().ENCRYPTION_KEY, 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB, tagB, dataB] = payload.split('.');
  if (version !== 'v1' || !ivB || !tagB || !dataB) throw new Error('ENCRYPTION_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
}

/** Masking for API responses: never return full credentials (§93). */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
