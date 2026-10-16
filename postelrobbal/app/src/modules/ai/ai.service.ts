import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { aiJobs, aiUsageMonthly, outboxEvents } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { outboxRow } from '../../core/outbox.js';
import { createLogger } from '../../core/logger.js';
import { enqueue } from '../../queue/queues.js';
import { getPlanContext } from '../subscriptions/plan.service.js';
import { aiComplete } from '../../providers/ai/ai-providers.js';
import { getAiSettings, resolveAiRuntimeOverride } from '../admin/system-settings.service.js';

/**
 * AI orchestration (§28): quota accounting (ai_usage_monthly), queue-backed
 * jobs for the API surface, and direct (synchronous) completion for the bot
 * event worker — never routed through the ai-jobs queue for auto-reply.
 */
export type AiPurpose = 'CAPTION' | 'AUTO_REPLY' | 'CUSTOM';

const log = createLogger('ai-service');

function currentPeriodYm(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM UTC
}

/**
 * Concurrency-safe monthly quota accounting. The usage row itself is the
 * serialization point: create it when absent, lock it, re-check the limit,
 * then increment exactly once.
 */
type AiQuotaTx = Pick<ReturnType<typeof getDb>, 'insert' | 'update' | 'execute'>;

async function consumeAiQuotaTx(tx: AiQuotaTx, tenantId: string, limit: number, periodYm: string): Promise<void> {
  // AI is a paid entitlement: zero (including a missing legacy value) means
  // disabled, never unlimited. Keep this guard at the accounting boundary so
  // queued and direct-worker paths share the same policy.
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new AppError(ERR.PLAN_FEATURE_REQUIRED('هوش مصنوعی'));
  }

  await tx.insert(aiUsageMonthly).values({
    tenantId,
    periodYm,
    requestCount: 0,
    tokenCount: 0,
  }).onDuplicateKeyUpdate({
    set: { tenantId: sql`${aiUsageMonthly.tenantId}` },
  });

  const raw = await tx.execute(sql`
    SELECT request_count
    FROM ai_usage_monthly
    WHERE tenant_id = ${tenantId} AND period_ym = ${periodYm}
    FOR UPDATE
  `);
  const rows = (Array.isArray(raw) ? raw[0] : []) as Array<{ request_count: number | string }>;
  const used = Number(rows[0]?.request_count ?? 0);
  if (used >= limit) {
    throw new AppError(ERR.QUOTA_EXCEEDED('هوش مصنوعی'));
  }

  await tx.update(aiUsageMonthly)
    .set({ requestCount: sql`${aiUsageMonthly.requestCount} + 1` })
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm)));
}

export async function consumeAiQuota(tenantId: string): Promise<void> {
  const ctx = await getPlanContext(tenantId);
  const limit = Number(ctx.limits.ai_monthly ?? 0);
  const periodYm = currentPeriodYm();
  await getDb().transaction((tx) => consumeAiQuotaTx(tx, tenantId, limit, periodYm));
}

async function countTokens(tenantId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const db = getDb();
  await db
    .update(aiUsageMonthly)
    .set({ tokenCount: sql`${aiUsageMonthly.tokenCount} + ${tokens}` })
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, currentPeriodYm())));
}

/** Default provider: explicit override → system_settings['ai'].default_provider → 'openai'. */
async function resolveProvider(explicit?: string): Promise<string> {
  const settings = await getAiSettings();
  if (explicit && explicit.trim()) {
    const p = explicit.trim().toLowerCase();
    if (settings.providers.some((x) => x.id === p)) return p;
    throw new AppError(ERR.VALIDATION('سرویس‌دهندهٔ هوش مصنوعی پشتیبانی نمی‌شود.'));
  }
  return settings.defaultProvider || settings.providers[0]?.id || 'openai';
}

export async function requestAiJob(
  tenantId: string,
  input: { purpose: AiPurpose; inputText: string; provider?: string }
): Promise<{ jobId: string }> {
  // Resolve configuration before quota consumption so invalid provider input is
  // never charged as a successful AI request.
  const provider = await resolveProvider(input.provider);
  const ctx = await getPlanContext(tenantId);
  const limit = Number(ctx.limits.ai_monthly ?? 0);
  const periodYm = currentPeriodYm();
  const db = getDb();
  const jobId = newId();

  // AI job + quota + durable queue intent commit together. A Redis outage after
  // this transaction no longer loses the job or burns quota without a recoverable
  // work record; the outbox relay can dispatch it later.
  await db.transaction(async (tx) => {
    await consumeAiQuotaTx(tx, tenantId, limit, periodYm);
    await tx.insert(aiJobs).values({
      id: jobId,
      tenantId,
      purpose: input.purpose,
      provider,
      inputText: input.inputText,
    });
    await tx.insert(outboxEvents).values(
      outboxRow({
        aggregateType: 'ai',
        aggregateId: jobId,
        eventType: 'ai.run',
        payload: { jobId },
      })
    );
  });

  // Fast path only. The durable outbox remains the recovery path.
  try {
    await enqueue('ai-jobs', 'run', { jobId }, { jobId: `ai:${jobId}` });
  } catch (err) {
    log.warn({ jobId, errorName: err instanceof Error ? err.name : 'Error', errorMessage: String(err instanceof Error ? err.message : err ?? '').slice(0, 200) }, 'ai_job_fast_path_enqueue_failed');
  }
  await safeEmitEvent({
    name: 'ai.requested',
    tenantId,
    subjectType: 'ai_job',
    subjectId: jobId,
    props: { purpose: input.purpose, provider, source: 'queue' },
    analyticsDedupeKey: `ai:${jobId}:requested`,
  });
  return { jobId };
}

/** Queue-backed caption generation — the frontend polls GET /ai/jobs/:id. */
export async function requestAiCaption(tenantId: string, text: string): Promise<{ jobId: string }> {
  return requestAiJob(tenantId, { purpose: 'CAPTION', inputText: text });
}

/**
 * Direct (non-queued) completion for the bot event worker: counts usage then
 * calls the AI provider synchronously with a hard 30s timeout.
 */
export interface DirectAiContext {
  purpose?: AiPurpose;
  source?: string;
  subjectType?: string;
  subjectId?: string;
}

/** Token accounting for queue workers and other async callers. */
export async function recordAiTokens(tenantId: string, tokens: number): Promise<void> {
  await countTokens(tenantId, tokens);
}

/** Direct provider completion with first-class analytics telemetry. */
async function safeEmitEvent(input: Parameters<typeof emitEvent>[0]): Promise<void> {
  try {
    await emitEvent(input);
  } catch {
    // Telemetry must never turn a successful provider call into a failed business operation.
  }
}

export async function aiProviderComplete(
  tenantId: string,
  system: string,
  user: string,
  context: DirectAiContext = {},
): Promise<string> {
  const purpose = context.purpose ?? 'AUTO_REPLY';
  const source = context.source ?? 'direct';
  const requestedAt = new Date();
  let provider = 'openai';

  try {
    provider = await resolveProvider(undefined);
    await consumeAiQuota(tenantId);
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AI_QUOTA_EXCEEDED';
    await safeEmitEvent({
      name: 'ai.failed',
      tenantId,
      subjectType: context.subjectType ?? 'ai_request',
      subjectId: context.subjectId,
      props: { purpose, provider, source, errorCode: code },
    });
    throw err;
  }

  await safeEmitEvent({
    name: 'ai.requested',
    tenantId,
    subjectType: context.subjectType ?? 'ai_request',
    subjectId: context.subjectId,
    props: { purpose, provider, source, requestedAt: requestedAt.toISOString() },
    analyticsDedupeKey: context.subjectId ? `ai:${context.subjectId}:requested:${requestedAt.getTime()}` : null,
  });

  const startedAt = Date.now();
  try {
    const override = await resolveAiRuntimeOverride(provider);
    const result = await aiComplete(provider, { system, user, timeoutMs: 30_000, maxTokens: 500 }, override);
    const tokenCount = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
    try { await countTokens(tenantId, tokenCount); } catch { /* usage accounting is best-effort */ }
    await safeEmitEvent({
      name: 'ai.completed',
      tenantId,
      subjectType: context.subjectType ?? 'ai_request',
      subjectId: context.subjectId,
      props: {
        purpose,
        provider,
        source,
        durationMs: Date.now() - startedAt,
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        tokenCount,
      },
      analyticsDedupeKey: context.subjectId ? `ai:${context.subjectId}:completed:${requestedAt.getTime()}` : null,
    });
    return result.text;
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AI_FAILED';
    await safeEmitEvent({
      name: 'ai.failed',
      tenantId,
      subjectType: context.subjectType ?? 'ai_request',
      subjectId: context.subjectId,
      props: { purpose, provider, source, errorCode: code, durationMs: Date.now() - startedAt },
      analyticsDedupeKey: context.subjectId ? `ai:${context.subjectId}:failed:${requestedAt.getTime()}` : null,
    });
    throw err;
  }
}

/** Synchronous small completion for settings testing — quota-guarded, 30s. */
export async function generateAiSync(
  tenantId: string,
  input: { system?: string; text: string }
): Promise<{ text: string; provider: string }> {
  const purpose: AiPurpose = 'CUSTOM';
  const startedAt = Date.now();
  let provider = 'openai';
  try {
    provider = await resolveProvider(undefined);
    await consumeAiQuota(tenantId);
    await safeEmitEvent({
      name: 'ai.requested',
      tenantId,
      subjectType: 'ai_settings_test',
      props: { purpose, provider, source: 'settings_test' },
    });
    const override = await resolveAiRuntimeOverride(provider);
    const result = await aiComplete(
      provider,
      {
        ...(input.system ? { system: input.system } : {}),
        user: input.text,
        timeoutMs: 30_000,
        maxTokens: 500,
      },
      override
    );
    const tokenCount = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
    try { await countTokens(tenantId, tokenCount); } catch { /* usage accounting is best-effort */ }
    await safeEmitEvent({
      name: 'ai.completed',
      tenantId,
      subjectType: 'ai_settings_test',
      props: {
        purpose,
        provider,
        source: 'settings_test',
        durationMs: Date.now() - startedAt,
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        tokenCount,
      },
    });
    return { text: result.text, provider };
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AI_FAILED';
    await safeEmitEvent({
      name: 'ai.failed',
      tenantId,
      subjectType: 'ai_settings_test',
      props: { purpose, provider, source: 'settings_test', errorCode: code, durationMs: Date.now() - startedAt },
    });
    throw err;
  }
}

export async function getAiJob(
  tenantId: string,
  jobId: string
): Promise<{
  id: string;
  purpose: string;
  provider: string;
  status: string;
  inputText: string;
  outputText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.tenantId, tenantId)))
    .limit(1);
  if (!job) throw new AppError(ERR.NOT_FOUND('درخواست هوش مصنوعی'));
  return {
    id: job.id,
    purpose: job.purpose,
    provider: job.provider,
    status: job.status,
    inputText: job.inputText,
    outputText: job.outputText,
    promptTokens: job.promptTokens,
    completionTokens: job.completionTokens,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

export async function getAiUsage(
  tenantId: string
): Promise<{ periodYm: string; requestCount: number; tokenCount: number }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiUsageMonthly)
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, currentPeriodYm())))
    .limit(1);
  return {
    periodYm: currentPeriodYm(),
    requestCount: row?.requestCount ?? 0,
    tokenCount: row?.tokenCount ?? 0,
  };
}
