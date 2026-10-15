-- Repair Unicode storage for tables introduced without an explicit charset.
-- ALTER/CONVERT retains rows and indexes; no rows are deleted or rewritten by app code.
-- The older migrations are intentionally preserved unchanged.

ALTER TABLE `wordpress_contents`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `message_templates`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `wordpress_campaigns`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve the indexed platform identifiers' existing charset/collation while
-- enabling Persian set titles and full 4-byte Unicode emoji storage.
ALTER TABLE `telegram_sticker_sets`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `telegram_sticker_sets`
  MODIFY `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `telegram_stickers`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `telegram_stickers`
  MODIFY `emoji` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
