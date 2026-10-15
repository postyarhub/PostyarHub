ALTER TABLE notification_outbound
  ADD COLUMN channel_id CHAR(26) NULL AFTER tenant_id;

ALTER TABLE notification_outbound
  DROP INDEX uq_notif_outbound,
  ADD UNIQUE KEY uq_notif_outbound (kind, subject_id, destination, channel_id),
  ADD INDEX idx_notif_out_channel (channel_id, state, updated_at);

-- Rows created by the pre-channel-scoped implementation cannot be mapped safely
-- when a tenant has multiple active channels on the same platform. Leave them
-- as legacy records; the scheduler creates correctly scoped rows on its next run.
UPDATE notification_outbound
SET state = 'SKIPPED',
    last_error = 'LEGACY_UNSCOPED_NOTIFICATION_REQUIRES_REQUEUE'
WHERE channel_id IS NULL
  AND destination IN ('TELEGRAM','BALE','RUBIKA')
  AND state = 'PENDING';
