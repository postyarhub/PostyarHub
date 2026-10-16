import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getRedis } from '../queue/connection.js';

/**
 * Internal graphical anti-bot captcha.
 *
 * CAPTCHA state is shared through Redis so replay and issuance limits apply
 * across all API processes. The challenge answer is derived from an
 * opaque server-generated ID + server secret + request binding. The rendered
 * glyphs are vector blocks (not SVG <text>), so the answer is not present as
 * selectable text in the DOM.
 *
 * Contract remains compatible with the frontend/backend auth flow:
 *   GET  /api/v1/auth/captcha -> { captchaId, svg }
 *   POST auth routes -> captchaId + captchaText
 */

const CAPTCHA_TTL_SECONDS = 300;
const CAPTCHA_LENGTH = 5;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BLOCK = 3;

// The source of truth for rate limits and one-use challenges is shared Redis,
// not per-process memory: a load-balanced deployment must not accept the same
// challenge once per Passenger process.
const CAPTCHA_REPLAY_PREFIX = 'postyar:captcha:used:';
const CAPTCHA_ISSUANCE_PREFIX = 'postyar:captcha:issue:';
const CAPTCHA_ISSUANCE_WINDOW_SECONDS = 60;
const CAPTCHA_ISSUANCE_MAX_PER_IP = 30;

export async function consumeCaptchaIssuanceSlot(binding = ''): Promise<boolean> {
  const digest = createHash('sha256').update(String(binding || 'unknown')).digest('hex');
  const script = [
    'local count = redis.call("INCR", KEYS[1])',
    'if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end',
    'return count',
  ].join('\n');
  try {
    const count = Number(await getRedis().eval(
      script,
      1,
      `${CAPTCHA_ISSUANCE_PREFIX}${digest}`,
      String(CAPTCHA_ISSUANCE_WINDOW_SECONDS),
    ));
    // CAPTCHA issuance is fail-closed if Redis is unavailable or returns an
    // unexpected value. This endpoint is not allowed to become an abuse bypass.
    return Number.isSafeInteger(count) && count >= 1 && count <= CAPTCHA_ISSUANCE_MAX_PER_IP;
  } catch {
    return false;
  }
}

// Compact 5x7 bitmap font for the exact captcha alphabet.
const GLYPHS: Record<string, string[]> = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  J: ['00111','00010','00010','00010','00010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
};

function secret(): Buffer {
  // Prefer a purpose-separated CAPTCHA_SECRET when configured. The fallback
  // remains compatible with existing hosts until their private environment is
  // explicitly updated; never require a new secret merely to boot production.
  const dedicated = String(process.env.CAPTCHA_SECRET ?? '').trim();
  const fallback = String(process.env.CSRF_SECRET ?? process.env.ENCRYPTION_KEY ?? '').trim();
  const value = dedicated || fallback;
  if (value.length < 32) throw new Error('CAPTCHA secret is not configured.');
  return createHash('sha256').update(value).digest();
}

function bindingDigest(binding: string): string {
  return createHash('sha256').update(String(binding || '')).digest('hex');
}

function deriveAnswer(captchaId: string, binding: string): string {
  const digest = createHmac('sha256', secret())
    .update(`postyar-captcha:v3:${captchaId}:${bindingDigest(binding)}`)
    .digest();
  let answer = '';
  for (let i = 0; i < CAPTCHA_LENGTH; i += 1) {
    const byte = digest[i] ?? 0;
    answer += ALPHABET[byte % ALPHABET.length] ?? 'A';
  }
  return answer;
}

function captchaColor(seed: number): string {
  const palette = ['#312e81', '#4338ca', '#1e3a8a', '#3730a3', '#4c1d95'];
  return palette[seed % palette.length] ?? palette[0] ?? '#312e81';
}

function glyphSvg(char: string, x: number, y: number, rotate: number, color: string): string {
  const glyph = GLYPHS[char] ?? GLYPHS.A ?? [];
  const blocks: string[] = [];
  for (let row = 0; row < glyph.length; row += 1) {
    const glyphRow = glyph[row] ?? '';
    for (let col = 0; col < glyphRow.length; col += 1) {
      if (glyphRow[col] === '1') {
        blocks.push(`<rect x="${x + col * BLOCK}" y="${y + row * BLOCK}" width="${BLOCK}" height="${BLOCK}" rx=".7"/>`);
      }
    }
  }
  return `<g fill="${color}" transform="rotate(${rotate} ${x + 7.5} ${y + 10.5})">${blocks.join('')}</g>`;
}

function createCaptchaSvg(answer: string, entropy: string): string {
  const digest = createHash('sha256').update(entropy).digest();
  const lines = Array.from({ length: 4 }, (_, i) => {
    const x1 = 6 + ((digest[i] ?? 0) % 36);
    const y1 = 6 + ((digest[i + 4] ?? 0) % 48);
    const x2 = 118 + ((digest[i + 8] ?? 0) % 46);
    const y2 = 6 + ((digest[i + 12] ?? 0) % 48);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(79,70,229,.24)" stroke-width="1.2"/>`;
  }).join('');

  const dots = Array.from({ length: 22 }, (_, i) => {
    const x = 4 + ((digest[(i * 3) % digest.length] ?? 0) % 162);
    const y = 4 + ((digest[(i * 3 + 1) % digest.length] ?? 0) % 52);
    const r = 0.45 + ((digest[(i * 3 + 2) % digest.length] ?? 0) % 8) / 16;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(30,41,59,.18)"/>`;
  }).join('');

  const chars = [...answer].map((char, i) => {
    const x = 10 + i * 32;
    const y = 19 + (((digest[(i + 20) % digest.length] ?? 0) % 5) - 2);
    const rotate = ((digest[(i + 25) % digest.length] ?? 0) % 17) - 8;
    return glyphSvg(char, x, y, rotate, captchaColor(digest[(i + 29) % digest.length] ?? 0));
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 60" role="img" aria-label="کد امنیتی"><rect width="170" height="60" rx="10" fill="#eef2ff"/>${lines}${dots}${chars}</svg>`;
}

function encodeId(timestampSeconds: number): string {
  const id = Buffer.alloc(16);
  id.writeUInt32BE(timestampSeconds >>> 0, 0);
  randomBytes(12).copy(id, 4);
  return id.toString('hex');
}

function decodeTimestamp(captchaId: string): number | null {
  if (!/^[0-9a-f]{32}$/i.test(captchaId)) return null;
  try {
    return Buffer.from(captchaId, 'hex').readUInt32BE(0);
  } catch {
    return null;
  }
}

export function issueCaptcha(binding = ''): { captchaId: string; svg: string } {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const captchaId = encodeId(nowSeconds);
  const answer = deriveAnswer(captchaId, binding);
  const svg = createCaptchaSvg(answer, `${captchaId}:${bindingDigest(binding)}`);
  return { captchaId, svg };
}

export async function verifyCaptcha(captchaId: string, text: string, binding = ''): Promise<boolean> {
  const timestamp = decodeTimestamp(captchaId);
  if (timestamp === null) return false;

  const now = Math.floor(Date.now() / 1000);
  if (timestamp > now + 30 || now - timestamp > CAPTCHA_TTL_SECONDS) return false;

  // Atomic SET NX makes a challenge globally one-shot across all API processes.
  // Consume before answer comparison so a failed guess cannot be retried.
  try {
    const redisKey = `${CAPTCHA_REPLAY_PREFIX}${captchaId}`;
    const result = await getRedis().set(redisKey, '1', 'EX', CAPTCHA_TTL_SECONDS, 'NX');
    if (result !== 'OK') return false;
  } catch {
    return false; // never accept a CAPTCHA when its replay store is unavailable
  }
  const normalized = String(text ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(normalized)) return false;
  const expected = deriveAnswer(captchaId, binding);
  return normalized === expected;
}

/** Redis owns replay state; no local challenge store needs closing. */
export async function closeCaptchaStore(): Promise<void> {
  // Intentionally no-op; the shared Redis keys expire automatically.
}
