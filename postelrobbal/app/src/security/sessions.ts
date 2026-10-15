import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { newId, newToken, sha256Hex } from '../core/ids.js';
import { isProduction, loadEnv } from '../config/env.js';
import type { FastifyReply } from 'fastify';

/**
 * Session model (ADR-0006): opaque token, server-side storage, HttpOnly
 * SameSite=Lax Secure cookie, rotation on login, server-side revocation.
 * Nothing authentication-related in localStorage (§40).
 */
export const SESSION_COOKIE = 'py_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  id: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER';
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  sessionId: string;
  csrfSecret: string;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string }
): Promise<{ token: string; sessionId: string; csrfSecret: string }> {
  const db = getDb();
  const token = newToken(32);
  const csrfSecret = newToken(24);
  const id = newId();
  await db.insert(sessions).values({
    id,
    userId,
    tokenHash: await sha256Hex(token),
    csrfSecret,
    userAgent: meta.userAgent?.slice(0, 250) ?? null,
    ip: meta.ip ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { token, sessionId: id, csrfSecret };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const env = loadEnv();
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(env),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      csrfSecret: sessions.csrfSecret,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      id: users.id,
      role: users.role,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
  if (row.status === 'SUSPENDED') return null;
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    sessionId: row.sessionId,
    csrfSecret: row.csrfSecret,
  };
}

/** Session rotation on login: revoke all previous sessions for credential safety. */
export async function revokeSession(sessionId: string): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
}

export async function sweepExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
