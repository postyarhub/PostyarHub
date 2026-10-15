import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { consumeAiQuota, generateAiSync, getAiJob, getAiUsage, requestAiCaption } from './ai.service.js';
import { parseWith } from '../../core/validation.js';

const captionSchema = z.object({ text: z.string().min(1).max(4000) });
const generateSchema = z.object({
  text: z.string().min(1).max(4000),
  system: z.string().min(1).max(4000).optional(),
});
const idParam = z.object({ id: z.string().regex(/^[0-9A-HJKMNP-TV-Za-z]{26}$/, 'شناسه معتبر نیست.') });

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function mustTenantId(req: { user?: { id: string } }): string {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user.id;
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  // Caption generation is queued; the frontend polls GET /ai/jobs/:jobId.
  app.post('/ai/caption', { preHandler: app.requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (req) => req.user?.id ?? req.ip } } }, async (req) => {
    const tenantId = mustTenantId(req);
    const input = parse(captionSchema, req.body);
    const { jobId } = await requestAiCaption(tenantId, input.text);
    return { success: true, data: { jobId } };
  });

  app.get('/ai/jobs/:id', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const { id } = parse(idParam, req.params);
    const job = await getAiJob(tenantId, id);
    return { success: true, data: { job } };
  });

  app.get('/ai/usage', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const usage = await getAiUsage(tenantId);
    return { success: true, data: usage };
  });

  // Synchronous small completion for settings testing — quota-guarded, 30s.
  app.post('/ai/generate', { preHandler: app.requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.user?.id ?? req.ip } } }, async (req) => {
    const tenantId = mustTenantId(req);
    const input = parse(generateSchema, req.body);
    const result = await generateAiSync(tenantId, { ...(input.system ? { system: input.system } : {}), text: input.text });
    return { success: true, data: { text: result.text, provider: result.provider } };
  });
}
