-- Postyar migration 0014 — WinaPay gateway configuration slot.
-- Additive/idempotent: never overwrites existing gateway credentials.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO system_settings (setting_key, value_json)
VALUES (
  'paymentGateways',
  '{"winapay":{"merchantId":""}}'
)
ON DUPLICATE KEY UPDATE value_json = JSON_SET(
  value_json,
  '$.winapay',
  COALESCE(JSON_EXTRACT(value_json, '$.winapay'), JSON_OBJECT('merchantId', ''))
);
