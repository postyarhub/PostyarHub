-- Extra WooCommerce metadata for campaign selection. Additive/idempotent only.
SET @has_featured := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='is_featured');
SET @sql := IF(@has_featured=0, 'ALTER TABLE wordpress_products ADD COLUMN is_featured TINYINT NOT NULL DEFAULT 0 AFTER stock_status', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_sales_count := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='sales_count');
SET @sql := IF(@has_sales_count=0, 'ALTER TABLE wordpress_products ADD COLUMN sales_count INT NOT NULL DEFAULT 0 AFTER is_featured', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
