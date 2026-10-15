-- Mirror legacy events into analytics_events exactly once.
-- The legacy event id is used as the deterministic dedupe key; generated IDs are
-- deterministic SHA-256 prefixes to keep the migration repeatable.
INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at, post_id, target_id, channel_id,
  campaign_id, link_id, platform, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(SHA2(CAST(e.id AS CHAR), 256), 26) AS id,
  e.tenant_id,
  LEFT(e.name, 64),
  e.created_at,
  CASE WHEN e.subject_type = 'post' THEN e.subject_id ELSE JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.postId')) END,
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.targetId')),
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.channelId')),
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.campaignId')),
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.linkId')),
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.platform')),
  JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.source')),
  COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.props_json, '$.value')) AS SIGNED), 1),
  CAST(e.props_json AS CHAR),
  CONCAT('legacy:', e.id)
FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('legacy:', e.id)
);
