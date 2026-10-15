import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { getWalletSummary, convertPoints } from './wallet.service.js';
import { parseWith } from '../../core/validation.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const convertSchema = z.object({
  points: z.coerce.number().int().min(100).max(1_000_000),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerWalletRoutes(app: FastifyInstance): Promise<void> {
  app.get('/wallet', { preHandler: [app.requireAuth] }, async (req) => {
    const summary = await getWalletSummary(auth(req).id);
    return { success: true, data: summary };
  });

  app.post('/wallet/convert-points', { preHandler: [app.requireAuth] }, async (req) => {
    const input = parse(convertSchema, req.body);
    const result = await convertPoints(auth(req).id, input.points);
    return { success: true, data: result };
  });
}
