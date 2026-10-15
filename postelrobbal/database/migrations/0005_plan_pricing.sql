-- ============================================================================
-- Postyar migration 0005 — round 19: plan pricing & discounts.
-- Adds plans.pricing_json holding the round-19 discount model:
--   {
--     "renewalDiscountPercent": 0,          ← تخفیف تمدید/ارتقا (۰-۹۰)
--     "durationDiscounts": { "3": 5, ... }  ← تخفیف مدت خرید (ماه ← درصد)
--   }
-- Applied at payment-intent creation: duration discount always; renewal
-- discount only when the buyer still has an ACTIVE, unexpired subscription
-- (early renewal / upgrade — includes free-plan users before their free
-- period ends). Percentages are additive and capped at 90.
-- ============================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE plans
  ADD COLUMN pricing_json JSON NOT NULL AFTER features_json;
