import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { media, mediaAccessTokens, ticketMessageAttachments, ticketMessages, tickets, users } from '../../db/schema.js';
import { newId, newToken, sha256Hex } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { loadEnv } from '../../config/env.js';
import { roleHasPermission } from '../../security/permissions.js';
import { getPlanContext } from '../subscriptions/plan.service.js';

/**
 * Media storage (§60 path-traversal safe): filenames are server-generated
 * ULIDs inside a tenant subfolder; the storage root is private (never served
 * statically). Access only through short-lived hash-validated tokens.
 */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

/** Image allowlist (round 17): every accepted image input is re-encoded to WebP. */
const IMAGE_MIMES = new Set(Object.keys(MIME_EXT).filter((m) => m.startsWith('image/')));

export function isAllowedImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime.toLowerCase());
}

export function storageRoot(): string {
  const raw = process.env.STORAGE_DIR;
  // §55 layout: app and api both sit directly under the private postelrobbal/
  // root, so the sibling private/storage is the default private media root
  // regardless of which entry (Passenger api/ or worker chdir app/) runs.
  return raw && raw.trim() !== ''
    ? path.resolve(raw.trim())
    : path.resolve(__dirname, '../../../..', 'private', 'storage');
}

/** Magic-byte sniffing — declared MIME must match actual content. */
export function magicMatches(mime: string, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const hexAt = (offset: number, length: number): string =>
    buf.subarray(offset, offset + length).toString('hex');
  switch (mime) {
    case 'image/jpeg':
      return hexAt(0, 3) === 'ffd8ff';
    case 'image/png':
      return hexAt(0, 4) === '89504e47';
    case 'image/gif':
      return hexAt(0, 3) === '474946';
    case 'image/webp':
      return hexAt(0, 4) === '52494646' && hexAt(8, 4) === '57454250'; // RIFF....WEBP
    case 'image/avif': {
      // ISO-BMFF: 'ftyp' box at offset 4, major brand at 8-12 (avif still image,
      // avis AVIF sequence — both decode through libheif/AV1).
      const brand = buf.toString('latin1', 8, 12);
      return buf.toString('latin1', 4, 8) === 'ftyp' && (brand === 'avif' || brand === 'avis');
    }
    case 'image/tiff':
      return hexAt(0, 4) === '49492a00' || hexAt(0, 4) === '4d4d002a'; // II*\0 | MM\0*
    case 'image/bmp':
      return hexAt(0, 2) === '424d'; // 'BM'
    case 'image/heic':
    case 'image/heif': {
      // HEIF family: 'ftyp' at offset 4 + compatible brand at 8-12.
      const brand = buf.toString('latin1', 8, 12);
      return (
        buf.toString('latin1', 4, 8) === 'ftyp' &&
        ['heic', 'heix', 'heim', 'mif1', 'msf1'].includes(brand)
      );
    }
    case 'video/mp4':
      return buf.toString('latin1', 4, 8) === 'ftyp'; // box type at offset 4
    case 'application/pdf':
      return buf.toString('latin1', 0, 5) === '%PDF-'; // version header
    default:
      return false;
  }
}

export interface MediaPublic {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksum: string;
  createdAt: Date;
}

type MediaRow = typeof media.$inferSelect;

function toPublic(row: MediaRow): MediaPublic {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    createdAt: row.createdAt,
  };
}

/** ULID chars only — the tenant folder is never user-controlled. */
function safeTenantDir(tenantId: string): string {
  if (!/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(tenantId)) {
    throw new AppError(ERR.INTERNAL());
  }
  return tenantId;
}

function safeAbsolutePath(storagePath: string): string {
  const root = storageRoot();
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep)) throw new AppError(ERR.NOT_FOUND('فایل'));
  return abs;
}

/**
 * Round 17 — WebP-only image processing.
 * - 'media' variant: EXIF auto-orient, fit inside 1920×1920 (no upscaling),
 *   animated GIF/animated WebP keep their animation (multi-page re-encode).
 * - 'avatar' variant: deterministic 512×512 centre-crop square, first frame.
 * Only the encoded WebP buffer is returned — original bytes are never written.
 */
export const IMAGE_PROCESS_FAILED = 'پردازش تصویر ناموفق بود. فایل تصویر سالم نیست یا فرمت آن پشتیبانی نمی‌شود.';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  animated: boolean;
}

const MAX_IMAGE_INPUT_PIXELS = 40_000_000;
const MAX_IMAGE_FRAMES = 120;
const MAX_IMAGE_TOTAL_PIXELS = 120_000_000;

export async function processImageToWebp(buf: Buffer, variant: 'media' | 'avatar'): Promise<ProcessedImage> {
  try {
    // Bound decoder work as well as upload bytes; small compressed files can
    // still expand into huge rasters or contain pathological animation frames.
    const meta = await sharp(buf, { animated: true, limitInputPixels: MAX_IMAGE_INPUT_PIXELS }).metadata();
    const width = Number(meta.width ?? 0);
    const height = Number(meta.height ?? 0);
    const pages = Math.max(1, Number(meta.pages ?? 1));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        !Number.isSafeInteger(pages) || pages > MAX_IMAGE_FRAMES ||
        width * height > MAX_IMAGE_INPUT_PIXELS || width * height * pages > MAX_IMAGE_TOTAL_PIXELS) {
      throw new Error('IMAGE_RESOURCE_LIMIT');
    }
    if (variant === 'avatar') {
      const { data, info } = await sharp(buf)
        .rotate() // EXIF auto-orient
        .resize({ width: 512, height: 512, fit: 'cover', position: 'centre' })
        .webp({ quality: 85, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height, animated: false };
    }
    if ((meta.pages ?? 1) > 1) {
      // Animated input (animated GIF / animated WebP): the multi-page Sharp
      // instance makes the WebP output animated automatically (sharp ≥0.33 —
      // .webp() no longer takes an `animated` key); q78/effort 3 per round-17 spec.
      const { data, info } = await sharp(buf, { animated: true })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 3 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height, animated: true };
    }
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, animated: false };
  } catch {
    // Corrupt or unsupported image: nothing has been written to disk or DB yet.
    throw new AppError(ERR.VALIDATION(IMAGE_PROCESS_FAILED));
  }
}

export async function uploadMedia(
  tenantId: string,
  input: { buffer: Buffer; mimeType: string; maxBytes?: number }
): Promise<MediaPublic> {
  // Default cap stays at the historical 8MB for the generic media library;
  // callers may pass a tighter (receipts: 5MB) or looser (ticket attachments:
  // 10MB, matching the multipart stream cap) limit explicitly.
  const maxBytes = input.maxBytes ?? MAX_MEDIA_BYTES;
  const mbFa = String(Math.max(1, Math.round(maxBytes / (1024 * 1024)))).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
  if (input.buffer.length === 0) throw new AppError(ERR.VALIDATION('فایل ارسالی خالی است.'));
  if (input.buffer.length > maxBytes) {
    throw new AppError(ERR.VALIDATION(`حجم فایل باید حداکثر ${mbFa} مگابایت باشد.`));
  }
  const mime = input.mimeType.toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) {
    throw new AppError(ERR.VALIDATION('نوع فایل مجاز نیست. فرمت‌های مجاز: JPG، PNG، WebP، GIF، AVIF، TIFF، BMP، HEIC، MP4 و PDF.'));
  }
  if (!magicMatches(mime, input.buffer)) {
    throw new AppError(ERR.VALIDATION('محتوای فایل با نوع اعلام‌شده هم‌خوانی ندارد.'));
  }

  // §60/round17: WebP-only pipeline — originals are never persisted.
  let stored: Buffer = input.buffer;
  let storedMime = mime;
  let storedExt = ext;
  let width: number | null = null;
  let height: number | null = null;
  if (mime.startsWith('image/')) {
    const processed = await processImageToWebp(input.buffer, 'media');
    stored = processed.buffer;
    storedMime = 'image/webp';
    storedExt = 'webp';
    width = processed.width;
    height = processed.height;
  }

  const tenantDir = safeTenantDir(tenantId);
  const filename = `${newId()}.${storedExt}`;
  const storagePath = `${tenantDir}/${filename}`;
  const root = storageRoot();
  const absolutePath = path.join(root, storagePath);
  const id = newId();
  const db = getDb();
  let fileWritten = false;
  try {
    await db.transaction(async (tx) => {
      // Serialise concurrent uploads on the tenant row so parallel requests
      // cannot both consume the same remaining storage allowance.
      const [tenant] = await tx.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1).for('update');
      if (!tenant) throw new AppError(ERR.NOT_FOUND('حساب کاربری'));
      const plan = await getPlanContext(tenantId);
      const [usage] = await tx.select({
        bytes: sql<string | number | null>`COALESCE(SUM(${media.sizeBytes}), 0)`,
      }).from(media).where(eq(media.tenantId, tenantId));
      const usedBytes = Number(usage?.bytes ?? 0);
      const limitMb = Number(plan.limits.storage_mb);
      const limitBytes = Math.floor(limitMb * 1024 * 1024);
      if (!Number.isFinite(limitMb) || limitMb <= 0 || usedBytes + stored.length > limitBytes) {
        throw new AppError(ERR.QUOTA_EXCEEDED('فضای ذخیره‌سازی'));
      }

      await fs.mkdir(path.join(root, tenantDir), { recursive: true });
      await fs.writeFile(absolutePath, stored, { mode: 0o600 });
      fileWritten = true;
      await tx.insert(media).values({
        id,
        tenantId,
        filename,
        mime: storedMime,
        sizeBytes: stored.length,
        width,
        height,
        checksum: createHash('sha256').update(stored).digest('hex'),
        storagePath,
      });
    });
  } catch (err) {
    if (fileWritten) {
      await fs.unlink(absolutePath).catch((cleanupErr: unknown) => {
        if (!(cleanupErr && typeof cleanupErr === 'object' && 'code' in cleanupErr && (cleanupErr as { code?: unknown }).code === 'ENOENT')) throw cleanupErr;
      });
    }
    throw err;
  }
  await audit({ action: 'media.upload', actorId: tenantId, subjectType: 'media', subjectId: id });
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());
  return toPublic(row);
}

/** 5MB input cap for profile photos. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Round 17: avatar photo ingest — validates an allowed image/* input, encodes
 * a deterministic 512×512 WebP square and stores it as an owned media row
 * (tenantId = the user id). Only the WebP output touches the disk.
 */
export async function uploadAvatarMedia(userId: string, input: { buffer: Buffer; mimeType: string }): Promise<MediaPublic> {
  const mime = input.mimeType.toLowerCase();
  if (!isAllowedImageMime(mime)) {
    throw new AppError(ERR.VALIDATION('نوع فایل مجاز نیست. فرمت‌های مجاز: JPG، PNG، WebP، GIF، AVIF، TIFF، BMP و HEIC.'));
  }
  if (input.buffer.length === 0) throw new AppError(ERR.VALIDATION('فایل ارسالی خالی است.'));
  if (input.buffer.length > AVATAR_MAX_BYTES) {
    throw new AppError(ERR.VALIDATION('حجم تصویر باید حداکثر ۵ مگابایت باشد.'));
  }
  if (!magicMatches(mime, input.buffer)) {
    throw new AppError(ERR.VALIDATION('محتوای فایل با نوع اعلام‌شده هم‌خوانی ندارد.'));
  }
  const processed = await processImageToWebp(input.buffer, 'avatar');
  const tenantDir = safeTenantDir(userId);
  const filename = `${newId()}.webp`;
  const storagePath = `${tenantDir}/${filename}`;
  const root = storageRoot();
  await fs.mkdir(path.join(root, tenantDir), { recursive: true });
  await fs.writeFile(path.join(root, storagePath), processed.buffer, { mode: 0o600 });
  const db = getDb();
  const id = newId();
  try {
    await db.insert(media).values({
    id,
    tenantId: userId,
    filename,
    mime: 'image/webp',
    sizeBytes: processed.buffer.length,
    width: processed.width,
    height: processed.height,
    checksum: createHash('sha256').update(processed.buffer).digest('hex'),
    storagePath,
    });
  } catch (err) {
    await fs.unlink(path.join(root, storagePath)).catch((cleanupErr: unknown) => {
      if (!(cleanupErr && typeof cleanupErr === 'object' && 'code' in cleanupErr && (cleanupErr as { code?: unknown }).code === 'ENOENT')) throw cleanupErr;
    });
    throw err;
  }
  await audit({ action: 'media.upload', actorId: userId, subjectType: 'media', subjectId: id, meta: { purpose: 'avatar' } });
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());
  return toPublic(row);
}

export async function listMedia(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: MediaPublic[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.tenantId, tenantId))
    .orderBy(desc(media.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(media)
    .where(eq(media.tenantId, tenantId));
  return { items: rows.map(toPublic), total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function getOwnedMedia(tenantId: string, mediaId: string): Promise<MediaRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('فایل'));
  return row;
}

/**
 * Authorized media access (contract 14-contract item 7). A viewer may read a
 * media row when:
 *  1. it is their own upload (tenant match — receipts, ticket attachments),
 *  2. they hold the support permission (staff reviewing receipts/attachments),
 *  3. it is attached to a ticket message inside one of THEIR tickets (lets a
 *     user open an attachment posted by support on their own ticket).
 * Everything else is a 404 — no existence leak (§180).
 */
export async function getMediaForViewer(
  viewer: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' },
  mediaId: string
): Promise<MediaRow> {
  const db = getDb();
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('فایل'));
  if (row.tenantId === viewer.id) return row;

  // Support staff may access media only when the media is attached to a ticket,
  // not arbitrary private uploads that happen to belong to another tenant.
  const isSupport = roleHasPermission(viewer.role, 'support.tickets.any');
  const [shared] = await db
    .select({ id: ticketMessageAttachments.id })
    .from(ticketMessageAttachments)
    .innerJoin(ticketMessages, eq(ticketMessages.id, ticketMessageAttachments.messageId))
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .where(and(
      eq(ticketMessageAttachments.mediaId, mediaId),
      ...(isSupport ? [] : [eq(tickets.tenantId, viewer.id)]),
    ))
    .limit(1);
  if (shared) return row;
  throw new AppError(ERR.NOT_FOUND('فایل'));
}

export async function deleteMedia(tenantId: string, mediaId: string): Promise<void> {
  const row = await getOwnedMedia(tenantId, mediaId);
  await fs.unlink(safeAbsolutePath(row.storagePath)).catch((err: unknown) => {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT') return;
    throw err;
  });
  const db = getDb();
  await db.delete(mediaAccessTokens).where(eq(mediaAccessTokens.mediaId, mediaId));
  await db.delete(media).where(eq(media.id, mediaId));
  await audit({ action: 'media.delete', actorId: tenantId, subjectType: 'media', subjectId: mediaId });
}

/** 15-minute hash-validated access token for provider delivery (§187). */
export async function createMediaAccessToken(
  tenantId: string,
  mediaId: string
): Promise<{ url: string; expiresAt: Date }> {
  const row = await getOwnedMedia(tenantId, mediaId);
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const db = getDb();
  await db.insert(mediaAccessTokens).values({
    id: newId(),
    mediaId: row.id,
    tokenHash: await sha256Hex(token),
    expiresAt,
  });
  const url = `${loadEnv().API_URL}/api/v1/media/raw/${row.id}?token=${token}`;
  return { url, expiresAt };
}

/** Token lookup for the PUBLIC raw route: hash match + not expired. */
export async function resolveMediaByToken(mediaId: string, token: unknown): Promise<MediaRow | null> {
  if (typeof token !== 'string' || token.length < 8) return null;
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const [access] = await db
    .select({ id: mediaAccessTokens.id })
    .from(mediaAccessTokens)
    .where(
      and(
        eq(mediaAccessTokens.mediaId, mediaId),
        eq(mediaAccessTokens.tokenHash, tokenHash),
        gt(mediaAccessTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!access) return null;
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return row ?? null;
}

export function openMediaStream(row: MediaRow): ReturnType<typeof createReadStream> {
  return createReadStream(safeAbsolutePath(row.storagePath));
}

/** Read private media bytes for provider delivery transformations. */
export async function readMediaBuffer(row: MediaRow): Promise<Buffer> {
  return fs.readFile(safeAbsolutePath(row.storagePath));
}

/**
 * Provider photo representation. Storage remains WebP-only; this is an
 * on-the-fly JPEG representation for URL-based provider photo delivery.
 */
export async function readProviderPhotoJpeg(row: MediaRow): Promise<Buffer> {
  if (!row.mime.startsWith('image/')) throw new AppError(ERR.VALIDATION('رسانهٔ تصویر نیست.'));
  const bytes = await readMediaBuffer(row);
  return sharp(bytes).rotate().jpeg({ quality: 88, progressive: true }).toBuffer();
}
