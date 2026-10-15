import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError, ERR } from '../../core/errors.js';
import { getRedis } from '../../queue/connection.js';

// Independent of botId: every webhook request from the same resolved client IP
// shares one short-lived Redis bucket, while the existing per-bot limiter remains.
export const BOT_WEBHOOK_IP_LIMIT = 5000;
export const BOT_WEBHOOK_IP_WINDOW_SECONDS = 60;
const BOT_WEBHOOK_IP_COUNTER_SCRIPT = [
  'local count = redis.call("INCR", KEYS[1])',
  'if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end',
  'return count',
].join('\n');

export function botWebhookIpRateLimitKey(ip: string): string {
  const ipHash = createHash('sha256').update(String(ip || 'unknown')).digest('hex');
  return `postyar:rate-limit:bot-webhook-ip:${ipHash}`;
}

export async function enforceBotWebhookIpLimit(req: FastifyRequest): Promise<void> {
  const key = botWebhookIpRateLimitKey(String(req.ip || 'unknown'));
  let count: number;
  try {
    count = Number(await getRedis().eval(
      BOT_WEBHOOK_IP_COUNTER_SCRIPT,
      1,
      key,
      String(BOT_WEBHOOK_IP_WINDOW_SECONDS),
    ));
  } catch {
    req.log.error({ requestId: req.id }, 'bot_webhook_ip_rate_limit_unavailable');
    throw new AppError(ERR.INTERNAL());
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    req.log.error({ requestId: req.id }, 'bot_webhook_ip_rate_limit_invalid_result');
    throw new AppError(ERR.INTERNAL());
  }
  if (count > BOT_WEBHOOK_IP_LIMIT) throw new AppError(ERR.RATE_LIMITED());
}
