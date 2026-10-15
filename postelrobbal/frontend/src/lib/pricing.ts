/**
 * Client mirror of the server pricing engine (plan.service.computeSubscriptionPrice).
 * Cosmetic-only preview: the amount actually charged is recomputed
 * server-side at intent creation — this exists so the checkout modal and the
 * plan editor can show the same breakdown the server will apply.
 */
import type { PlanPricing } from './api';

export interface CheckoutPreview {
  list: number;
  durationPct: number;
  renewalPct: number;
  totalPct: number;
  discount: number;
  final: number;
}

export const MAX_TOTAL_DISCOUNT_PERCENT = 90;

/** Tolerant normalization of any stored shape (mirrors server normalizePlanPricing). */
export function normalizePricing(raw: PlanPricing | null | undefined): PlanPricing {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlanPricing>;
  const renewal = Number(src.renewalDiscountPercent);
  const durationSrc = src.durationDiscounts && typeof src.durationDiscounts === 'object' ? src.durationDiscounts : {};
  const durationDiscounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(durationSrc)) {
    const months = Number(k);
    const pct = Number(v);
    if (Number.isInteger(months) && months >= 1 && months <= 36 && Number.isInteger(pct) && pct >= 0 && pct <= 90) {
      durationDiscounts[String(months)] = pct;
    }
  }
  return {
    renewalDiscountPercent: Number.isInteger(renewal) && renewal >= 0 && renewal <= 90 ? renewal : 0,
    durationDiscounts,
  };
}

/** `hasActive` = buyer still holds an unexpired subscription (renewal/upgrade). */
export function computeCheckoutPreview(
  priceRial: number,
  pricing: PlanPricing | null | undefined,
  months: number,
  hasActive: boolean
): CheckoutPreview {
  const p = normalizePricing(pricing);
  const list = Math.max(0, Math.floor(priceRial || 0)) * Math.max(1, months);
  const durationPct = p.durationDiscounts[String(months)] ?? 0;
  const renewalPct = hasActive ? p.renewalDiscountPercent : 0;
  const totalPct = Math.min(MAX_TOTAL_DISCOUNT_PERCENT, durationPct + renewalPct);
  const discount = Math.floor((list * totalPct) / 100);
  return { list, durationPct, renewalPct, totalPct, discount, final: list - discount };
}
