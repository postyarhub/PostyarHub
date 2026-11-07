-- Preserve exact delivery identity and text-message location for safe provider-side edits.
ALTER TABLE post_targets
  ADD COLUMN provider_bot_id CHAR(26) NULL AFTER provider_message_id,
  ADD COLUMN provider_chat_ref VARCHAR(190) NULL AFTER provider_bot_id,
  ADD COLUMN provider_text_message_id VARCHAR(190) NULL AFTER provider_chat_ref,
  ADD COLUMN provider_text_kind ENUM('TEXT', 'CAPTION') NULL AFTER provider_text_message_id,
  ADD COLUMN provider_text TEXT NULL AFTER provider_text_kind,
  ADD COLUMN provider_parse_mode ENUM('NONE', 'HTML', 'MARKDOWN') NOT NULL DEFAULT 'NONE' AFTER provider_text,
  ADD COLUMN edited_at DATETIME NULL AFTER sent_at,
  ADD COLUMN edit_state ENUM('IDLE', 'PROCESSING') NOT NULL DEFAULT 'IDLE' AFTER edited_at,
  ADD COLUMN edit_lock_until DATETIME NULL AFTER edit_state,
  ADD COLUMN edit_error_code VARCHAR(80) NULL AFTER edit_lock_until,
  ADD COLUMN edit_error_message VARCHAR(255) NULL AFTER edit_error_code;
