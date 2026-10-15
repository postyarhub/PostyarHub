import { Queue as BullQueue, Worker as BullWorker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv } from '../config/env.js';

/**
 * BullMQ on external Redis (ADR-0004). The app NEVER installs/provisions Redis (§53).
 */
let connection: Redis | null = null;

export function getRedis(): Redis {
  if (connection) return connection;
  const env = loadEnv();
  connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return connection;
}

export function bullConnection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => connection?.disconnect());
    connection = null;
  }
}

export function createQueue(name: string): BullQueue {
  return new BullQueue(name, { connection: bullConnection() });
}

export interface WorkerOpts {
  concurrency: number;
}

export type JobProcessor = (job: Job) => Promise<void>;

export function createWorker(name: string, processor: JobProcessor, opts: WorkerOpts): BullWorker {
  const env = loadEnv();
  return new BullWorker(name, processor, {
    connection: bullConnection(),
    concurrency: opts.concurrency,
    ...(name === 'delivery'
      ? { limiter: { max: env.DELIVERY_RATE_LIMIT_MAX, duration: env.DELIVERY_RATE_LIMIT_DURATION_MS } }
      : {}),
  });
}
