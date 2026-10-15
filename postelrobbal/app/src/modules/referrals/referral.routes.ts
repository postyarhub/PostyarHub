import { FastifyInstance, FastifyRequest } from 'fastify';
import { myReferral, awardRegisterReward } from './referral.service.js';
import { AppError, ERR } from '../../core/errors.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

export async function registerReferralRoutes(app: FastifyInstance): Promise<void> {
  app.get('/referrals/me', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    // Self-healing backfill: any REGISTER reward missed at registration time
    // (worker outage, etc.) is granted here; exactly-once by unique key.
    await awardRegisterReward(me.id).catch(() => undefined);
    const summary = await myReferral(me.id);
    return { success: true, data: summary };
  });
}
