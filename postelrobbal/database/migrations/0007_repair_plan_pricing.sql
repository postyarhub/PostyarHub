-- Postyar migration 0007 — repair plan pricing JSON after migration 0005.
-- Migration 0005 added plans.pricing_json as NOT NULL after plans had already
-- been seeded by migration 0002. On non-strict MariaDB installations the
-- existing rows can receive an empty implicit value, which is not valid JSON.
-- Repair only invalid/missing values; preserve valid administrator-configured data.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

UPDATE plans
SET pricing_json = JSON_OBJECT(
  'renewalDiscountPercent', 0,
  'durationDiscounts', JSON_OBJECT()
)
WHERE pricing_json IS NULL
   OR JSON_VALID(pricing_json) = 0;
