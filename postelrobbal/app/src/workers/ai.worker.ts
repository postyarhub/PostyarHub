import { Worker, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { createWorker } from '../queue/connection.js';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/client.js';
import { aiJobs } from '../db/schema.js';
import { aiComplete } from '../providers/ai/ai-providers.js';
import { resolveAiRuntimeOverride } from '../modules/admin/system-settings.service.js';
import { recordAiTokens } from '../modules/ai/ai.service.js';
import { emitEvent } from '../core/events.js';
import { AppError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const CAPTION_SYSTEM_FA =
  'یک کپشن کوتاه، خوانا و جذاب به زبان فارسی برای متن کاربر بنویس. بدون HTML، حداکثر ۳ پاراگراف و در صورت تناسب از ایموجی استفاده کن.';

/**
 * AI jobs worker: QUEUED → RUNNING → COMPLETED/FAILED. Bounded by the hard
 * timeout inside aiComplete; failures are terminal (no retry of misconfigured
 * or quota-exhausted jobs).
 */
export function startAiWorker(): Worker {
  const env = loadEnv();
  const log = createLogger('ai-worker');

  const processor = async (job: Job): Promise<void> => {
    const data = job.data as { jobId?: unknown };
    if (typeof data.jobId !== 'string') return;
    const db = getDb();
    const [aiJob] = await db.select().from(aiJobs).where(eq(aiJobs.id, data.jobId)).limit(1);
    if (!aiJob || aiJob.status !== 'QUEUED') return; // idempotent: never re-run a started job

    // Claim atomically. A duplicated BullMQ job or a second worker process must
    // never be allowed to run the same billable AI request concurrently.
    const claimed = await db
      .update(aiJobs)
      .set({ status: 'RUNNING' })
      .where(and(eq(aiJobs.id, aiJob.id), eq(aiJobs.status, 'QUEUED')));
    const affected = Array.isArray(claimed)
      ? Number((claimed[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0)
      : Number((claimed as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
    if (affected === 0) return;
    const startedAt = Date.now();

    try {
      // Round 18: admin-stored key/custom base URL/model override the env defaults.
      const provider = aiJob.provider || 'openai';
      const override = await resolveAiRuntimeOverride(provider);
      const result = await aiComplete(
        provider,
        {
          ...(aiJob.purpose === 'CAPTION' ? { system: CAPTION_SYSTEM_FA } : {}),
          user: aiJob.inputText,
          timeoutMs: 30_000,
          maxTokens: 700,
        },
        override
      );
      const tokenCount = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
      try { await recordAiTokens(aiJob.tenantId, tokenCount); } catch { log.warn({ jobId: aiJob.id }, 'ai_token_accounting_failed'); }
      await db
        .update(aiJobs)
        .set({
          status: 'COMPLETED',
          outputText: result.text,
          promptTokens: result.promptTokens ?? null,
          completionTokens: result.completionTokens ?? null,
          finishedAt: new Date(),
        })
        .where(eq(aiJobs.id, aiJob.id));
      try { await emitEvent({
        name: 'ai.completed',
        tenantId: aiJob.tenantId,
        subjectType: 'ai_job',
        subjectId: aiJob.id,
        props: {
          purpose: aiJob.purpose,
          provider: aiJob.provider,
          source: 'queue',
          durationMs: Date.now() - startedAt,
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          tokenCount,
        },
        analyticsDedupeKey: `ai:${aiJob.id}:completed`,
      }); } catch { log.warn({ jobId: aiJob.id }, 'ai_completion_telemetry_failed'); }
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_FAILED';
      await db
        .update(aiJobs)
        .set({ status: 'FAILED', errorCode: code.slice(0, 80), finishedAt: new Date() })
        .where(eq(aiJobs.id, aiJob.id));
      try { await emitEvent({
        name: 'ai.failed',
        tenantId: aiJob.tenantId,
        subjectType: 'ai_job',
        subjectId: aiJob.id,
        props: { purpose: aiJob.purpose, provider: aiJob.provider, source: 'queue', errorCode: code, durationMs: Date.now() - startedAt },
        analyticsDedupeKey: `ai:${aiJob.id}:failed`,
      }); } catch { log.warn({ jobId: aiJob.id }, 'ai_failure_telemetry_failed'); }
      log.warn({ jobId: aiJob.id, code }, 'ai_job_failed');
    }
  };

  return createWorker(
    'ai-jobs',
    processor as unknown as Parameters<typeof createWorker>[1],
    { concurrency: env.AI_WORKER_CONCURRENCY }
  );
}
