-- WordPress/WooCommerce campaigns: up to three delivery times per schedule.
-- Additive and idempotent. `send_time` remains the primary/first time for compatibility.
SET @has_send_times := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wordpress_campaigns'
    AND COLUMN_NAME = 'send_times_json'
);
SET @sql := IF(
  @has_send_times = 0,
  'ALTER TABLE wordpress_campaigns ADD COLUMN send_times_json JSON NULL AFTER send_time',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
