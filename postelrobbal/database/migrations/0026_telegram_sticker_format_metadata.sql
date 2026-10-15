-- Telegram sticker format/preview metadata. Additive and idempotent.
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'width');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN width INT NULL AFTER emoji', 'SELECT 1');
PREPARE s1 FROM @sql; EXECUTE s1; DEALLOCATE PREPARE s1;
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'height');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN height INT NULL AFTER width', 'SELECT 1');
PREPARE s2 FROM @sql; EXECUTE s2; DEALLOCATE PREPARE s2;
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'is_animated');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN is_animated TINYINT NOT NULL DEFAULT 0 AFTER height', 'SELECT 1');
PREPARE s3 FROM @sql; EXECUTE s3; DEALLOCATE PREPARE s3;
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'is_video');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN is_video TINYINT NOT NULL DEFAULT 0 AFTER is_animated', 'SELECT 1');
PREPARE s4 FROM @sql; EXECUTE s4; DEALLOCATE PREPARE s4;
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'thumbnail_file_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN thumbnail_file_id VARCHAR(512) NULL AFTER is_video', 'SELECT 1');
PREPARE s5 FROM @sql; EXECUTE s5; DEALLOCATE PREPARE s5;
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'telegram_stickers' AND column_name = 'custom_emoji_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE telegram_stickers ADD COLUMN custom_emoji_id VARCHAR(255) NULL AFTER thumbnail_file_id', 'SELECT 1');
PREPARE s6 FROM @sql; EXECUTE s6; DEALLOCATE PREPARE s6;
