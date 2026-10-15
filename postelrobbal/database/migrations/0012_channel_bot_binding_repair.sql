-- Repair channels left active without an explicit bot binding after the bot/channel binding hardening pass.
-- Only binds when exactly one ACTIVE bot exists for the same tenant/platform.
UPDATE channels c
JOIN (
  SELECT tenant_id, platform, MIN(id) AS bot_id
  FROM bots
  WHERE status = 'ACTIVE'
  GROUP BY tenant_id, platform
  HAVING COUNT(*) = 1
) b ON b.tenant_id = c.tenant_id AND b.platform = c.platform
SET c.bot_id = b.bot_id, c.updated_at = CURRENT_TIMESTAMP
WHERE c.bot_id IS NULL AND c.status = 'ACTIVE';
