CREATE TABLE IF NOT EXISTS `channel_saved_footers` (
  `id` CHAR(26) NOT NULL,
  `tenant_id` CHAR(26) NOT NULL,
  `channel_id` CHAR(26) NOT NULL,
  `content` VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `content_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_channel_saved_footer_hash` (`tenant_id`, `channel_id`, `content_hash`),
  KEY `idx_channel_saved_footers_scope` (`tenant_id`, `channel_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
