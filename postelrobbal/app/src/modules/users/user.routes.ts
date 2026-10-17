import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { users, sessions, media } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { verifyPassword, hashPassword, passwordPolicyOk } from '../../security/passwords.js';
import { createSession, setSessionCookie, clearSessionCookie, revokeAllUserSessions } from '../../security/sessions.js';
import { issueCsrfToken } from '../../security/csrf.js';
import { audit } from '../../core/audit.js';
import { parseWith } from '../../core/validation.js';
import { deleteMedia, openMediaStream, uploadAvatarMedia } from '../media/media.service.js';
import { AVATAR_CHARACTERS, type AvatarState } from './avatars.js';
import { enqueueUserEmailNotice } from '../notifications/email-notifications.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const ulidish = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

function mustUlidParam(req: FastifyRequest, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !ulidish.test(value)) {
    throw new AppError(ERR.VALIDATION('شناسه معتبر نیست.'));
  }
  return value;
}

const settingsSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  businessName: z.string().min(1).max(160),
  businessType: z.string().min(1).max(80),
  timezone: z.string().min(1).max(64),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const avatarCharacterSchema = z.object({ value: z.enum(AVATAR_CHARACTERS) });

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

/** Deletes the photo media behind a user's avatar if it still exists (no orphans). */
async function removeAvatarPhoto(userId: string, mediaId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.tenantId, userId)))
    .limit(1);
  if (!row) return; // already gone (e.g. deleted via /media/:id) — nothing to clean
  await deleteMedia(userId, mediaId); // unlinks file + media_access_tokens + row
}

async function currentUserAvatarState(userId: string): Promise<AvatarState> {
  const db = getDb();
  const [u] = await db
    .select({ avatarKind: users.avatarKind, avatarValue: users.avatarValue, avatarMediaId: users.avatarMediaId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new AppError(ERR.AUTH_REQUIRED());
  return { avatarKind: u.avatarKind, avatarValue: u.avatarValue, avatarMediaId: u.avatarMediaId };
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users/me/settings', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const db = getDb();
    const [u] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        mobile: users.mobile,
        referralCode: users.referralCode,
        businessName: users.businessName,
        businessType: users.businessType,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());
    return { success: true, data: u };
  });

  app.put('/users/me/settings', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(settingsSchema, req.body);
    const db = getDb();
    await db
      .update(users)
      .set({
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        businessName: input.businessName.trim(),
        businessType: input.businessType.trim(),
        timezone: input.timezone.trim(),
      })
      .where(eq(users.id, me.id));
    await audit({ action: 'user.settings_updated', actorId: me.id, subjectType: 'user', subjectId: me.id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  // ---- avatar (round 17) -------------------------------------------------

  // Upload a profile photo: multipart 'file' part, allowed image formats only,
  // max 5MB — re-encoded server-side to a deterministic 512×512 WebP square.
  // Replaces (and cleans up) any previous photo avatar.
  app.post('/users/me/avatar', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const file = await req.file();
    if (!file) throw new AppError(ERR.VALIDATION('فایلی ارسال نشده است.'));
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new AppError(ERR.VALIDATION('حجم فایل بیش از حد مجاز است.'));
    }
    const db = getDb();
    const [u] = await db
      .select({ id: users.id, avatarKind: users.avatarKind, avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());
    // Insert new media, then clean up the previous photo, then point the user
    // at the new one (avatar_value stays as the character fallback).
    const uploaded = await uploadAvatarMedia(me.id, { buffer, mimeType: file.mimetype });
    if (u.avatarKind === 'photo' && u.avatarMediaId) await removeAvatarPhoto(me.id, u.avatarMediaId);
    await db.update(users).set({ avatarKind: 'photo', avatarMediaId: uploaded.id }).where(eq(users.id, me.id));
    await audit({ action: 'user.avatar_updated', actorId: me.id, subjectType: 'user', subjectId: me.id, ip: req.ip, meta: { kind: 'photo' } });
    return { success: true, data: { avatarKind: 'photo', avatarValue: '', avatarMediaId: uploaded.id } };
  });

  // Remove the profile photo and fall back to the standard character avatar.
  // Idempotent: with a character avatar it just returns the current state.
  app.delete('/users/me/avatar', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const current = await currentUserAvatarState(me.id);
    if (current.avatarKind === 'photo' && current.avatarMediaId) {
      await removeAvatarPhoto(me.id, current.avatarMediaId);
      const db = getDb();
      await db.update(users).set({ avatarKind: 'character', avatarMediaId: null }).where(eq(users.id, me.id));
      await audit({ action: 'user.avatar_removed', actorId: me.id, subjectType: 'user', subjectId: me.id, ip: req.ip });
      return { success: true, data: { avatarKind: 'character', avatarValue: current.avatarValue, avatarMediaId: null } };
    }
    return { success: true, data: current };
  });

  // Pick one of the 12 standard character avatars (frontend-rendered SVG).
  // Switching away from a photo deletes that media so no orphans remain.
  app.put('/users/me/avatar/character', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(avatarCharacterSchema, req.body);
    const db = getDb();
    const [u] = await db
      .select({ id: users.id, avatarKind: users.avatarKind, avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());
    if (u.avatarKind === 'photo' && u.avatarMediaId) await removeAvatarPhoto(me.id, u.avatarMediaId);
    await db
      .update(users)
      .set({ avatarKind: 'character', avatarValue: input.value, avatarMediaId: null })
      .where(eq(users.id, me.id));
    await audit({
      action: 'user.avatar_updated',
      actorId: me.id,
      subjectType: 'user',
      subjectId: me.id,
      ip: req.ip,
      meta: { kind: 'character', value: input.value },
    });
    return { success: true, data: { avatarKind: 'character', avatarValue: input.value, avatarMediaId: null } };
  });

  // Serves a user's profile photo (512×512 WebP). Profile photos are social:
  // any authenticated user may view any user's avatar; character avatars are
  // frontend-rendered, so only 'photo' kind has bytes here (404 otherwise).
  app.get('/users/:id/avatar', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const id = mustUlidParam(req, 'id');
    const db = getDb();
    const [u] = await db
      .select({ avatarKind: users.avatarKind, avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!u || u.avatarKind !== 'photo' || !u.avatarMediaId) throw new AppError(ERR.NOT_FOUND('تصویر'));
    const [row] = await db.select().from(media).where(eq(media.id, u.avatarMediaId)).limit(1);
    if (!row) throw new AppError(ERR.NOT_FOUND('تصویر'));
    void reply.header('content-type', 'image/webp');
    void reply.header('content-length', Number(row.sizeBytes));
    void reply.header('cache-control', 'private, max-age=300');
    return reply.send(openMediaStream(row));
  });

  // ------------------------------------------------------------------------

  app.post('/users/me/change-password', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const me = auth(req);
    const input = parse(changePasswordSchema, req.body);
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());

    const ok = await verifyPassword(u.passwordHash, input.currentPassword);
    if (!ok) throw new AppError(ERR.VALIDATION('رمز عبور فعلی نادرست است.'));
    if (!passwordPolicyOk(input.newPassword)) throw new AppError(ERR.WEAK_PASSWORD());
    if (input.newPassword === input.currentPassword) {
      throw new AppError(ERR.VALIDATION('رمز جدید باید با رمز فعلی متفاوت باشد.'));
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, u.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, u.id));
    });
    await audit({ action: 'user.password_changed', actorId: u.id, subjectType: 'user', subjectId: u.id, ip: req.ip });
    await enqueueUserEmailNotice(u.id, {
      subject: 'رمز عبور پُست‌یار تغییر کرد',
      preheader: 'رمز عبور حساب شما با موفقیت تغییر کرده است.',
      title: 'تغییر رمز عبور ثبت شد',
      paragraphs: ['رمز عبور حساب پُست‌یار شما تغییر کرده است. اگر این اقدام را شما انجام نداده‌اید، از پنل خارج شوید و فوراً با پشتیبانی تماس بگیرید.'],
      buttonLabel: 'ورود به پنل پُست‌یار',
      buttonPath: '/login',
    }, 'password-changed:' + u.id + ':' + Date.now());
    // Re-issue a fresh session + CSRF secret for the current device
    const session = await createSession(u.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, session.token);
    return { success: true, data: { ok: true, csrfToken: issueCsrfToken(session.csrfSecret) } };
  });

}
