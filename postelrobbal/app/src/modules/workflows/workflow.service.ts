import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { workflows, workflowRuns } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { normalizeButtonTargetValue } from '../../core/button-target.js';
import { audit } from '../../core/audit.js';
import { WORKFLOW_LIMITS } from './workflow.engine.js';
import type { WorkflowStep } from './workflow.engine.js';
import { getOwnedBot } from '../bots/bot.service.js';
import { assertFeature } from '../subscriptions/plan.service.js';

/**
 * Workflow CRUD (§190): definitions are validated against a recursive zod
 * schema (max 20 steps incl. branches), always scoped to a tenant-owned bot.
 */

type WorkflowRow = typeof workflows.$inferSelect;

const workflowButtonUrlSchema = z.string().trim().min(1).max(255).transform((value, ctx) => {
  try {
    return normalizeButtonTargetValue('URL', value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'نشانی دکمه باید یک لینک معتبر HTTP یا HTTPS باشد.' });
    return z.NEVER;
  }
});

const buttonSchema = z.object({
  label: z.string().min(1).max(64),
  url: workflowButtonUrlSchema.optional(),
  callback: z.string().max(64).optional(),
});

const conditionSchema = z.object({
  type: z.literal('CONDITION'),
  variable: z.string().min(1).max(64),
  operator: z.enum(['EQUALS', 'CONTAINS']),
  value: z.string().max(400),
  then: z.array(z.lazy(() => stepSchema)).max(10).optional(),
  else: z.array(z.lazy(() => stepSchema)).max(10).optional(),
});

const stepSchema: z.ZodType<WorkflowStep> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MESSAGE'), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('BUTTONS'), text: z.string().min(1).max(4000), buttons: z.array(buttonSchema).min(1).max(8) }),
  z.object({ type: z.literal('AI'), prompt: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('WAIT'), seconds: z.number().int().min(1).max(60) }),
  conditionSchema,
]);

const definitionSchema = z.object({
  trigger: z.object({
    kind: z.literal('MESSAGE_RECEIVED'),
    keyword: z.string().max(190).optional(),
  }),
  steps: z.array(stepSchema).min(1).max(WORKFLOW_LIMITS.maxSteps),
});

function countSteps(steps: WorkflowStep[]): number {
  let count = 0;
  for (const s of steps) {
    count++;
    if (s.type === 'CONDITION') {
      count += s.then ? countSteps(s.then) : 0;
      count += s.else ? countSteps(s.else) : 0;
    }
  }
  return count;
}

function parseDefinition(raw: unknown): z.infer<typeof definitionSchema> {
  const res = definitionSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new AppError(ERR.VALIDATION(`ساختار گردش کار معتبر نیست.${first ? ` (${first.path.join('.')})` : ''}`));
  }
  if (countSteps(res.data.steps) > WORKFLOW_LIMITS.maxSteps) {
    throw new AppError(ERR.VALIDATION('تعداد گام‌های گردش کار بیش از حد مجاز است.'));
  }
  return res.data;
}

export async function getOwnedWorkflow(tenantId: string, workflowId: string): Promise<WorkflowRow> {
  await assertFeature(tenantId, 'auto_responder');
  const db = getDb();
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('گردش کار'));
  return row;
}

export async function listWorkflows(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: WorkflowRow[]; total: number; page: number; pageSize: number }> {
  await assertFeature(tenantId, 'auto_responder');
  const db = getDb();
  const items = await db
    .select()
    .from(workflows)
    .where(eq(workflows.tenantId, tenantId))
    .orderBy(desc(workflows.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workflows)
    .where(eq(workflows.tenantId, tenantId));
  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function createWorkflow(
  tenantId: string,
  input: { botId: string; nameFa: string; definition?: unknown }
): Promise<WorkflowRow> {
  await assertFeature(tenantId, 'auto_responder');
  const bot = await getOwnedBot(tenantId, input.botId); // plan + ownership validation
  const definition = parseDefinition(input.definition);
  const db = getDb();
  const id = newId();
  await db.insert(workflows).values({
    id,
    tenantId,
    botId: bot.id,
    nameFa: input.nameFa.trim().slice(0, 190),
    definitionJson: definition,
  });
  await audit({ action: 'workflow.create', actorId: tenantId, subjectType: 'workflow', subjectId: id, meta: { botId: bot.id } });
  return getOwnedWorkflow(tenantId, id);
}

export async function updateWorkflow(
  tenantId: string,
  workflowId: string,
  patch: { nameFa?: string; definition?: unknown; isEnabled?: boolean }
): Promise<WorkflowRow> {
  await getOwnedWorkflow(tenantId, workflowId);
  const db = getDb();
  await db
    .update(workflows)
    .set({
      ...(patch.nameFa !== undefined ? { nameFa: patch.nameFa.trim().slice(0, 190) } : {}),
      ...(patch.definition !== undefined ? { definitionJson: parseDefinition(patch.definition) } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled ? 1 : 0 } : {}),
    })
    .where(eq(workflows.id, workflowId));
  await audit({ action: 'workflow.update', actorId: tenantId, subjectType: 'workflow', subjectId: workflowId });
  return getOwnedWorkflow(tenantId, workflowId);
}

export async function deleteWorkflow(tenantId: string, workflowId: string): Promise<void> {
  await getOwnedWorkflow(tenantId, workflowId);
  const db = getDb();
  await db.delete(workflowRuns).where(eq(workflowRuns.workflowId, workflowId));
  await db.delete(workflows).where(eq(workflows.id, workflowId));
  await audit({ action: 'workflow.delete', actorId: tenantId, subjectType: 'workflow', subjectId: workflowId });
}

export async function setWorkflowEnabled(
  tenantId: string,
  workflowId: string,
  isEnabled: boolean
): Promise<WorkflowRow> {
  await getOwnedWorkflow(tenantId, workflowId);
  const db = getDb();
  await db.update(workflows).set({ isEnabled: isEnabled ? 1 : 0 }).where(eq(workflows.id, workflowId));
  await audit({
    action: isEnabled ? 'workflow.enable' : 'workflow.disable',
    actorId: tenantId,
    subjectType: 'workflow',
    subjectId: workflowId,
  });
  return getOwnedWorkflow(tenantId, workflowId);
}

export async function listWorkflowRuns(
  tenantId: string,
  workflowId: string,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  await getOwnedWorkflow(tenantId, workflowId);
  const db = getDb();
  const items = await db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      triggerKind: workflowRuns.triggerKind,
      triggerRef: workflowRuns.triggerRef,
      status: workflowRuns.status,
      stepsExecuted: workflowRuns.stepsExecuted,
      logJson: workflowRuns.logJson,
      errorCode: workflowRuns.errorCode,
      startedAt: workflowRuns.startedAt,
      finishedAt: workflowRuns.finishedAt,
    })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.tenantId, tenantId)))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.tenantId, tenantId)));
  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}
