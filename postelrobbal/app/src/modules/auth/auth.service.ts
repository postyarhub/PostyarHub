import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb } from '../../db/client.js';
import { users, subscriptions, plans, referrals, passwordResetTokens, sessions } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { hashPassword, verifyPassword, passwordPolicyOk } from '../../security/passwords.js';
import { newId, newToken, sha256Hex } from '../../core/ids.js';
import { getRedis } from '../../queue/connection.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';

export interface RegisterInput {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  businessName: string;
  businessType: string;
  password: string;
  passwordRepeat: string;
  acceptTerms: boolean;
  referralCode?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOBILE_RE = /^09\d{9}$/;

function normalizeMobile(m: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const latin = m
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[-\s()+]/g, '');
  if (latin.startsWith('+98')) return `0${latin.slice(3)}`;
  if (latin.startsWith('98') && latin.length === 12) return `0${latin.slice(2)}`;
  return latin;
}

/** Deterministic per-user referral code (§36). */
export function referralCodeFor(userId: string): string {
  const h = createHash('sha256').update(`postyar-ref:${userId}`).digest('base64url');
  return `R${h.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()}`;
}

export async function findReferrerByCode(code: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.referralCode, code.trim().toUpperCase()))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Registration (§41-42). First-user SUPER_ADMIN enforced transactionally
 * (ADR-0007): the decision is made inside the insert transaction by a count
 * guard; a unique single-row role_bootstrap table serializes concurrent
 * first-registrations at the DB level. Client-supplied roles are ignored.
 */
export async function registerUser(
  input: RegisterInput,
  meta: { ip?: string; userAgent?: string },
  bootstrapAuthorized = false,
) {
  if (!input.acceptTerms) throw new AppError(ERR.VALIDATION('پذیرش قوانین الزامی است.'));
  if (!passwordPolicyOk(input.password)) throw new AppError(ERR.WEAK_PASSWORD());
  if (input.password !== input.passwordRepeat) throw new AppError(ERR.VALIDATION('تکرار رمز عبور مطابقت ندارد.'));
  const email = input.email.trim().toLowerCase();
  const mobile = normalizeMobile(input.mobile);
  if (!EMAIL_RE.test(email)) throw new AppError(ERR.VALIDATION('ایمیل معتبر نیست.'));
  if (!MOBILE_RE.test(mobile)) throw new AppError(ERR.VALIDATION('شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).'));
  if (!input.firstName.trim() || !input.lastName.trim() || !input.businessName.trim()) {
    throw new AppError(ERR.VALIDATION('تکمیل نام، نام خانوادگی و نام کسب‌وکار الزامی است.'));
  }

  const db = getDb();
  const passwordHash = await hashPassword(input.password);
  const userId = newId();

  let referrerId: string | null = null;
  if (input.referralCode) {
    referrerId = await findReferrerByCode(input.referralCode);
    if (referrerId && referrerId === userId) referrerId = null;
  }

  try {
    await db.transaction(async (tx) => {
      let role: 'SUPER_ADMIN' | 'USER' = 'USER';
      if (bootstrapAuthorized) {
        // Existing end-user rows do not establish an administrator. Permit
        // recovery on a legacy database only when there is no SUPER_ADMIN;
        // the singleton claim below serializes concurrent bootstrap attempts.
        const existingAdmins = await tx.select({ id: users.id })
          .from(users).where(eq(users.role, 'SUPER_ADMIN')).limit(1).for('update');
        if (existingAdmins.length > 0) {
          throw new AppError(ERR.CONFLICT('مدیر ارشد از قبل وجود دارد؛ راه‌اندازی مدیر اولیه امکان‌پذیر نیست.'));
        }
        // The bootstrap route is protected by a separate high-entropy server
        // secret. The singleton insert is immutable: a second caller cannot
        // replace the owner or gain SUPER_ADMIN after setup is complete.
        await tx.execute(sql`
          INSERT INTO role_bootstrap (id, user_id) VALUES (1, ${userId})
          ON DUPLICATE KEY UPDATE id = id
        `);
        const claimRaw = await tx.execute(sql`
          SELECT user_id FROM role_bootstrap WHERE id = 1 FOR UPDATE
        `);
        let claimRows = (Array.isArray(claimRaw) ? claimRaw[0] : []) as Array<{ user_id: string }>;
        const claimedUserId = claimRows[0]?.user_id;
        if (claimedUserId !== userId) {
          // A stale singleton can remain after manual/legacy administrator
          // removal. Reclaim it only when the recorded owner is not an active
          // SUPER_ADMIN; the singleton row lock serializes competing requests.
          const [claimOwner] = claimedUserId
            ? await tx.select({ id: users.id, role: users.role })
              .from(users).where(eq(users.id, claimedUserId)).limit(1)
            : [];
          if (claimOwner?.role === 'SUPER_ADMIN') {
            throw new AppError(ERR.CONFLICT('مدیر ارشد از قبل وجود دارد؛ راه‌اندازی مدیر اولیه امکان‌پذیر نیست.'));
          }
          await tx.execute(sql`
            UPDATE role_bootstrap
            SET user_id = ${userId}, claimed_at = CURRENT_TIMESTAMP
            WHERE id = 1 AND user_id = ${claimedUserId ?? ''}
          `);
          const refreshedRaw = await tx.execute(sql`
            SELECT user_id FROM role_bootstrap WHERE id = 1 FOR UPDATE
          `);
          claimRows = (Array.isArray(refreshedRaw) ? refreshedRaw[0] : []) as Array<{ user_id: string }>;
          if (claimRows[0]?.user_id !== userId) {
            throw new AppError(ERR.CONFLICT('راه‌اندازی مدیر اولیه قبلاً انجام شده است.'));
          }
        }
        role = 'SUPER_ADMIN';
      } else {
        // Never let anonymous public registration claim administrator status.
        // On an uninitialized database ordinary registration stays closed until
        // the operator completes the explicit bootstrap flow.
        const claimRaw = await tx.execute(sql`
          SELECT user_id FROM role_bootstrap WHERE id = 1 FOR UPDATE
        `);
        const claimRows = (Array.isArray(claimRaw) ? claimRaw[0] : []) as Array<{ user_id: string }>;
        if (!claimRows[0]?.user_id) {
          throw new AppError(ERR.CONFLICT('راه‌اندازی امن مدیر اولیه هنوز انجام نشده است.'));
        }
      }

      await tx.insert(users).values({
        id: userId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        mobile,
        email,
        businessName: input.businessName.trim(),
        businessType: input.businessType.trim(),
        passwordHash,
        referralCode: referralCodeFor(userId),
        role,
      });

      const [freePlan] = await tx.select({ id: plans.id, periodDays: plans.periodDays }).from(plans).where(eq(plans.code, 'free')).limit(1);
      if (freePlan) {
        await tx.insert(subscriptions).values({
          id: newId(),
          tenantId: userId,
          planId: freePlan.id,
          state: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + freePlan.periodDays * 86400_000),
        });
      }

      if (referrerId) {
        await tx
          .insert(referrals)
          .values({
            id: newId(),
            referrerTenantId: referrerId,
            referredTenantId: userId,
            referralCode: input.referralCode ?? '',
            state: 'REGISTERED',
          })
          .onDuplicateKeyUpdate({ set: { referredTenantId: userId } });
      }
    });
  } catch (err) {
    const msg = String((err as Error).message ?? '');
    if (msg.includes('uq_users_email')) throw new AppError(ERR.VALIDATION('ثبت‌نام با این اطلاعات ممکن نیست.'));
    if (msg.includes('uq_users_mobile')) throw new AppError(ERR.VALIDATION('ثبت‌نام با این اطلاعات ممکن نیست.'));
    if (msg.includes('role_bootstrap')) throw new AppError(ERR.CONFLICT('ثبت‌نام همزمان انجام شد؛ لطفاً دوباره تلاش کنید.'));
    throw err;
  }

  await emitEvent({ name: 'user.registration', tenantId: userId });
  if (referrerId) await emitEvent({ name: 'referral.created', tenantId: referrerId, subjectType: 'referral', subjectId: userId });
  await audit({ action: 'auth.register', subjectType: 'user', subjectId: userId, ip: meta.ip });
  return { userId };
}

export async function authenticate(emailOrMobile: string, password: string) {
  const db = getDb();
  const rawIdent = emailOrMobile.trim().toLowerCase();
  const ident = rawIdent.includes('@') ? rawIdent : normalizeMobile(rawIdent);
  const [user] = await db
    .select()
    .from(users)
    .where(sql`${users.email} = ${ident} OR ${users.mobile} = ${ident}`)
    .limit(1);
  // Generic responses + constant-ish work to avoid enumeration (§180)
  if (!user) {
    await hashPassword('dummy-password-1234');
    throw new AppError(ERR.AUTH_INVALID());
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new AppError(ERR.AUTH_INVALID());
  if (user.status === 'SUSPENDED') throw new AppError(ERR.AUTH_SUSPENDED());
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await emitEvent({ name: 'user.login', tenantId: user.id });
  return user;
}

const PASSWORD_RESET_EMAIL_LIMIT = 3;
const PASSWORD_RESET_EMAIL_WINDOW_SECONDS = 60 * 60;
const PASSWORD_RESET_EMAIL_COUNTER_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  'return count',
].join('\n');

export async function requestPasswordReset(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = await sha256Hex(normalizedEmail);
  let requests: number;
  try {
    requests = Number(await getRedis().eval(
      PASSWORD_RESET_EMAIL_COUNTER_SCRIPT,
      1,
      `postyar:rate-limit:password-reset-email:${emailHash}`,
      String(PASSWORD_RESET_EMAIL_WINDOW_SECONDS),
    ));
  } catch {
    // Fail closed: a reset email must not be sent without its abuse-control store.
    throw new AppError(ERR.INTERNAL());
  }
  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (!user || !Number.isSafeInteger(requests) || requests < 1 || requests > PASSWORD_RESET_EMAIL_LIMIT) {
    return false;
  }

  const token = newToken(24);
  const passwordResetTokenId = newId();
  await db.insert(passwordResetTokens).values({
    id: passwordResetTokenId,
    userId: user.id,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // short-lived, one-time (§179)
  });
  const { enqueuePasswordResetDelivery } = await import('../notifications/delivery.js');
  await enqueuePasswordResetDelivery(user.id, passwordResetTokenId, token);
  return true;
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<boolean> {
  if (!passwordPolicyOk(newPassword)) throw new AppError(ERR.WEAK_PASSWORD());
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) return false;
  const passwordHash = await hashPassword(newPassword);
  const changed = await db.transaction(async (tx) => {
    const marked = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())));
    const affected = Array.isArray(marked) ? Number(marked[0]?.affectedRows ?? 0) : Number((marked as { affectedRows?: number }).affectedRows ?? 0);
    if (affected !== 1) return false;
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, row.userId));
    return true;
  });
  if (!changed) return false;
  await audit({ action: 'auth.password_reset', subjectType: 'user', subjectId: row.userId });
  return true;
}
