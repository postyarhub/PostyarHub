import { Queue } from 'bullmq';
import { createQueue } from './connection.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../core/logger.js';

/** Typed queue registry with bounded retention (§108). */
export const QUEUE_NAMES = ['delivery', 'bot-events', 'ai-jobs', 'notifications', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const queues = new Map<QueueName, Queue>();
const log = createLogger('queue-registry');

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const q = createQueue(name);
  q.on('error', (err) => {
    log.error({ queue: name, errorName: err?.name ?? 'Error', errorCode: (err as Error & { code?: string })?.code ?? null, message: String(err?.message ?? '').slice(0, 240) }, 'queue_error');
  });
  queues.set(name, q);
  return q;
}

const JOB_RETENTION = { removeOnComplete: { age: 24 * 3600, count: 5000 }, removeOnFail: { age: 7 * 24 * 3600, count: 5000 } };

function normalizeJobId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? normalized.slice(0, 180) : undefined;
}

export async function enqueue(
  name: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  opts: { jobId?: string; delayMs?: number } = {}
): Promise<void> {
  const env = loadEnv();
  if (env.DISABLE_QUEUE) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Background queue is disabled in production.');
    }
    return; // test-mode escape hatch; real deployments always queue
  }
  const safeJobId = opts.jobId?.replace(/:/g, '-');
  await getQueue(name).add(jobName, data, {
    jobId: safeJobId,
    delay: opts.delayMs,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    ...JOB_RETENTION,
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
