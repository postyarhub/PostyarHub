import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { bots } from '../db/schema.js';
import { getRedis } from '../queue/connection.js';
import { getProvider } from '../providers/index.js';
import { decryptSecret } from '../security/encryption.js';
import { ingestBotPollingUpdate } from '../modules/bots/bot.service.js';
import { newToken } from '../core/ids.js';
import { createLogger } from '../core/logger.js';
import { loadEnv } from '../config/env.js';

const log = createLogger('bot-poller');
const POLL_INTERVAL_MS = 2_000;
const LOCK_TTL_SECONDS = 60;
const REDIS_PREFIX = 'postyar:botpoll:';
const BOT_POLL_CURSOR_KEY = `${REDIS_PREFIX}cursor`;

function updateIdOf(update: unknown): number | null {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const raw = (update as Record<string, unknown>).update_id;
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

async function pollOne(bot: { id: string; platform: 'telegram' | 'bale' | 'rubika'; tokenEncrypted: string }): Promise<void> {
  // Rubika is webhook-first in Postyar; never revive polling for legacy rows.
  if (bot.platform === 'rubika') return;
  const provider = getProvider(bot.platform);
  if (!provider.capabilities().polling || typeof provider.fetchUpdates !== 'function') return;

  const redis = getRedis();
  const lockKey = `${REDIS_PREFIX}lock:${bot.id}`;
  const lockValue = `${process.pid}:${newToken(12)}`;
  const lock = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
  if (lock !== 'OK') return;

  try {
    const offsetKey = `${REDIS_PREFIX}offset:${bot.id}`;
    const stored = await redis.get(offsetKey);
    if (typeof provider.fetchUpdates === 'function') {
      let offset = stored && /^\d+$/.test(stored) ? Number(stored) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
      const updates = await provider.fetchUpdates(decryptSecret(bot.tokenEncrypted), offset);
      let nextOffset = offset;
      for (const update of updates) {
        await ingestBotPollingUpdate(bot.id, update);
        const updateId = updateIdOf(update);
        if (updateId !== null && updateId + 1 > nextOffset) nextOffset = updateId + 1;
      }
      if (nextOffset > offset) await redis.set(offsetKey, String(nextOffset));
    }
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockValue
    ).catch(() => undefined);
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    const redis = getRedis();
    const cursor = await redis.get(BOT_POLL_CURSOR_KEY).catch(() => null);
    const pollingFilter = and(eq(bots.status, 'ACTIVE'), eq(bots.mode, 'POLLING'));
    let rows = await db
      .select({ id: bots.id, platform: bots.platform, tokenEncrypted: bots.tokenEncrypted })
      .from(bots)
      .where(and(pollingFilter, ...(cursor ? [gt(bots.id, cursor)] : [])))
      .orderBy(asc(bots.id))
      .limit(100);
    // Wrap around after the last page. The persistent cursor prevents permanent
    // starvation when more than 100 polling bots are connected.
    if (rows.length === 0 && cursor) {
      rows = await db
        .select({ id: bots.id, platform: bots.platform, tokenEncrypted: bots.tokenEncrypted })
        .from(bots)
        .where(pollingFilter)
        .orderBy(asc(bots.id))
        .limit(100);
    }
    if (rows.length > 0) {
      await redis.set(BOT_POLL_CURSOR_KEY, rows[rows.length - 1]!.id).catch(() => undefined);
    }
    const batchSize = loadEnv().BOT_POLL_CONCURRENCY;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await Promise.all(batch.map((bot) =>
        pollOne(bot).catch((err: unknown) => {
          log.warn({ botId: bot.id, err: err instanceof Error ? err.message : 'poll_failed' }, 'bot_poll_failed');
        })
      ));
    }
  } catch (err) {
    // A database/Redis failure in the polling coordinator must not escape the
    // fire-and-forget timer and terminate the single production worker.
    log.error({ err }, 'bot_poll_tick_failed');
  } finally {
    running = false;
  }
}

export function startBotPollingWorker(): { close: () => Promise<void> } {
  void tick();
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref?.();
  return {
    close: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
