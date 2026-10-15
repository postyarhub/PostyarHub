import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { newId } from './ids.js';

/**
 * Durable idempotency (§23). scope+key unique at DB level.
 * runIdempotent returns the stored result when already completed.
 * IN_PROGRESS rows with fresh expiry act as a lock; expired rows are reclaimed.
 */
export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

export async function runIdempotent<T>(
  scope: string,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  serialize: (v: T) => unknown = (v) => v,
  deserialize: (raw: unknown) => T = (raw) => raw as T
): Promise<IdempotentResult<T>> {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), lt(idempotencyKeys.expiresAt, now)));

  try {
    await db.insert(idempotencyKeys).values({
      scope,
      idemKey: key,
      state: 'IN_PROGRESS',
      expiresAt,
    });
  } catch {
    // Duplicate: read existing state
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.idemKey, key)))
      .limit(1);
    if (existing && existing.state === 'COMPLETED') {
      return { value: deserialize(existing.resultJson), replayed: true };
    }
    throw new Error('IDEMPOTENCY_IN_PROGRESS');
  }

  try {
    const value = await fn();
    await db
      .update(idempotencyKeys)
      .set({ state: 'COMPLETED', resultJson: serialize(value), expiresAt })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.idemKey, key)));
    return { value, replayed: false };
  } catch (err) {
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.idemKey, key)));
    throw err;
  }
}
