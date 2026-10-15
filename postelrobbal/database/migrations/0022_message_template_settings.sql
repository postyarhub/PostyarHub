-- Friendly, structured message templates. Additive/idempotent only.
SET @has_settings := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND COLUMN_NAME='settings_json');
SET @sql := IF(@has_settings=0, 'ALTER TABLE message_templates ADD COLUMN settings_json JSON NULL AFTER body', 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
