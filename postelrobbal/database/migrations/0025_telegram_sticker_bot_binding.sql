-- Keep the Telegram bot used to import each sticker set so file_id retrieval remains correct per bot.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'telegram_sticker_sets' AND column_name = 'bot_id'
);
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_sticker_sets ADD COLUMN bot_id CHAR(26) NULL AFTER tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'telegram_sticker_sets' AND index_name = 'idx_tg_sticker_sets_bot'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_tg_sticker_sets_bot ON telegram_sticker_sets (tenant_id, bot_id)', 'SELECT 1');
PREPARE stmt2 FROM @sql; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
