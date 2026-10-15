-- WordPress publishing editor, richer source snapshots, and message templates.
-- Additive/idempotent only. No destructive operations.

SET @has_regular_price := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='regular_price_rial');
SET @sql := IF(@has_regular_price=0, 'ALTER TABLE wordpress_products ADD COLUMN regular_price_rial BIGINT NULL AFTER price_rial', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_sale_price := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='sale_price_rial');
SET @sql := IF(@has_sale_price=0, 'ALTER TABLE wordpress_products ADD COLUMN sale_price_rial BIGINT NULL AFTER regular_price_rial', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_old_price := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='old_price_rial');
SET @sql := IF(@has_old_price=0, 'ALTER TABLE wordpress_products ADD COLUMN old_price_rial BIGINT NULL AFTER sale_price_rial', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_stock := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='stock_status');
SET @sql := IF(@has_stock=0, 'ALTER TABLE wordpress_products ADD COLUMN stock_status VARCHAR(30) NULL AFTER old_price_rial', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_sku := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='sku');
SET @sql := IF(@has_sku=0, 'ALTER TABLE wordpress_products ADD COLUMN sku VARCHAR(190) NULL AFTER stock_status', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_excerpt := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='excerpt');
SET @sql := IF(@has_excerpt=0, 'ALTER TABLE wordpress_products ADD COLUMN excerpt TEXT NULL AFTER sku', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_custom_title := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='custom_title');
SET @sql := IF(@has_custom_title=0, 'ALTER TABLE wordpress_products ADD COLUMN custom_title VARCHAR(255) NULL AFTER excerpt', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_custom_body := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='custom_body');
SET @sql := IF(@has_custom_body=0, 'ALTER TABLE wordpress_products ADD COLUMN custom_body TEXT NULL AFTER custom_title', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_custom_image := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_products' AND COLUMN_NAME='custom_image_url');
SET @sql := IF(@has_custom_image=0, 'ALTER TABLE wordpress_products ADD COLUMN custom_image_url VARCHAR(512) NULL AFTER custom_body', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_content_body := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='body');
SET @sql := IF(@has_content_body=0, 'ALTER TABLE wordpress_contents ADD COLUMN body TEXT NOT NULL AFTER title', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_permalink := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='permalink');
SET @sql := IF(@has_content_permalink=0, 'ALTER TABLE wordpress_contents ADD COLUMN permalink VARCHAR(512) NULL AFTER body', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_image := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='image_url');
SET @sql := IF(@has_content_image=0, 'ALTER TABLE wordpress_contents ADD COLUMN image_url VARCHAR(512) NULL AFTER permalink', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_custom_title := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='custom_title');
SET @sql := IF(@has_content_custom_title=0, 'ALTER TABLE wordpress_contents ADD COLUMN custom_title VARCHAR(255) NULL AFTER image_url', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_custom_body := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='custom_body');
SET @sql := IF(@has_content_custom_body=0, 'ALTER TABLE wordpress_contents ADD COLUMN custom_body TEXT NULL AFTER custom_title', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_content_custom_image := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wordpress_contents' AND COLUMN_NAME='custom_image_url');
SET @sql := IF(@has_content_custom_image=0, 'ALTER TABLE wordpress_contents ADD COLUMN custom_image_url VARCHAR(512) NULL AFTER custom_body', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS message_templates (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  body TEXT NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  is_default TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_msg_tpl_tenant (tenant_id),
  UNIQUE KEY uq_msg_tpl_name (tenant_id, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wordpress_campaigns (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  site_id CHAR(26) NOT NULL,
  name VARCHAR(120) NOT NULL,
  item_type VARCHAR(20) NOT NULL DEFAULT 'product',
  selection_type VARCHAR(40) NOT NULL DEFAULT 'latest',
  template_id CHAR(26) NULL,
  channel_ids_json JSON NULL,
  frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
  send_time VARCHAR(5) NOT NULL DEFAULT '12:00',
  days_json JSON NULL,
  item_count INT NOT NULL DEFAULT 3,
  is_enabled TINYINT NOT NULL DEFAULT 0,
  sent_ids_json JSON NULL,
  last_run_at DATETIME NULL,
  last_result_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wp_campaign_tenant (tenant_id),
  KEY idx_wp_campaign_due (is_enabled, send_time),
  UNIQUE KEY uq_wp_campaign_name (tenant_id, name)
) ENGINE=InnoDB;
