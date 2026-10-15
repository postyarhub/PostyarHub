-- Additive WordPress/WooCommerce automation settings. Never removes existing data.
SET @has_channel_ids := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wordpress_sites' AND COLUMN_NAME='channel_ids_json'
);
SET @sql := IF(@has_channel_ids=0,
  'ALTER TABLE wordpress_sites ADD COLUMN channel_ids_json JSON NULL AFTER category_map_json',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_automation := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wordpress_sites' AND COLUMN_NAME='automation_json'
);
SET @sql := IF(@has_automation=0,
  'ALTER TABLE wordpress_sites ADD COLUMN automation_json JSON NULL AFTER channel_ids_json',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_message_style := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wordpress_sites' AND COLUMN_NAME='message_style'
);
SET @sql := IF(@has_message_style=0,
  "ALTER TABLE wordpress_sites ADD COLUMN message_style VARCHAR(32) NOT NULL DEFAULT 'shop' AFTER automation_json",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_send_image := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wordpress_sites' AND COLUMN_NAME='send_image'
);
SET @sql := IF(@has_send_image=0,
  'ALTER TABLE wordpress_sites ADD COLUMN send_image TINYINT NOT NULL DEFAULT 1 AFTER message_style',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE wordpress_sites
SET automation_json = COALESCE(automation_json,
  JSON_OBJECT('product_new', TRUE, 'product_price', FALSE, 'product_stock', FALSE, 'product_update', FALSE, 'post_new', FALSE, 'post_update', FALSE)
)
WHERE automation_json IS NULL;
