-- Delivery reliability and explicit channel/bot binding.
-- Applied after 0010_security_and_future_time_repair.sql.

CREATE INDEX idx_channels_tenant_bot_status
  ON channels (tenant_id, bot_id, status);

CREATE INDEX idx_bots_tenant_platform_status_created
  ON bots (tenant_id, platform, status, created_at);

CREATE INDEX idx_pt_state_updated
  ON post_targets (state, updated_at);

CREATE INDEX idx_pt_post_state_updated
  ON post_targets (post_id, state, updated_at);

CREATE INDEX idx_outbox_state_attempts_created
  ON outbox_events (state, attempts, created_at);
