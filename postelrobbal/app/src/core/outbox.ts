import { and, eq, lte, or, isNull, asc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';
import { newId, newToken } from './ids.js';
import { createLogger } from './logger.js';
import { getRedis } from '../queue/connection.js';

/**
 * Transactional outbox (§125). Business operations persist the outbox row
 * inside the SAME transaction as the business state. The relay then
 * dispatches to BullMQ. This module provides the row shape + relay.
 */
export interface OutboxInput {
  aggregateType: 'post' | 'notification' | 'wordpress' | 'gold' | 'ai';
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function outboxRow(input: OutboxInput) {
  return {
    id: newId(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payloadJson: input.payload,
    state: 'PENDING' as const,
    attempts: 0,
  };
}

const log = createLogger('outbox-relay');
const OUTBOX_RELAY_LOCK_KEY = 'postyar:outbox-relay:lock';
const OUTBOX_RELAY_LOCK_TTL_SECONDS = 120;

export interface Dispatcher {
  dispatch(event: { id: string; eventType: string; payloadJson: Record<string, unknown>; aggregateId: string }): Promise<void>;
}

/** Relay pending outbox events to the queue. Called by worker loop. */
export async function relayOutbox(dispatcher: Dispatcher, batchSize = 50): Promise<number> {
  const redis = getRedis();
  const lockValue = `${process.pid}:${newToken(12)}`;
  const lock = await redis.set(OUTBOX_RELAY_LOCK_KEY, lockValue, 'EX', OUTBOX_RELAY_LOCK_TTL_SECONDS, 'NX');
  if (lock !== 'OK') {
    log.debug({}, 'outbox_relay_lock_busy');
    return 0;
  }

  try {
    const db = getDb();
    const pending = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.state, 'PENDING'))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(batchSize);

    let dispatched = 0;
    for (const ev of pending) {
      try {
        await dispatcher.dispatch({
          id: ev.id,
          eventType: ev.eventType,
          payloadJson: ev.payloadJson ?? {},
          aggregateId: ev.aggregateId,
        });
        await db
          .update(outboxEvents)
          .set({ state: 'DISPATCHED', dispatchedAt: new Date() })
          .where(eq(outboxEvents.id, ev.id));
        dispatched++;
      } catch (err) {
        const nextAttempts = ev.attempts + 1;
        const terminal = nextAttempts >= 10;
        await db
          .update(outboxEvents)
          .set({ attempts: nextAttempts, state: terminal ? 'FAILED' : 'PENDING' })
          .where(eq(outboxEvents.id, ev.id));
        log.error({
          outboxId: ev.id,
          aggregateType: ev.aggregateType,
          aggregateId: ev.aggregateId,
          eventType: ev.eventType,
          attempts: nextAttempts,
          terminal,
          errorName: err instanceof Error ? err.name : 'UnknownError',
          errorMessage: String(err instanceof Error ? err.message : err ?? '').slice(0, 240),
        }, terminal ? 'outbox_dispatch_terminal_failure' : 'outbox_dispatch_failed');
      }
    }
    return dispatched;
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      OUTBOX_RELAY_LOCK_KEY,
      lockValue,
    ).catch(() => undefined);
  }
}
