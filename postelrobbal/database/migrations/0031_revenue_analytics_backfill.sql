-- Revenue analytics backfill: restore monetary/point values for events mirrored
-- before the revenue layer was enabled. Safe to re-run.
UPDATE analytics_events
SET value = CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.amountRial')) AS DECIMAL(20,0))
WHERE event_type = 'payment.completed'
  AND metadata_json IS NOT NULL
  AND JSON_EXTRACT(metadata_json, '$.amountRial') IS NOT NULL;

UPDATE analytics_events
SET value = CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.points')) AS DECIMAL(20,0))
WHERE event_type = 'referral.rewarded'
  AND metadata_json IS NOT NULL
  AND JSON_EXTRACT(metadata_json, '$.points') IS NOT NULL;
