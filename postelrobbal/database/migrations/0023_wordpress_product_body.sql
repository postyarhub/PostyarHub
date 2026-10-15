-- Add full WooCommerce product description so dashboard can use the original content.
SET @t := 'wordpress_products';
SET @c := 'body';
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = @c) = 0,
  'ALTER TABLE wordpress_products ADD COLUMN body TEXT NULL AFTER excerpt',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
