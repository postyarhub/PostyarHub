-- Postyar migration 0009 — normalize historical DB-generated DATETIME values to UTC.
SET NAMES utf8mb4;
SET @postyar_server_offset_seconds := TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW());
SET time_zone = '+00:00';

UPDATE `users` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `users` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `sessions` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `password_reset_tokens` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `plans` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `subscriptions` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `subscriptions` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `channels` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `channels` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `bots` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `bots` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `bot_users` SET `first_seen_at` = DATE_SUB(`first_seen_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `first_seen_at` IS NOT NULL;
UPDATE `bot_users` SET `last_seen_at` = DATE_SUB(`last_seen_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `last_seen_at` IS NOT NULL;
UPDATE `bot_commands` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `bot_keywords` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `workflows` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `workflows` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `bot_events` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `media` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `posts` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `posts` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `post_targets` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `post_targets` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `outbox_events` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `idempotency_keys` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `ai_jobs` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `wordpress_sites` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `gold_configs` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `gold_snapshots` SET `captured_at` = DATE_SUB(`captured_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `captured_at` IS NOT NULL;
UPDATE `payments` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `payments` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `wallet_accounts` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `wallet_ledger` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `point_ledger` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `referrals` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `referral_rewards` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `notifications` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `notification_outbound` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `events` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `media_access_tokens` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `audit_logs` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `tickets` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `tickets` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `ticket_messages` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `ticket_message_attachments` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;
UPDATE `system_settings` SET `updated_at` = DATE_SUB(`updated_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `updated_at` IS NOT NULL;
UPDATE `link_clicks` SET `created_at` = DATE_SUB(`created_at`, INTERVAL @postyar_server_offset_seconds SECOND) WHERE `created_at` IS NOT NULL;

-- Deliberately untouched: posts.scheduled_at; subscription started_at/expires_at/cancelled_at; payment review/verification
-- timestamps; and every Date explicitly supplied by application/business logic.
