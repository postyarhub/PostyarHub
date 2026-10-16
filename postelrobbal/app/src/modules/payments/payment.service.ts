import { and, desc, eq, count, or, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { payments, plans, referrals, referralRewards, media } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { runIdempotent } from '../../core/idempotency.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { loadEnv } from '../../config/env.js';
import { ZarinpalAdapter } from '../../providers/payments/zarinpal.js';
import type { PaymentGatewayAdapter } from '../../providers/payments/zarinpal.js';
import { ZibalAdapter } from '../../providers/payments/zibal.js';
import { IdpayAdapter } from '../../providers/payments/idpay.js';
import { WinaPayAdapter } from '../../providers/payments/winapay.js';
import type { PaymentSettingsSnapshot } from './payment-settings.service.js';
import { activateSubscriptionTx, computeSubscriptionPrice, hasUnexpiredSubscription } from '../subscriptions/plan.service.js';
import type { Tx } from '../subscriptions/plan.service.js';
import { moveMoneyTx, pointCreditTx } from '../wallet/wallet.service.js';
import { getPaymentSettings } from './payment-settings.service.js';
import { getReferralSettings } from '../admin/system-settings.service.js';

export const POINT_TO_RIAL = 10; // ۱ امتیاز = ۱۰ ریال
const WALLET_TOPUP_MIN = 100_000; // Rial

const ONLINE_PROVIDERS = ['zibal', 'zarinpal', 'idpay', 'winapay'] as const;
type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];

interface ResolvedGateway {
  provider: OnlineProvider;
  credential: string;
  sandbox: boolean;
}

/**
 * Resolves the active gateway from the admin-configured settings. The env
 * PAYMENT_MERCHANT_ID stays as a fallback for zibal/zarinpal so legacy deploys
 * keep working; idpay has no env fallback (panel-issued API key only).
 */
function resolveGateway(provider: string, settings: PaymentSettingsSnapshot): ResolvedGateway {
  const env = loadEnv();
  const sandboxDefault = env.NODE_ENV !== 'production';
  const envMerchant = (env.PAYMENT_MERCHANT_ID ?? '').trim();
  switch (provider) {
    case 'zibal': {
      const cfg = settings.gateways.zibal;
      return {
        provider: 'zibal',
        credential: (cfg.merchantId || envMerchant).trim(),
        sandbox: cfg.sandbox ?? sandboxDefault,
      };
    }
    case 'idpay': {
      const cfg = settings.gateways.idpay;
      return { provider: 'idpay', credential: cfg.apiKey.trim(), sandbox: cfg.sandbox ?? sandboxDefault };
    }
    case 'winapay': {
      const cfg = settings.gateways.winapay;
      return { provider: 'winapay', credential: cfg.merchantId.trim(), sandbox: false };
    }
    default: {
      const cfg = settings.gateways.zarinpal;
      return {
        provider: 'zarinpal',
        credential: (cfg.merchantId || envMerchant).trim(),
        sandbox: cfg.sandbox ?? sandboxDefault,
      };
    }
  }
}

/**
 * Async gateway factory (settings-driven; admin-panel v2).
 * Reads the admin-configured provider + credentials and returns the matching
 * adapter. An optional `hint` (the payment's stored gateway column) pins the
 * adapter to the provider that created the payment, so a provider switch
 * between creation and callback cannot break verification.
 * Guard: when the resolved credential is empty and there is no usable fallback
 * (zibal sandbox may degrade to the public test merchant 'zibal'), throw the
 * stable Persian GATEWAY_NOT_CONFIGURED — before any IO or DB write.
 */
export async function gatewayFor(hint?: string): Promise<PaymentGatewayAdapter> {
  const settings = await getPaymentSettings();
  const provider = hint && (ONLINE_PROVIDERS as readonly string[]).includes(hint) ? hint : settings.provider;
  const resolved = resolveGateway(provider, settings);
  const unconfigured = !resolved.credential && !(resolved.provider === 'zibal' && resolved.sandbox);
  if (unconfigured) throw new AppError(ERR.GATEWAY_NOT_CONFIGURED());
  switch (resolved.provider) {
    case 'zibal':
      return new ZibalAdapter(resolved.credential, resolved.sandbox);
    case 'idpay':
      return new IdpayAdapter(resolved.credential, resolved.sandbox);
    case 'winapay':
      return new WinaPayAdapter(resolved.credential);
    default:
      return new ZarinpalAdapter(resolved.credential, resolved.sandbox);
  }
}

export interface CreatedPaymentResult {
  paymentId: string;
  redirectUrl: string;
}

async function createPaymentRow(input: {
  tenantId: string;
  purpose: 'SUBSCRIPTION' | 'WALLET_TOPUP';
  planId: string | null;
  months: number;
  amountRial: number;
  description: string;
  metaJson?: Record<string, unknown>;
}): Promise<CreatedPaymentResult> {
  const db = getDb();
  const env = loadEnv();
  const id = newId();
  const gw = await gatewayFor();

  let chargeAmountRial = input.amountRial;
  let persistedMeta = input.metaJson;
  if (gw.id === 'winapay') {
    if (input.purpose === 'WALLET_TOPUP' && chargeAmountRial % 10 !== 0) {
      throw new AppError(ERR.VALIDATION('برای پرداخت ویناپی، مبلغ شارژ باید مضربی از ۱۰ ریال باشد.'));
    }
    if (input.purpose === 'SUBSCRIPTION') {
      // WinaPay accepts whole Toman only. Store, verify, credit and display the
      // exact Rial amount that the gateway actually charges, never the
      // pre-rounded amount that would cause a payment/ledger mismatch.
      chargeAmountRial = Math.floor(chargeAmountRial / 10) * 10;
      if (chargeAmountRial < 1_000) {
        throw new AppError(ERR.VALIDATION('حداقل مبلغ قابل پرداخت با ویناپی ۱۰۰ تومان است.'));
      }
      const adjustment = input.amountRial - chargeAmountRial;
      if (adjustment > 0) {
        const meta: Record<string, unknown> = { ...(input.metaJson ?? {}), providerRoundingAdjustmentRial: adjustment };
        const pricing = meta['pricing'];
        if (pricing && typeof pricing === 'object' && !Array.isArray(pricing)) {
          const p = pricing as Record<string, unknown>;
          const listAmount = Number(p['listAmountRial'] ?? input.amountRial);
          meta['pricing'] = {
            ...p,
            finalAmountRial: chargeAmountRial,
            discountAmountRial: Math.max(0, listAmount - chargeAmountRial),
            providerRoundingAdjustmentRial: adjustment,
          };
        }
        persistedMeta = meta;
      }
    }
  }

  const created = await gw.createPayment({
    amountRial: chargeAmountRial,
    description: input.description,
    callbackUrl: `${env.API_URL}/api/v1/payments/callback?paymentId=${id}`,
  });
  await db.insert(payments).values({
    id,
    tenantId: input.tenantId,
    purpose: input.purpose,
    planId: input.planId,
    months: input.months,
    amountRial: chargeAmountRial,
    gateway: gw.id,
    authority: created.authority,
    state: 'CREATED',
    metaJson: persistedMeta,
  });
  await emitEvent({
    name: 'payment.created',
    tenantId: input.tenantId,
    subjectType: 'payment',
    subjectId: id,
    props: { purpose: input.purpose, amountRial: chargeAmountRial },
  });
  return { paymentId: id, redirectUrl: created.redirectUrl };
}

/**
 * Subscription purchase payment (plan must be active; free plan has no checkout).
 * Round 19: the chargeable amount is the plan's list price × months minus the
 * applicable discounts (duration discount always; renewal/upgrade discount
 * when the buyer still has an unexpired subscription). The full breakdown is
 * persisted in payments.meta_json for the admin payment popup.
 */
export async function createSubscriptionPayment(
  tenantId: string,
  planCode: string,
  months: number
): Promise<CreatedPaymentResult> {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, planCode), eq(plans.isActive, 1)))
    .limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));

  const price = computeSubscriptionPrice(plan, months, await hasUnexpiredSubscription(tenantId));
  if (price.listAmountRial <= 0) throw new AppError(ERR.VALIDATION('این پلن رایگان است.'));

  return createPaymentRow({
    tenantId,
    purpose: 'SUBSCRIPTION',
    planId: plan.id,
    months,
    amountRial: price.finalAmountRial,
    description: 'خرید اشتراک پُست‌یار',
    metaJson: { pricing: price },
  });
}

// ---------------------------------------------------------------------------
// Payment intents (contract 14-contract item 3): one entry point for the two
// payment methods. Online uses the selected configured online provider;
// card_to_card creates a PENDING_REVIEW payment reviewed by an admin.
// ---------------------------------------------------------------------------

export interface SubscriptionIntentInput {
  planId: string;
  method: 'online' | 'card_to_card' | 'wallet';
  months?: number;
}

export type SubscriptionIntentResult =
  | { paymentId: string; redirectUrl: string }
  | { paymentId: string; reference: string; cards: Array<{ id: string; bankName: string; cardNumber: string; holderName: string }> }
  | { paymentId: string; subscriptionId: string; balanceAfter: number; activated: true };

/** Accepts a plan id (ULID) or, for convenience, its unique code. */
async function findActivePlan(planIdOrCode: string) {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, 1), or(eq(plans.id, planIdOrCode), eq(plans.code, planIdOrCode))))
    .limit(1);
  return plan ?? null;
}

export async function createSubscriptionIntent(
  tenantId: string,
  input: SubscriptionIntentInput
): Promise<SubscriptionIntentResult> {
  const settings = await getPaymentSettings();
  if (input.method === 'online' && !settings.onlineEnabled) {
    throw new AppError(ERR.PAYMENT_METHOD_DISABLED());
  }
  if (input.method === 'card_to_card' && !settings.cardToCardEnabled) {
    throw new AppError(ERR.PAYMENT_METHOD_DISABLED());
  }

  const months = input.months ?? 1;
  const plan = await findActivePlan(input.planId);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  // Round 19: server-authoritative discount computation (the client preview is
  // cosmetic only — the amount charged is always recomputed here).
  const price = computeSubscriptionPrice(plan, months, await hasUnexpiredSubscription(tenantId));
  if (price.listAmountRial <= 0) {
    throw new AppError(ERR.VALIDATION('این پلن رایگان است و نیازی به پرداخت ندارد.'));
  }

  if (input.method === 'wallet') {
    const db = getDb();
    const paymentId = newId();
    const paymentMeta = { method: 'wallet', pricing: price };
    const applied = await db.transaction(async (tx) => {
      await tx.insert(payments).values({
        id: paymentId,
        tenantId,
        purpose: 'SUBSCRIPTION',
        planId: plan.id,
        months,
        amountRial: price.finalAmountRial,
        gateway: 'wallet',
        state: 'COMPLETED',
        verifiedAt: new Date(),
        metaJson: paymentMeta,
      });

      const movement = await moveMoneyTx(
        tx,
        tenantId,
        'DEBIT',
        price.finalAmountRial,
        { type: 'payment', id: paymentId },
        'خرید اشتراک از کیف پول'
      );
      const activated = await activateSubscriptionTx(tx, tenantId, plan.id, months);
      await referralHookFirstPurchase(tenantId, price.finalAmountRial, tx);
      return { activated, balanceAfter: movement.balanceAfter };
    });

    if (!applied.activated?.subscriptionId) throw new AppError(ERR.INTERNAL());
    await emitEvent({
      name: 'payment.completed',
      tenantId,
      subjectType: 'payment',
      subjectId: paymentId,
      props: {
        purpose: 'SUBSCRIPTION',
        amountRial: price.finalAmountRial,
        method: 'wallet',
        subscriptionId: applied.activated.subscriptionId,
      },
    });
    await emitEvent({
      name: applied.activated.renewed ? 'subscription.renewed' : 'subscription.created',
      tenantId,
      subjectType: 'subscription',
      subjectId: applied.activated.subscriptionId,
      props: { planCode: applied.activated.planCode, months, renewed: applied.activated.renewed },
    });
    await audit({
      action: 'payment.verified',
      actorId: tenantId,
      subjectType: 'payment',
      subjectId: paymentId,
      meta: {
        purpose: 'SUBSCRIPTION',
        amountRial: price.finalAmountRial,
        gateway: 'wallet',
        method: 'wallet',
        subscriptionId: applied.activated.subscriptionId,
      },
    });

    return {
      paymentId,
      subscriptionId: applied.activated.subscriptionId,
      balanceAfter: applied.balanceAfter,
      activated: true,
    };
  }

  if (input.method === 'online') {
    // Graceful degradation when the gateway is unconfigured (sandbox path).
    // gatewayFor() enforces the same guard without any IO — this early check
    // avoids creating the payment row when no provider is configured.
    await gatewayFor();
    const result = await createSubscriptionPayment(tenantId, plan.code, months);
    return { paymentId: result.paymentId, redirectUrl: result.redirectUrl };
  }

  // card_to_card: no gateway involved — always works.
  const db = getDb();
  const id = newId();
  const reference = newId();
  await db.insert(payments).values({
    id,
    tenantId,
    purpose: 'SUBSCRIPTION',
    planId: plan.id,
    months,
    amountRial: price.finalAmountRial,
    gateway: 'card_to_card',
    reference,
    state: 'PENDING_REVIEW',
    metaJson: { method: 'card_to_card', reference, pricing: price },
  });
  await emitEvent({
    name: 'payment.created',
    tenantId,
    subjectType: 'payment',
    subjectId: id,
    props: { purpose: 'SUBSCRIPTION', amountRial: price.finalAmountRial, method: 'card_to_card' },
  });
  return { paymentId: id, reference, cards: settings.cards };
}

export interface ReceiptUpload {
  mediaId: string;
  note?: string | null;
}

/**
 * Attaches the uploaded receipt to a PENDING_REVIEW card-to-card payment.
 * Ownership: the payment must belong to the session tenant (missing or
 * foreign payments are indistinguishable 404s — §180 no existence leak).
 * Idempotency: a second upload is rejected (the first receipt stands until
 * an admin reviews it).
 */
export async function attachReceipt(
  tenantId: string,
  paymentId: string,
  upload: ReceiptUpload
): Promise<{ paymentId: string; status: 'PENDING_REVIEW' }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || payment.tenantId !== tenantId) throw new AppError(ERR.NOT_FOUND('پرداخت'));
  if (payment.receiptMediaId) {
    throw new AppError(ERR.CONFLICT('رسید این پرداخت قبلاً بارگذاری شده است و قابل تغییر نیست.'));
  }
  if (payment.state !== 'PENDING_REVIEW') {
    throw new AppError(ERR.CONFLICT('این پرداخت در مرحلهٔ انتظار رسید نیست.'));
  }

  const [receiptMedia] = await db
    .select({ id: media.id, mime: media.mime, sizeBytes: media.sizeBytes })
    .from(media)
    .where(and(eq(media.id, upload.mediaId), eq(media.tenantId, tenantId)))
    .limit(1);
  if (!receiptMedia) throw new AppError(ERR.NOT_FOUND('رسید'));
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(receiptMedia.mime) || Number(receiptMedia.sizeBytes) > 5 * 1024 * 1024) {
    throw new AppError(ERR.VALIDATION('فرمت یا حجم رسید معتبر نیست.'));
  }

  const metaJson: Record<string, unknown> = { ...(payment.metaJson ?? {}) };
  if (upload.note && upload.note.trim() !== '') metaJson.receiptNote = upload.note.trim().slice(0, 500);

  const res = await db
    .update(payments)
    .set({ receiptMediaId: upload.mediaId, receiptNote: upload.note?.trim().slice(0, 500) || null, metaJson })
    .where(and(eq(payments.id, payment.id), eq(payments.state, 'PENDING_REVIEW')));
  const changed = Array.isArray(res) ? Number(res[0]?.affectedRows ?? 0) : Number((res as { affectedRows?: number })?.affectedRows ?? 0);
  if (changed === 0) {
    throw new AppError(ERR.CONFLICT('رسید این پرداخت قبلاً بارگذاری شده است و قابل تغییر نیست.'));
  }

  await audit({ action: 'payment.receipt_uploaded', actorId: tenantId, subjectType: 'payment', subjectId: payment.id });
  return { paymentId: payment.id, status: 'PENDING_REVIEW' };
}

/** Wallet top-up payment. When online is disabled and card-to-card is enabled,
 * the method is selected automatically. */
export async function createWalletTopup(
  tenantId: string,
  amountRial: number,
  requestedMethod?: 'online' | 'card_to_card',
): Promise<CreatedPaymentResult | { paymentId: string; reference: string; cards: Array<{ id: string; bankName: string; cardNumber: string; holderName: string }> }> {
  if (!Number.isInteger(amountRial) || amountRial < WALLET_TOPUP_MIN) {
    throw new AppError(ERR.VALIDATION('حداقل مبلغ شارژ کیف پول ۱۰۰٬۰۰۰ ریال است.'));
  }
  const settings = await getPaymentSettings();
  // The wallet must remain usable when an old/cached client still posts
  // method=online while online payment is disabled or unconfigured.
  // In that situation card-to-card is the deterministic fallback.
  let method = requestedMethod ?? (settings.onlineEnabled ? 'online' : 'card_to_card');
  if (method === 'online' && !settings.onlineEnabled && settings.cardToCardEnabled && settings.cards.length > 0) {
    method = 'card_to_card';
  }

  if (method === 'online') {
    if (!settings.onlineEnabled) throw new AppError(ERR.PAYMENT_METHOD_DISABLED());
    return createPaymentRow({
      tenantId,
      purpose: 'WALLET_TOPUP',
      planId: null,
      months: 1,
      amountRial,
      description: 'شارژ کیف پول پُست‌یار',
    });
  }

  if (!settings.cardToCardEnabled) throw new AppError(ERR.PAYMENT_METHOD_DISABLED());
  if (settings.cards.length === 0) {
    throw new AppError(ERR.VALIDATION('هنوز کارت مقصدی برای پرداخت کارت‌به‌کارت توسط مدیریت ثبت نشده است.'));
  }

  const db = getDb();
  const id = newId();
  const reference = newId();
  await db.insert(payments).values({
    id,
    tenantId,
    purpose: 'WALLET_TOPUP',
    planId: null,
    months: 1,
    amountRial,
    gateway: 'card_to_card',
    reference,
    state: 'PENDING_REVIEW',
    metaJson: { method: 'card_to_card', reference },
  });
  await emitEvent({
    name: 'payment.created',
    tenantId,
    subjectType: 'payment',
    subjectId: id,
    props: { purpose: 'WALLET_TOPUP', amountRial, method: 'card_to_card' },
  });
  await audit({ action: 'payment.created', actorId: tenantId, subjectType: 'payment', subjectId: id, meta: { method: 'card_to_card' } });
  return { paymentId: id, reference, cards: settings.cards };
}

export interface CallbackQuery {
  paymentId: string;
  Authority?: string;
  Status?: string;
  /** Zibal callback mirrors the trackId we stored as authority. */
  trackId?: string;
  /** IDPay returns its transaction id as `id` in the callback. */
  id?: string;
  /** Lowercase gateway-specific status param (zibal/idpay send `status`). */
  status?: string;
}

export interface CallbackResult {
  ok: boolean;
  message: string;
}

/**
 * Referral first-purchase hook (§36): a configured PERCENT of the payment as
 * POINTS for the referrer (round 17 hardcoded 10%), exactly-once per referral
 * via uq_referral_rewards. Honors the round-18 master referral toggle.
 * Must never break the payment path — every failure is swallowed and logged.
 */
export async function referralHookFirstPurchase(tenantId: string, amountRial: number, tx?: Tx): Promise<void> {
  // Best-effort settings read (plain read on system_settings — no locks the
  // surrounding payment transaction could conflict with). On any failure the
  // built-in defaults (enabled=true, 10%) keep the historical behavior.
  let referralEnabled = true;
  let percent = 10;
  try {
    const settings = await getReferralSettings();
    referralEnabled = settings.enabled;
    percent = settings.firstPurchasePercent;
  } catch {
    // settings read failure must NOT fail the payment — fall back to defaults
  }
  if (!referralEnabled) return; // master toggle off → no reward at all
  try {
    if (tx) {
      await applyFirstPurchaseReward(tx, tenantId, amountRial, percent);
    } else {
      const db = getDb();
      await db.transaction((t) => applyFirstPurchaseReward(t, tenantId, amountRial, percent));
    }
  } catch (err) {
    // The referral reward is best-effort; it must never fail the payment.
    audit({ action: 'referral.reward_failed', subjectType: 'user', subjectId: tenantId, meta: { reason: String((err as Error).message).slice(0, 120) } }).catch(
      () => undefined
    );
  }
}

async function applyFirstPurchaseReward(tx: Tx, tenantId: string, amountRial: number, percent: number): Promise<void> {
  const [referral] = await tx
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredTenantId, tenantId), eq(referrals.state, 'REGISTERED')))
    .limit(1);
  if (!referral) return;

  const points = Math.floor((amountRial * percent) / 100 / POINT_TO_RIAL); // درصد پاداش خرید اول به امتیاز
  if (points <= 0) return;

  try {
    await tx.insert(referralRewards).values({
      id: newId(),
      referralId: referral.id,
      rewardKind: 'FIRST_PURCHASE',
      amount: points,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) return; // idempotent
    throw err;
  }

  await pointCreditTx(tx, referral.referrerTenantId, points, { type: 'referral_first_purchase', id: referral.id }, 'پاداش اولین خرید زیرمجموعه');
  await tx.update(referrals).set({ state: 'REWARDED' }).where(eq(referrals.id, referral.id));

  await emitEvent({
    name: 'referral.rewarded',
    tenantId: referral.referrerTenantId,
    subjectType: 'referral',
    subjectId: referral.id,
    props: { rewardKind: 'FIRST_PURCHASE', points },
  });
  await audit({
    action: 'referral.first_purchase_reward',
    actorId: tenantId,
    subjectType: 'referral',
    subjectId: referral.id,
    meta: { points },
  });
}

/**
 * Gateway callback (§117): real server-side verification via
 * gateway.verifyPayment — the browser-reported status is never trusted.
 * Wrapped in durable idempotency (scope payment_verify, 24h). All financial
 * side effects happen in the same transaction as the VERIFIED flip.
 */
class CallbackNotSettled extends Error {
  constructor(readonly result: CallbackResult) {
    super('PAYMENT_CALLBACK_NOT_SETTLED');
  }
}

export async function handleCallback(q: CallbackQuery): Promise<CallbackResult> {
  // Browser redirects are untrusted. They may trigger a gateway verification,
  // but a negative status must never itself mutate the payment or be cached as
  // a terminal result. Failed verification releases the idempotency key so a
  // later callback can be rechecked against the provider.
  try {
    const { replayed, value } = await runIdempotent<CallbackResult>(
      'payment_verify',
      q.paymentId,
      86_400,
      async () => {
        const result = await verifyAndSettle(q);
        if (!result.ok) throw new CallbackNotSettled(result);
        return result;
      }
    );
    if (replayed && value.ok) {
      return { ok: true, message: 'پرداخت شما پیش‌تر تأیید و اعمال شده است.' };
    }
    return value;
  } catch (err) {
    if (err instanceof CallbackNotSettled) return err.result;
    if (err instanceof Error && err.message === 'IDEMPOTENCY_IN_PROGRESS') {
      return { ok: false, message: 'پردازش این پرداخت در حال انجام است. نتیجه به‌زودی اعمال می‌شود.' };
    }
    if (err instanceof AppError && err.code === 'NOT_FOUND') {
      return { ok: false, message: 'پرداخت مورد نظر یافت نشد.' };
    }
    return { ok: false, message: 'تأیید پرداخت ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگردانده می‌شود.' };
  }
}

async function verifyAndSettle(q: CallbackQuery): Promise<CallbackResult> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, q.paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));

  // Callback authenticity boundary: before any callback status can mutate
  // the payment, the gateway-returned transaction identifier must match the
  // authority that was stored when this payment was created. This is required
  // even for negative statuses; otherwise anyone who learns a paymentId could
  // forge `status=failed` / `Status=NOK` and cancel the payment without proof
  // that the gateway actually produced that callback.
  const reportedAuthority = (q.Authority ?? q.trackId ?? q.id)?.trim();
  if (!payment.authority || !reportedAuthority || reportedAuthority.toUpperCase() !== payment.authority.trim().toUpperCase()) {
    throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
  }

  // Already settled (browser refresh / duplicate redirect)
  if (payment.state === 'VERIFIED') {
    return { ok: true, message: 'پرداخت شما قبلاً تأیید شده است.' };
  }
  if (payment.state === 'CANCELLED' || payment.state === 'REFUNDED') {
    return { ok: false, message: 'این پرداخت قابل تأیید نیست.' };
  }

  // Gateway-reported status. WinaPay requires PaymentStatus=OK before Verify.
  // Zarinpal sends Status=OK|NOK; zibal/idpay send a gateway-specific `status`.
  // Negative/invalid reports fail immediately; other gateways retain their
  // existing server-side verification path (§117 — the browser is never trusted).
  const reported = (q.Status ?? q.status ?? '').trim().toLowerCase();
  // WinaPay explicitly requires PaymentStatus=OK before Verification.
  // Unknown/missing statuses must never be treated as authorization to settle.
  if (payment.gateway === 'winapay' && reported !== 'ok') {
    // A non-OK or missing browser-reported status is not terminal. Do not
    // mutate payment state; only a valid positive callback can reach the
    // gateway's server-side verification below.
    return { ok: false, message: 'وضعیت بازگشت از ویناپی معتبر نیست.' };
  }
  if (!payment.authority) throw new AppError(ERR.PAYMENT_VERIFY_FAILED());

  // Verify with the SAME provider that created this payment (payments.gateway
  // column), so admin provider switches never break in-flight verifications.
  const gw = await gatewayFor(payment.gateway);
  const verified = await gw.verifyPayment(Number(payment.amountRial), payment.authority);
  if (!verified.ok) {
    await db
      .update(payments)
      .set({ state: 'FAILED', metaJson: { ...(payment.metaJson ?? {}), gatewayCode: verified.code } })
      .where(and(eq(payments.id, payment.id), eq(payments.state, payment.state)));
    await emitEvent({ name: 'payment.failed', tenantId: payment.tenantId, subjectType: 'payment', subjectId: payment.id });
    return { ok: false, message: 'تأیید پرداخت نزد درگاه ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگردانده می‌شود.' };
  }

  let applied = false;
  const activationState: { value: Awaited<ReturnType<typeof activateSubscriptionTx>> | null } = { value: null };
  await db.transaction(async (tx) => {
    const flipped = await tx
      .update(payments)
      .set({ state: 'VERIFIED', verifiedAt: new Date(), gatewayRef: verified.refId ?? null })
      // FAILED can mean an earlier verification attempt was inconclusive.
      // Only an affirmative server-to-server result reaches this transition;
      // atomic state matching still guarantees that financial side effects run once.
      .where(and(eq(payments.id, payment.id), inArray(payments.state, ['CREATED', 'REDIRECTED', 'FAILED'])));
    const affected = Array.isArray(flipped) ? Number(flipped[0]?.affectedRows ?? 0) : Number((flipped as { affectedRows?: number }).affectedRows ?? 0);
    if (affected !== 1) return;
    applied = true;

    if (payment.purpose === 'SUBSCRIPTION' && payment.planId) {
      activationState.value = await activateSubscriptionTx(tx, payment.tenantId, payment.planId, payment.months);
      await referralHookFirstPurchase(payment.tenantId, Number(payment.amountRial), tx);
    } else if (payment.purpose === 'WALLET_TOPUP') {
      await moveMoneyTx(tx, payment.tenantId, 'CREDIT', Number(payment.amountRial), { type: 'payment', id: payment.id }, 'شارژ کیف پول');
    }
  });
  if (!applied) {
    if (payment.state === 'COMPLETED') return { ok: true, message: 'پرداخت شما قبلاً تأیید و اعمال شده است.' };
    return { ok: false, message: 'این پرداخت قبلاً پردازش شده یا دیگر قابل تأیید نیست.' };
  }

  const activated = activationState.value;
  await emitEvent({
    name: 'payment.completed',
    tenantId: payment.tenantId,
    subjectType: 'payment',
    subjectId: payment.id,
    props: { purpose: payment.purpose, amountRial: Number(payment.amountRial), refId: verified.refId },
  });
  if (activated) {
    await emitEvent({
      name: activated.renewed ? 'subscription.renewed' : 'subscription.created',
      tenantId: payment.tenantId,
      subjectType: 'subscription',
      subjectId: activated.subscriptionId,
      props: { planCode: activated.planCode, months: payment.months, renewed: activated.renewed, paymentId: payment.id },
    });
  }
  await audit({
    action: 'payment.verified',
    actorId: payment.tenantId,
    subjectType: 'payment',
    subjectId: payment.id,
    meta: { purpose: payment.purpose, amountRial: Number(payment.amountRial), gateway: payment.gateway },
  });

  return {
    ok: true,
    message: payment.purpose === 'SUBSCRIPTION' ? 'پرداخت با موفقیت انجام و اشتراک شما فعال شد.' : 'پرداخت با موفقیت انجام و کیف پول شما شارژ شد.',
  };
}

export interface PaymentListItem {
  id: string;
  purpose: string;
  planId: string | null;
  months: number;
  amountRial: number;
  gateway: string;
  state: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

export async function listPayments(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: PaymentListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, Math.floor(page));
  const size = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const [totalRow] = await db.select({ value: count() }).from(payments).where(eq(payments.tenantId, tenantId));
  const rows = await db
    .select({
      id: payments.id,
      purpose: payments.purpose,
      planId: payments.planId,
      months: payments.months,
      amountRial: payments.amountRial,
      gateway: payments.gateway,
      state: payments.state,
      verifiedAt: payments.verifiedAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.tenantId, tenantId))
    .orderBy(desc(payments.createdAt))
    .limit(size)
    .offset((p - 1) * size);

  return {
    items: rows.map((r) => ({ ...r, amountRial: Number(r.amountRial) })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}
