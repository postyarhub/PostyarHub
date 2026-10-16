import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { assertFeature } from '../subscriptions/plan.service.js';
import { workflows, workflowRuns } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { emitEvent } from '../../core/events.js';
import { AppError, ERR } from '../../core/errors.js';
import { normalizeButtonTargetValue } from '../../core/button-target.js';
import { aiProviderComplete } from '../ai/ai.service.js';
import type { Platform } from '../../providers/types.js';

/**
 * Deterministic workflow interpreter (§190): hard safety limits, bounded
 * execution, persisted run log. Steps: MESSAGE | BUTTONS | AI | WAIT |
 * CONDITION (max 2 nested branch levels).
 */
export const WORKFLOW_LIMITS = {
  maxSteps: 20,
  maxDurationMs: 60_000,
  maxNesting: 2,
  maxAiCalls: 2,
  maxOutbound: 10,
} as const;

export type WorkflowStep =
  | { type: 'MESSAGE'; text: string }
  | { type: 'BUTTONS'; text: string; buttons: Array<{ label: string; url?: string; callback?: string }> }
  | { type: 'AI'; prompt: string }
  | { type: 'WAIT'; seconds: number }
  | {
      type: 'CONDITION';
      variable: string;
      operator: 'EQUALS' | 'CONTAINS';
      value: string;
      then?: WorkflowStep[];
      else?: WorkflowStep[];
    };

export interface WorkflowDefinition {
  trigger: { kind: string; keyword?: string };
  steps: WorkflowStep[];
}

export interface WorkflowRunSpec {
  workflowId: string;
  tenantId: string;
  botId: string;
  triggerKind: string;
  triggerRef: string | null;
  variables: Record<string, string>;
}

export interface WorkflowBotContext {
  platform: Platform;
  token: string;
  aiSystemPrompt: string | null;
}

export type WorkflowSend = (
  chatRef: string,
  text: string,
  buttons?: Array<{ label: string; url?: string; callback?: string }>
) => Promise<void>;

const DEFAULT_AI_PROMPT_FA =
  'شما پاسخ‌گوی خودکار یک کسب‌وکار ایرانی هستید. کوتاه، مؤدبانه و فارسی پاسخ بده.';

class WorkflowTimeoutError extends Error {
  constructor() {
    super('WORKFLOW_TIMEOUT');
  }
}

class WorkflowLimitError extends Error {
  constructor(code: string) {
    super(code);
  }
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

function interpolate(vars: Record<string, string>, template: string): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

function coerceButtons(value: unknown): Array<{ label: string; url?: string; callback?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ label: string; url?: string; callback?: string }> = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    if (typeof b['label'] !== 'string' || !b['label']) continue;
    let safeUrl: string | undefined;
    if (typeof b['url'] === 'string') {
      try { safeUrl = normalizeButtonTargetValue('URL', b['url'].slice(0, 255)); } catch { /* drop legacy unsafe URL */ }
    }
    const callback = typeof b['callback'] === 'string' ? b['callback'].slice(0, 64) : undefined;
    if (!safeUrl && !callback) continue;
    out.push({
      label: b['label'].slice(0, 64),
      ...(safeUrl ? { url: safeUrl } : {}),
      ...(callback ? { callback } : {}),
    });
  }
  return out;
}

export function prepareWorkflowButtons(buttons: Array<{ label: string; url?: string; callback?: string }>): Array<{ label: string; url?: string; callback?: string }> {
  const safe: Array<{ label: string; url?: string; callback?: string }> = [];
  for (const b of buttons.slice(0, 8)) {
    let url: string | undefined;
    if (typeof b.url === 'string') {
      try { url = normalizeButtonTargetValue('URL', b.url.slice(0, 255)); } catch { /* reject legacy unsafe URL */ }
    }
    const callback = typeof b.callback === 'string' ? b.callback.slice(0, 64) : undefined;
    if (!url && !callback) continue;
    safe.push({ label: b.label.slice(0, 64), ...(url ? { url } : {}), ...(callback ? { callback } : {}) });
  }
  return safe;
}

/** Defensive step coercion — malformed steps are dropped, never crash the run. */
function coerceStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s['type']) {
    case 'MESSAGE':
      return typeof s['text'] === 'string' && s['text'].length > 0
        ? { type: 'MESSAGE', text: s['text'] }
        : null;
    case 'BUTTONS':
      return typeof s['text'] === 'string' && s['text'].length > 0
        ? { type: 'BUTTONS', text: s['text'], buttons: coerceButtons(s['buttons']) }
        : null;
    case 'AI':
      return typeof s['prompt'] === 'string' && s['prompt'].length > 0
        ? { type: 'AI', prompt: s['prompt'] }
        : null;
    case 'WAIT':
      return typeof s['seconds'] === 'number' && Number.isFinite(s['seconds'])
        ? { type: 'WAIT', seconds: s['seconds'] }
        : null;
    case 'CONDITION': {
      const then = Array.isArray(s['then'])
        ? s['then'].map(coerceStep).filter((x): x is WorkflowStep => x !== null)
        : undefined;
      const els = Array.isArray(s['else'])
        ? s['else'].map(coerceStep).filter((x): x is WorkflowStep => x !== null)
        : undefined;
      return {
        type: 'CONDITION',
        variable: typeof s['variable'] === 'string' ? s['variable'] : '',
        operator: s['operator'] === 'CONTAINS' ? 'CONTAINS' : 'EQUALS',
        value: typeof s['value'] === 'string' ? s['value'] : '',
        ...(then && then.length ? { then } : {}),
        ...(els && els.length ? { else: els } : {}),
      };
    }
    default:
      return null;
  }
}

export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  if (!Array.isArray(root['steps'])) return null;
  const steps = root['steps'].map(coerceStep).filter((x): x is WorkflowStep => x !== null);
  if (steps.length === 0) return null;
  const triggerRaw = (root['trigger'] ?? {}) as Record<string, unknown>;
  return {
    trigger: {
      kind: typeof triggerRaw['kind'] === 'string' ? triggerRaw['kind'] : 'MESSAGE_RECEIVED',
      ...(typeof triggerRaw['keyword'] === 'string' ? { keyword: triggerRaw['keyword'] } : {}),
    },
    steps,
  };
}

/** Execute a workflow run: RUNNING → COMPLETED / FAILED / TIMEOUT. */
export async function executeWorkflow(
  run: WorkflowRunSpec,
  bot: WorkflowBotContext,
  send: WorkflowSend
): Promise<void> {
  await assertFeature(run.tenantId, 'auto_responder');
  const db = getDb();
  const runId = newId();
  const startedAtMs = Date.now();
  const logEntries: Array<{ step: number; type: string; note?: string }> = [];
  let stepsExecuted = 0;
  let status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' = 'COMPLETED';
  let errorCode: string | null = null;

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId: run.workflowId,
    tenantId: run.tenantId,
    triggerKind: run.triggerKind,
    triggerRef: run.triggerRef,
    status: 'RUNNING',
  });
  await emitEvent({
    name: 'workflow.started',
    tenantId: run.tenantId,
    subjectType: 'workflow',
    subjectId: run.workflowId,
    props: { triggerKind: run.triggerKind, platform: bot.platform, source: 'workflow_engine' },
    analyticsDedupeKey: `workflow:${runId}:started`,
  });

  try {
    const [wf] = await db
      .select({ definitionJson: workflows.definitionJson })
      .from(workflows)
      .where(and(eq(workflows.id, run.workflowId), eq(workflows.tenantId, run.tenantId), eq(workflows.botId, run.botId), eq(workflows.isEnabled, 1)))
      .limit(1);
    const def = parseWorkflowDefinition(wf?.definitionJson);
    if (!def) throw new WorkflowLimitError('WORKFLOW_DEFINITION_INVALID');

    let outbound = 0;
    let aiCalls = 0;

    const assertBudget = (): void => {
      if (Date.now() - startedAtMs > WORKFLOW_LIMITS.maxDurationMs) throw new WorkflowTimeoutError();
    };
    const chatRef = run.variables['chatRef'] ?? '';

    const execStep = async (step: WorkflowStep, depth: number): Promise<void> => {
      if (stepsExecuted >= WORKFLOW_LIMITS.maxSteps) throw new WorkflowLimitError('WORKFLOW_STEP_LIMIT');
      stepsExecuted++;
      assertBudget();

      switch (step.type) {
        case 'MESSAGE': {
          if (outbound >= WORKFLOW_LIMITS.maxOutbound) throw new WorkflowLimitError('WORKFLOW_OUTBOUND_LIMIT');
          outbound++;
          await send(chatRef, interpolate(run.variables, step.text));
          logEntries.push({ step: stepsExecuted, type: 'MESSAGE' });
          return;
        }
        case 'BUTTONS': {
          if (outbound >= WORKFLOW_LIMITS.maxOutbound) throw new WorkflowLimitError('WORKFLOW_OUTBOUND_LIMIT');
          outbound++;
          const buttons = prepareWorkflowButtons(step.buttons);
          await send(chatRef, interpolate(run.variables, step.text), buttons.length ? buttons : undefined);
          logEntries.push({ step: stepsExecuted, type: 'BUTTONS' });
          return;
        }
        case 'AI': {
          if (aiCalls >= WORKFLOW_LIMITS.maxAiCalls) throw new WorkflowLimitError('WORKFLOW_AI_LIMIT');
          aiCalls++;
          const system = interpolate(run.variables, step.prompt) || bot.aiSystemPrompt || DEFAULT_AI_PROMPT_FA;
          const reply = await aiProviderComplete(
            run.tenantId,
            system,
            run.variables['text'] ?? '',
            { purpose: 'AUTO_REPLY', source: 'workflow', subjectType: 'workflow', subjectId: run.workflowId },
          );
          if (outbound >= WORKFLOW_LIMITS.maxOutbound) throw new WorkflowLimitError('WORKFLOW_OUTBOUND_LIMIT');
          outbound++;
          await send(chatRef, reply);
          logEntries.push({ step: stepsExecuted, type: 'AI' });
          return;
        }
        case 'WAIT': {
          const seconds = Math.max(0, Math.min(60, Math.floor(step.seconds)));
          if (Date.now() - startedAtMs + seconds * 1000 > WORKFLOW_LIMITS.maxDurationMs) {
            throw new WorkflowTimeoutError();
          }
          await sleep(seconds * 1000);
          logEntries.push({ step: stepsExecuted, type: 'WAIT', note: `${seconds}s` });
          return;
        }
        case 'CONDITION': {
          if (depth + 1 > WORKFLOW_LIMITS.maxNesting) throw new WorkflowLimitError('WORKFLOW_NESTING_LIMIT');
          const actual = run.variables[step.variable] ?? '';
          const target = interpolate(run.variables, step.value);
          const pass =
            step.operator === 'EQUALS' ? actual === target : actual.toLowerCase().includes(target.toLowerCase());
          const branch = pass ? (step.then ?? []) : (step.else ?? []);
          logEntries.push({ step: stepsExecuted, type: 'CONDITION', note: pass ? 'then' : 'else' });
          for (const child of branch) await execStep(child, depth + 1);
          return;
        }
        default:
          throw new WorkflowLimitError('WORKFLOW_STEP_INVALID');
      }
    };

    for (const step of def.steps) {
      await execStep(step, 0);
      assertBudget();
    }

    await db
      .update(workflows)
      .set({ runCount: sql`${workflows.runCount} + 1` })
      .where(and(eq(workflows.id, run.workflowId), eq(workflows.tenantId, run.tenantId), eq(workflows.botId, run.botId)));
  } catch (err) {
    if (err instanceof WorkflowTimeoutError) {
      status = 'TIMEOUT';
      errorCode = 'WORKFLOW_TIMEOUT';
    } else if (err instanceof WorkflowLimitError) {
      status = 'FAILED';
      errorCode = err.message.slice(0, 80);
    } else if (err instanceof AppError) {
      status = 'FAILED';
      errorCode = err.code.slice(0, 80);
    } else {
      status = 'FAILED';
      errorCode = 'WORKFLOW_STEP_FAILED';
    }
  }

  const finishedAt = new Date();
  await db
    .update(workflowRuns)
    .set({
      status,
      stepsExecuted,
      logJson: logEntries.length ? logEntries : null,
      errorCode,
      finishedAt,
    })
    .where(eq(workflowRuns.id, runId));

  await emitEvent({
    name: status === 'COMPLETED' ? 'workflow.completed' : 'workflow.failed',
    tenantId: run.tenantId,
    subjectType: 'workflow',
    subjectId: run.workflowId,
    props: {
      status,
      platform: bot.platform,
      source: 'workflow_engine',
      stepsExecuted,
      outboundMessages: Math.min(logEntries.filter((x) => x.type === 'MESSAGE' || x.type === 'BUTTONS' || x.type === 'AI').length, WORKFLOW_LIMITS.maxOutbound),
      aiCalls: logEntries.filter((x) => x.type === 'AI').length,
      durationMs: Math.max(0, finishedAt.getTime() - new Date(startedAtMs).getTime()),
      ...(errorCode ? { errorCode } : {}),
    },
    analyticsDedupeKey: `workflow:${runId}:${status.toLowerCase()}`,
  });

  // Caller-facing: engine never throws after the run row is finalized.
  if (status === 'FAILED' && errorCode === 'WORKFLOW_DEFINITION_INVALID') {
    throw new AppError(ERR.VALIDATION('ساختار گردش کار معتبر نیست.'));
  }
}
