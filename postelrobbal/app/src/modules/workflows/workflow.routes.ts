import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, setWorkflowEnabled, listWorkflowRuns,
} from './workflow.service.js';

const ulidish = z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, 'شناسه معتبر نیست.');
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const createSchema = z.object({
  botId: ulidish,
  nameFa: z.string().min(1).max(190),
  definition: z.unknown(),
});
const updateSchema = z.object({
  nameFa: z.string().min(1).max(190).optional(),
  definition: z.unknown().optional(),
  isEnabled: z.boolean().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function mustTenantId(req: { user?: { id: string } }): string {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user.id;
}

function paramId(req: { params?: unknown }): string {
  const res = ulidish.safeParse((req.params as Record<string, unknown>)['id']);
  if (!res.success) throw new AppError(ERR.VALIDATION('شناسه معتبر نیست.'));
  return res.data;
}

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workflows', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const q = parse(paginationQuery, req.query);
    const result = await listWorkflows(tenantId, q.page, q.pageSize);
    return { success: true, data: result };
  });

  app.post('/workflows', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const input = parse(createSchema, req.body);
    const workflow = await createWorkflow(tenantId, input);
    return { success: true, data: { workflow } };
  });

  app.put('/workflows/:id', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = paramId(req);
    const input = parse(updateSchema, req.body);
    const workflow = await updateWorkflow(tenantId, id, input);
    return { success: true, data: { workflow } };
  });

  app.delete('/workflows/:id', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = paramId(req);
    await deleteWorkflow(tenantId, id);
    return { success: true, data: { deleted: true } };
  });

  app.post('/workflows/:id/enable', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = paramId(req);
    const workflow = await setWorkflowEnabled(tenantId, id, true);
    return { success: true, data: { workflow } };
  });

  app.post('/workflows/:id/disable', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = paramId(req);
    const workflow = await setWorkflowEnabled(tenantId, id, false);
    return { success: true, data: { workflow } };
  });

  app.get('/workflows/:id/runs', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = paramId(req);
    const q = parse(paginationQuery, req.query);
    const result = await listWorkflowRuns(tenantId, id, q.page, q.pageSize);
    return { success: true, data: result };
  });
}
