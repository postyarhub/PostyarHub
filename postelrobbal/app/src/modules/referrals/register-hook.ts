import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { referrals } from '../../db/schema.js';
import { awardRegisterRewardForReferral } from './referral.service.js';

/**
 * Registration side-effect (§36): when a referred user completes
 * registration, the referrer earns the one-time REGISTER reward (100 points).
 * Idempotent via uq_referral_rewards(referral_id, 'REGISTER'); failures are
 * swallowed — registration must never break because of the reward.
 */
export async function onUserRegistered(userId: string): Promise<void> {
  const db = getDb();
  const [referral] = await db
    .select({ id: referrals.id, referrerTenantId: referrals.referrerTenantId })
    .from(referrals)
    .where(and(eq(referrals.referredTenantId, userId), eq(referrals.state, 'REGISTERED')))
    .limit(1);
  if (!referral) return;
  await awardRegisterRewardForReferral(referral.id, referral.referrerTenantId);
}
