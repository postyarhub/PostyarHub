-- Backfill AI job and workflow run telemetry into the unified analytics event stream.
-- Idempotent by deterministic dedupe_key values. No credentials or payload bodies are copied.

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at,
  target_id, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  j.tenant_id,
  'ai.requested',
  j.created_at,
  NULL,
  'queue_backfill',
  1,
  JSON_OBJECT('purpose', j.purpose, 'provider', j.provider, 'source', 'queue_backfill'),
  CONCAT('ai:', j.id, ':requested')
FROM ai_jobs j
WHERE j.created_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('ai:', j.id, ':requested')
  );

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at,
  source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  j.tenant_id,
  'ai.completed',
  j.finished_at,
  'queue_backfill',
  1,
  JSON_OBJECT(
    'purpose', j.purpose,
    'provider', j.provider,
    'source', 'queue_backfill',
    'promptTokens', COALESCE(j.prompt_tokens, 0),
    'completionTokens', COALESCE(j.completion_tokens, 0),
    'tokenCount', COALESCE(j.prompt_tokens, 0) + COALESCE(j.completion_tokens, 0)
  ),
  CONCAT('ai:', j.id, ':completed')
FROM ai_jobs j
WHERE j.status = 'COMPLETED'
  AND j.finished_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('ai:', j.id, ':completed')
  );

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at,
  source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  j.tenant_id,
  'ai.failed',
  j.finished_at,
  'queue_backfill',
  1,
  JSON_OBJECT(
    'purpose', j.purpose,
    'provider', j.provider,
    'source', 'queue_backfill',
    'errorCode', COALESCE(j.error_code, 'AI_FAILED')
  ),
  CONCAT('ai:', j.id, ':failed')
FROM ai_jobs j
WHERE j.status = 'FAILED'
  AND j.finished_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('ai:', j.id, ':failed')
  );

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at,
  target_id, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  r.tenant_id,
  'workflow.started',
  r.started_at,
  r.workflow_id,
  'workflow_backfill',
  1,
  JSON_OBJECT('triggerKind', r.trigger_kind, 'source', 'workflow_backfill'),
  CONCAT('workflow:', r.id, ':started')
FROM workflow_runs r
WHERE r.started_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('workflow:', r.id, ':started')
  );

INSERT INTO analytics_events (
  id, user_id, event_type, occurred_at,
  target_id, source, value, metadata_json, dedupe_key
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  r.tenant_id,
  CASE WHEN r.status = 'COMPLETED' THEN 'workflow.completed' ELSE 'workflow.failed' END,
  r.finished_at,
  r.workflow_id,
  'workflow_backfill',
  1,
  JSON_OBJECT(
    'status', r.status,
    'source', 'workflow_backfill',
    'stepsExecuted', COALESCE(r.steps_executed, 0),
    'errorCode', COALESCE(r.error_code, ''),
    'durationMs', CASE WHEN r.started_at IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, r.started_at, r.finished_at) DIV 1000 ELSE 0 END
  ),
  CONCAT('workflow:', r.id, ':', LOWER(r.status))
FROM workflow_runs r
WHERE r.finished_at IS NOT NULL
  AND r.status IN ('COMPLETED', 'FAILED', 'TIMEOUT', 'ABORTED')
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events a WHERE a.dedupe_key = CONCAT('workflow:', r.id, ':', LOWER(r.status))
  );
