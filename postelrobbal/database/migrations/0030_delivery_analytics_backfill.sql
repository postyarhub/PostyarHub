-- Backfill delivery outcomes from the current post_targets read model.
-- This complements 0029 (legacy events) so the unified delivery metrics have a
-- baseline immediately after rollout. The dedupe key makes the migration repeatable.

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at, post_id, target_id, channel_id,
  campaign_id, platform, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(SHA2(CONCAT('delivery:', pt.id, ':sent'), 256), 26),
  pt.tenant_id,
  'post.delivery.sent',
  COALESCE(pt.sent_at, pt.updated_at),
  pt.post_id,
  pt.id,
  pt.channel_id,
  NULL,
  c.platform,
  LOWER(p.source),
  1,
  JSON_OBJECT('attempts', pt.attempts, 'backfill', true),
  CONCAT('delivery:backfill:sent:', pt.id)
FROM post_targets pt
INNER JOIN posts p ON p.id = pt.post_id
INNER JOIN channels c ON c.id = pt.channel_id
WHERE pt.state = 'SENT'
  AND NOT EXISTS (SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('delivery:backfill:sent:', pt.id));

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at, post_id, target_id, channel_id,
  campaign_id, platform, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(SHA2(CONCAT('delivery:', pt.id, ':failed'), 256), 26),
  pt.tenant_id,
  'post.delivery.failed',
  pt.updated_at,
  pt.post_id,
  pt.id,
  pt.channel_id,
  NULL,
  c.platform,
  LOWER(p.source),
  1,
  JSON_OBJECT('attempts', pt.attempts, 'errorCode', pt.error_code, 'errorMessage', pt.error_message, 'backfill', true),
  CONCAT('delivery:backfill:failed:', pt.id)
FROM post_targets pt
INNER JOIN posts p ON p.id = pt.post_id
INNER JOIN channels c ON c.id = pt.channel_id
WHERE pt.state = 'FAILED'
  AND NOT EXISTS (SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('delivery:backfill:failed:', pt.id));
