import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { referrals, referralRewards, users } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { emitEvent } from '../../core/events.js';
import { referralCodeFor } from '../auth/auth.service.js';
import { pointCreditTx, getPointsBalance } from '../wallet/wallet.service.js';
import { getReferralSettings } from '../admin/system-settings.service.js';

/** Fallback register reward — overridden by the admin setting key 'referral'. */
export const REGISTER_REWARD_POINTS = 100;

export interface ReferralSummary {
  code: string;
  referred: Array<{ firstName: string; joinedAt: Date }>;
  rewards: Array<{ id: string; rewardKind: 'REGISTER' | 'FIRST_PURCHASE'; amount: number; createdAt: Date }>;
  totalPoints: number;
  pointsBalance: number;
  pendingCount: number;
}

/** Own referral dashboard (privacy: first name + date only — §173). */
export async function myReferral(tenantId: string): Promise<ReferralSummary> {
  const db = getDb();
  const code = referralCodeFor(tenantId);

  const rows = await db
    .select({
      referralId: referrals.id,
      firstName: users.firstName,
      createdAt: referrals.createdAt,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.referredTenantId))
    .where(eq(referrals.referrerTenantId, tenantId))
    .orderBy(desc(referrals.createdAt))
    .limit(200);

  const rewardRows = await db
    .select({
      id: referralRewards.id,
      referralId: referralRewards.referralId,
      rewardKind: referralRewards.rewardKind,
      amount: referralRewards.amount,
      createdAt: referralRewards.createdAt,
    })
    .from(referralRewards)
    .innerJoin(referrals, eq(referrals.id, referralRewards.referralId))
    .where(eq(referrals.referrerTenantId, tenantId))
    .orderBy(desc(referralRewards.createdAt))
    .limit(200);

  const rewardedReferrals = new Set(rewardRows.map((r) => r.referralId));

  return {
    code,
    referred: rows.map((r) => ({ firstName: r.firstName, joinedAt: r.createdAt })),
    rewards: rewardRows.map((r) => ({
      id: r.id,
      rewardKind: r.rewardKind,
      amount: r.amount,
      createdAt: r.createdAt,
    })),
    totalPoints: rewardRows.reduce((sum, r) => sum + r.amount, 0),
    pointsBalance: await getPointsBalance(tenantId),
    pendingCount: rows.filter((r) => !rewardedReferrals.has(r.referralId)).length,
  };
}

/**
 * Registration reward: points per REGISTERED referral, exactly-once via
 * uq_referral_rewards(referral_id, reward_kind). Never flips the referral
 * state — REWARDED is reserved for the first-purchase reward.
 */
export async function awardRegisterReward(referrerTenantId: string): Promise<number> {
  const db = getDb();
  const pending = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.referrerTenantId, referrerTenantId), eq(referrals.state, 'REGISTERED')))
    .limit(50);

  let awarded = 0;
  for (const referral of pending) {
    awarded += await awardRegisterRewardForReferral(referral.id, referrerTenantId);
  }
  return awarded;
}

/**
 * Round 17: admin-configurable register reward (system_settings key 'referral',
 * field registerRewardPoints, 0..100000; round 18 adds the master `enabled`
 * toggle). Value resolution + validation now live in system-settings.service
 * (getReferralSettings) — same guards, same REGISTER_REWARD_POINTS default.
 */

/** Award for one specific referral row; idempotent (unique key + pre-check). */
export async function awardRegisterRewardForReferral(referralId: string, referrerTenantId: string): Promise<number> {
  const db = getDb();
  const [existing] = await db
    .select({ id: referralRewards.id })
    .from(referralRewards)
    .where(and(eq(referralRewards.referralId, referralId), eq(referralRewards.rewardKind, 'REGISTER')))
    .limit(1);
  if (existing) return 0;

  // Round 18: the master referral toggle. When disabled, NO reward row is
  // created — exactly-once semantics are preserved for re-enabling later.
  const settings = await getReferralSettings();
  if (!settings.enabled) return 0;
  const points = settings.registerRewardPoints;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(referralRewards).values({
        id: newId(),
        referralId,
        rewardKind: 'REGISTER',
        amount: points,
      });
      await pointCreditTx(tx, referrerTenantId, points, { type: 'referral_register', id: referralId }, 'پاداش معرفی کاربر جدید');
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) return 0; // idempotent
    throw err;
  }

  await emitEvent({
    name: 'referral.rewarded',
    tenantId: referrerTenantId,
    subjectType: 'referral',
    subjectId: referralId,
    props: { rewardKind: 'REGISTER', points },
  });
  return points;
}
