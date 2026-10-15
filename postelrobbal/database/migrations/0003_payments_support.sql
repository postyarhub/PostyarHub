-- ============================================================================
-- Postyar migration 0003 — card-to-card payment review flow, ticket message
-- attachments, and admin-togglable payment gateway settings.
-- Conventions follow 0001: InnoDB, utf8mb4/unicode_ci, CHAR(26) ULID PKs,
-- created_at DATETIME DEFAULT CURRENT_TIMESTAMP.
-- ============================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- 1) payments — review workflow states + receipt/review columns
--    Existing enum values keep their order; new states are appended
--    (append-only ENUM modification is index-safe for existing rows).
--    PENDING_REVIEW : card-to-card intent awaiting admin review
--    COMPLETED      : card-to-card payment approved by admin (terminal)
--    REJECTED       : receipt rejected by admin (terminal)
--    reference      : human-shareable ULID returned to the payer at intent time
-- ---------------------------------------------------------------------------
ALTER TABLE payments
  MODIFY COLUMN state ENUM(
    'CREATED','REDIRECTED','VERIFIED','FAILED','CANCELLED','REFUNDED',
    'PENDING_REVIEW','REJECTED','COMPLETED'
  ) NOT NULL DEFAULT 'CREATED',
  ADD COLUMN reference        CHAR(26)     NULL AFTER authority,
  ADD COLUMN receipt_media_id CHAR(26)     NULL AFTER meta_json,
  ADD COLUMN receipt_note     VARCHAR(500) NULL AFTER receipt_media_id,
  ADD COLUMN reviewed_by      CHAR(26)     NULL AFTER receipt_note,
  ADD COLUMN reviewed_at      DATETIME     NULL AFTER reviewed_by,
  ADD UNIQUE KEY uq_payments_reference (reference),
  ADD KEY idx_payments_state_created (state, created_at),
  ADD CONSTRAINT fk_payments_receipt_media
    FOREIGN KEY (receipt_media_id) REFERENCES media (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2) ticket message attachments — one attachment per message
--    (uq_tatt_message enforces the 1:1 contract; the API accepts a single
--    "file" part per message). Rows cascade away with their message; a
--    deleted media row also removes the attachment row (no orphans).
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_message_attachments (
  id          CHAR(26) NOT NULL,
  message_id  CHAR(26) NOT NULL,
  media_id    CHAR(26) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  size_bytes  BIGINT NOT NULL,
  mime        VARCHAR(120) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tatt_message (message_id),
  KEY idx_tatt_media (media_id),
  CONSTRAINT fk_tatt_message FOREIGN KEY (message_id) REFERENCES ticket_messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_tatt_media   FOREIGN KEY (media_id)    REFERENCES media (id)          ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3) payment gateway settings (admin-togglable)
--    Stored as native JSON documents in system_settings.value_json, one key
--    per setting, mirroring the API field names:
--      paymentOnlineEnabled     : JSON boolean
--      paymentCardToCardEnabled : JSON boolean
--      paymentProvider          : JSON string  ('zarinpal')
--      cardToCardCards          : JSON array of {id,bankName,cardNumber,holderName}
--    The seeded card is a placeholder the admin edits from the panel.
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (setting_key, value_json) VALUES
('paymentOnlineEnabled', 'true'),
('paymentCardToCardEnabled', 'true'),
('paymentProvider', '"zarinpal"'),
('cardToCardCards', '[{"id":"01HCARD0000000000000ADMIN1","bankName":"بانک ملت","cardNumber":"6104337812345678","holderName":"ویرایش از پنل مدیریت"}]')
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);
