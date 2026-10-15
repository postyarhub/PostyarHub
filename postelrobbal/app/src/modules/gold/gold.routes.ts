import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { getGoldConfig, saveGoldConfig, runNow } from './gold.service.js';
import { parseWith } from '../../core/validation.js';

function actor(req: { user?: { id: string; role: string }; ip?: string }) {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { tenantId: req.user.id, actorId: req.user.id, actorRole: req.user.role, ip: req.ip };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

const configSchema = z.object({
  sourceUrl: z.string().url().max(512),
  templateText: z.string().min(1).max(4000),
  channelIds: z.array(z.string().min(10).max(26)).max(20),
  frequencyMinutes: z.number().int().min(15).max(1440),
  timezone: z.string().max(64).default('Asia/Tehran'),
  changeOnly: z.boolean().default(true),
  isEnabled: z.boolean().default(false),
});

export async function registerGoldRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gold/config', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const config = await getGoldConfig(tenantId);
    return { success: true, data: { config } };
  });

  app.put('/gold/config', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const input = parse(configSchema, req.body);
    const config = await saveGoldConfig(tenantId, input);
    return { success: true, data: { config } };
  });

  app.post('/gold/run', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const result = await runNow(tenantId);
    return { success: true, data: { result } };
  });
}
