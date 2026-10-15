-- Persist reusable inline buttons independently for each owned destination channel.
-- The button label is unique per channel: saving the same label updates its stored target.
CREATE TABLE `channel_saved_buttons` (
  `id` CHAR(26) NOT NULL,
  `tenant_id` CHAR(26) NOT NULL,
  `channel_id` CHAR(26) NOT NULL,
  `label` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_type` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_value` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_channel_saved_button_label` (`tenant_id`, `channel_id`, `label`),
  KEY `idx_channel_saved_buttons_scope` (`tenant_id`, `channel_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
