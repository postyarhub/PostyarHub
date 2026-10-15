-- WordPress site quotas per subscription plan. Additive and idempotent.
-- Professional: 1, Business: 5, Enterprise: 20 sites.
SET @has_plans := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
);
SET @sql := IF(@has_plans=0,
  'SELECT 1',
  "UPDATE plans
   SET limits_json = JSON_SET(COALESCE(limits_json, JSON_OBJECT()), '$.max_wordpress_sites',
     CASE code WHEN 'professional' THEN 1 WHEN 'business' THEN 5 WHEN 'enterprise' THEN 20 ELSE COALESCE(JSON_EXTRACT(limits_json, '$.max_wordpress_sites'), 0) END)
   WHERE code IN ('professional','business','enterprise')"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
