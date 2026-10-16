import { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import {
  registerUser, authenticate, requestPasswordReset, confirmPasswordReset,
} from './auth.service.js';
import { onUserRegistered } from '../referrals/register-hook.js';
import {
  createSession, setSessionCookie, clearSessionCookie, revokeSession, revokeAllUserSessions,
} from '../../security/sessions.js';
import { issueCsrfToken } from '../../security/csrf.js';
import { issueCaptcha, verifyCaptcha, consumeCaptchaIssuanceSlot } from '../../security/captcha.js';
import type { SessionUser } from '../../security/sessions.js';
import { audit } from '../../core/audit.js';
import { getDb } from '../../db/client.js';
import { getRedis } from '../../queue/connection.js';
import { users, subscriptions, plans } from '../../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { parseWith } from '../../core/validation.js';
import { getSecuritySettings } from '../admin/system-settings.service.js';

const captchaFields = {
  captchaId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  captchaText: z.string().min(3).max(10).optional(),
};

const registerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  mobile: z.string().min(10).max(20),
  email: z.string().email(),
  businessName: z.string().min(1).max(160),
  businessType: z.string().min(1).max(80),
  password: z.string().min(8).max(128),
  passwordRepeat: z.string().min(8).max(128),
  acceptTerms: z.boolean().refine((v) => v === true),
  referralCode: z.string().max(32).optional(),
  ...captchaFields,
});

const loginSchema = z.object({
  identifier: z.string().min(3).max(190),
  password: z.string().min(1).max(128),
  ...captchaFields,
});

const CAPTCHA_FAILED = 'کد امنیتی نادرست است یا منقضی شده؛ کد جدید را وارد کنید.';
const CAPTCHA_REQUIRED = 'کد امنیتی الزامی است.';
const REGISTRATION_DISABLED = 'ثبت‌نام موقتاً غیرفعال است. لطفاً بعداً تلاش کنید.';

const resetRequestSchema = z.object({ email: z.string().email(), ...captchaFields });
const resetConfirmSchema = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(128) });

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

// SEC-02: independent, shared Redis bucket prevents registration limits from
// being bypassed by rotating email/mobile identity values. The IP is hashed
// before it is used in a Redis key. Redis failure is fail-closed for registration.
const REGISTRATION_IP_LIMIT = 30;
const REGISTRATION_IP_WINDOW_SECONDS = 10 * 60;
const REGISTRATION_IP_COUNTER_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  'return count',
].join('\n');

async function enforceRegistrationIpLimit(req: FastifyRequest): Promise<void> {
  const ipHash = createHash('sha256').update(String(req.ip || 'unknown')).digest('hex');
  const key = `postyar:rate-limit:auth-register-ip:${ipHash}`;
  let count: number;
  try {
    count = Number(await getRedis().eval(REGISTRATION_IP_COUNTER_SCRIPT, 1, key, String(REGISTRATION_IP_WINDOW_SECONDS)));
  } catch {
    req.log.error({ requestId: req.id }, 'registration_ip_rate_limit_unavailable');
    throw new AppError(ERR.INTERNAL());
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    req.log.error({ requestId: req.id }, 'registration_ip_rate_limit_invalid_result');
    throw new AppError(ERR.INTERNAL());
  }
  if (count > REGISTRATION_IP_LIMIT) throw new AppError(ERR.RATE_LIMITED());
}

/** Narrow req.user for TS after requireAuth preHandler. */
function authUser(req: { user?: SessionUser }): SessionUser {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user;
}

function publicUser(u: {
  id: string; firstName: string; lastName: string; email: string; businessName: string; role: string; timezone?: string | null;
  avatarKind?: string | null; avatarValue?: string | null; avatarMediaId?: string | null;
}) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    businessName: u.businessName,
    role: u.role,
    timezone: u.timezone ?? 'Asia/Tehran',
    // Round 17: 'character' renders AVATAR_CHARACTERS[u.avatarValue] as SVG;
    // 'photo' serves GET /users/:id/avatar (avatarMediaId → 512×512 WebP).
    avatarKind: u.avatarKind ?? 'character',
    avatarValue: u.avatarValue ?? '',
    avatarMediaId: u.avatarMediaId ?? null,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Graphical captcha challenge (public; consumed on first verify attempt).
  app.get('/auth/captcha', async (req, reply) => {
    // Keep CAPTCHA availability independent from Redis; this bounded local
    // throttle prevents rapid challenge-generation loops in each app process.
    if (!(await consumeCaptchaIssuanceSlot(req.ip))) throw new AppError(ERR.RATE_LIMITED());
    const { captchaId, svg } = issueCaptcha(req.ip);
    reply.header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
    reply.header('content-type', 'application/json; charset=utf-8');
    return { success: true, data: { captchaId, svg } };
  });

  app.post('/auth/register', { preHandler: [enforceRegistrationIpLimit], config: { rateLimit: {
    max: 30,
    timeWindow: '10 minutes',
    keyGenerator: (req) => {
      const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
      const identity = String(body.email ?? body.mobile ?? '').trim().toLowerCase();
      return `register:${req.ip}:${identity}`;
    },
  } } }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    // Round 17: registration kill-switch — checked BEFORE captcha and any DB write.
    const security = await getSecuritySettings();
    if (!security.registrationEnabled) throw new AppError(ERR.VALIDATION(REGISTRATION_DISABLED));
    // Anti-bot gate BEFORE any DB work (item 15). One shot per code.
    if (security.captchaEnabled) {
      if (!input.captchaId || !input.captchaText) throw new AppError(ERR.VALIDATION(CAPTCHA_REQUIRED));
      const captchaOk = await verifyCaptcha(input.captchaId, input.captchaText, req.ip);
      if (!captchaOk) throw new AppError(ERR.VALIDATION(CAPTCHA_FAILED));
    }
    const { userId } = await registerUser(input, { ip: req.ip, userAgent: req.headers['user-agent'] });
    // Auto-login on successful registration (session rotation included)
    const session = await createSession(userId, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, session.token);
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new AppError(ERR.INTERNAL());
    await onUserRegistered(userId).catch(() => undefined); // referral register reward (best-effort)
    return {
      success: true,
      data: { user: publicUser(u), csrfToken: issueCsrfToken(session.csrfSecret) },
    };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    // Anti-bot gate BEFORE credential check — identical error whether the
    // captcha or the credentials failed, so no account state leaks (item 15).
    // Security setting controls the challenge consistently across auth flows.
    const security = await getSecuritySettings();
    if (security.captchaEnabled) {
      if (!input.captchaId || !input.captchaText) throw new AppError(ERR.VALIDATION(CAPTCHA_REQUIRED));
      const captchaOk = verifyCaptcha(input.captchaId, input.captchaText, req.ip);
      if (!captchaOk) throw new AppError(ERR.VALIDATION(CAPTCHA_FAILED));
    }
    const user = await authenticate(input.identifier, input.password);
    // Session rotation on login (§40): revoke previous sessions
    await revokeAllUserSessions(user.id);
    const session = await createSession(user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, session.token);
    return { success: true, data: { user: publicUser(user), csrfToken: issueCsrfToken(session.csrfSecret) } };
  });

  app.post('/auth/logout', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const user = authUser(req);
    await revokeSession(user.sessionId);
    clearSessionCookie(reply);
    await audit({ action: 'auth.logout', actorId: user.id, subjectType: 'user', subjectId: user.id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.get('/auth/me', { preHandler: [app.requireAuth] }, async (req) => {
    const authed = authUser(req);
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, authed.id)).limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());
    const [sub] = await db
      .select({ id: subscriptions.id, state: subscriptions.state, expiresAt: subscriptions.expiresAt, planName: plans.nameFa, planCode: plans.code })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, authed.id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return {
      success: true,
      data: { user: publicUser(u), subscription: sub ?? null, csrfToken: issueCsrfToken(authed.csrfSecret) },
    };
  });

  app.post('/auth/password-reset', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const input = parse(resetRequestSchema, req.body);
    const security = await getSecuritySettings();
    if (security.captchaEnabled) {
      if (!input.captchaId || !input.captchaText) throw new AppError(ERR.VALIDATION(CAPTCHA_REQUIRED));
      if (!(await verifyCaptcha(input.captchaId, input.captchaText, req.ip))) throw new AppError(ERR.VALIDATION(CAPTCHA_FAILED));
    }
    const created = await requestPasswordReset(input.email);
    // Generic response — no account enumeration (§180)
    return {
      success: true,
      data: {
        ok: true,
        message: created
          ? 'اگر این ایمیل در سیستم ثبت باشد، راهنمای بازیابی برای شما ارسال می‌شود.'
          : 'اگر این ایمیل در سیستم ثبت باشد، راهنمای بازیابی برای شما ارسال می‌شود.',
      },
    };
  });

  app.post('/auth/password-reset/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const input = parse(resetConfirmSchema, req.body);
    const ok = await confirmPasswordReset(input.token, input.password);
    if (!ok) throw new AppError(ERR.VALIDATION('لینک بازیابی نامعتبر یا منقضی است.'));
    return { success: true, data: { ok: true } };
  });
}
