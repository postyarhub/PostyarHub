import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  keys: [] as string[],
  shouldFail: false,
}));

vi.mock('../../queue/connection.js', () => ({
  getRedis: () => ({
    eval: async (_script: string, _keyCount: number, key: string, _windowSeconds: string) => {
      if (redisState.shouldFail) throw new Error('Redis unavailable');
      const count = (redisState.counts.get(key) ?? 0) + 1;
      redisState.counts.set(key, count);
      redisState.keys.push(key);
      return count;
    },
  }),
}));

import { enforceBotWebhookIpLimit } from './webhook-rate-limit.js';

function request(ip: string, botId: string) {
  return {
    ip,
    id: `sec01-${botId}`,
    params: { botId },
    log: { error: vi.fn() },
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  redisState.counts.clear();
  redisState.keys.length = 0;
  redisState.shouldFail = false;
});

describe('SEC-01 shared bot webhook IP limiter', () => {
  it('places 100 distinct bot IDs from one IP into one shared counter', async () => {
    for (let index = 0; index < 100; index += 1) {
      await enforceBotWebhookIpLimit(request('198.51.100.10', `invalid-${index}`));
    }
    expect(redisState.keys).toHaveLength(100);
    expect(new Set(redisState.keys).size).toBe(1);
    expect([...redisState.counts.values()]).toEqual([100]);
  });

  it('separates counter buckets for different client IPs', async () => {
    await enforceBotWebhookIpLimit(request('198.51.100.10', 'bot-a'));
    await enforceBotWebhookIpLimit(request('198.51.100.11', 'bot-b'));
    expect(new Set(redisState.keys).size).toBe(2);
  });

  it('fails closed and logs only a request identifier when Redis is unavailable', async () => {
    redisState.shouldFail = true;
    const req = request('198.51.100.10', 'bot-c');
    await expect(enforceBotWebhookIpLimit(req)).rejects.toThrow();
    expect(req.log.error).toHaveBeenCalledWith({ requestId: req.id }, 'bot_webhook_ip_rate_limit_unavailable');
  });
});
