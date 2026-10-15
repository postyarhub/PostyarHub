-- Postyar WordPress content editor: store uploaded custom media by ID.
-- Additive and idempotent only.
SET @has_product_custom_media_id := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='custom_image_media_id');
SET @sql := IF(@has_product_custom_media_id=0, 'ALTER TABLE wordpress_products ADD COLUMN custom_image_media_id CHAR(26) NULL AFTER custom_image_url', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_custom_media_id := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='custom_image_media_id');
SET @sql := IF(@has_content_custom_media_id=0, 'ALTER TABLE wordpress_contents ADD COLUMN custom_image_media_id CHAR(26) NULL AFTER custom_image_url', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
