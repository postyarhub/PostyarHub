-- Postyar 0014 — one in-app subscription-expiry warning per subscription.
-- Also removes the rows/jobs created by the old 2-minute repeating implementation.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

DELETE FROM notifications WHERE kind = 'SUBSCRIPTION_EXPIRY_7D';
DELETE FROM notification_outbound WHERE kind = 'SUBSCRIPTION_EXPIRY_7D';

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'subject_id'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE notifications ADD COLUMN subject_id CHAR(26) NULL AFTER kind',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'notifications' AND index_name = 'uq_notif_subject'
);
SET @sql := IF(@index_exists = 0,
  'ALTER TABLE notifications ADD UNIQUE KEY uq_notif_subject (tenant_id, kind, subject_id)',
  'SELECT 1');
PREPARE stmt2 FROM @sql; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
