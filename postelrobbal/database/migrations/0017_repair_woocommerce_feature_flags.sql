-- Repair the baseline WooCommerce feature flags for plans that are intended
-- to include the integration. This is additive/non-destructive and leaves
-- free/basic plans unchanged.
SET @has_plans := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
);
SET @sql := IF(@has_plans=0,
  'SELECT 1',
  'UPDATE plans SET features_json = JSON_SET(COALESCE(features_json, JSON_OBJECT()), ''$.woocommerce'', TRUE) WHERE code IN (''professional'',''business'',''enterprise'')'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
