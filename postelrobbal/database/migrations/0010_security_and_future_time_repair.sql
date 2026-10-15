-- Postyar migration 0010 — immutable user deletion + repair timestamps
-- accidentally created in the server-local timezone before the UTC session fix.
SET NAMES utf8mb4;
SET @postyar_server_offset_seconds := TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW());
SET time_zone = '+00:00';

DROP TRIGGER IF EXISTS trg_users_delete_block;
CREATE TRIGGER trg_users_delete_block
BEFORE DELETE ON users
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'حذف حساب کاربری از سامانه مجاز نیست';
END;

-- Only repair DB-generated audit/creation timestamps that are demonstrably in
-- the future relative to UTC. Never touch scheduled_at or business dates chosen
-- by the user. The +5 minute guard prevents modifying legitimate clock-skew
-- boundaries by a few seconds.
UPDATE users SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE users SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE posts SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE posts SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE post_targets SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE post_targets SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE audit_logs SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE workflows SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE workflows SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE bots SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE bots SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE channels SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE channels SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE media SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE payments SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE payments SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE notifications SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE events SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE tickets SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE tickets SET updated_at = DATE_SUB(updated_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE ticket_messages SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE ai_jobs SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE referrals SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE referral_rewards SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE wordpress_sites SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE point_ledger SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE wallet_ledger SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
UPDATE link_clicks SET created_at = DATE_SUB(created_at, INTERVAL @postyar_server_offset_seconds SECOND)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);

-- Deliberately untouched: posts.scheduled_at and all explicit business times.
