-- Durable WordPress content idempotency. Additive only.
SET @has_table := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wordpress_contents'
);
SET @sql := IF(@has_table=0,
  'CREATE TABLE wordpress_contents (
    id CHAR(26) NOT NULL PRIMARY KEY,
    site_id CHAR(26) NOT NULL,
    tenant_id CHAR(26) NOT NULL,
    content_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    post_id CHAR(26) NOT NULL,
    last_published_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wpcontent (site_id, content_id)
  ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
