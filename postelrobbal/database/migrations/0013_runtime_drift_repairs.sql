-- Runtime drift repair (non-destructive).
-- 1) Some deployed databases observed from runtime logs are missing bot_events.created_at
--    even though the canonical 0001 schema requires it. Repair only when absent.
-- 2) Scope wallet ledger idempotency by tenant to prevent cross-tenant ref collisions.

SET @bot_events_created_at_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_events' AND COLUMN_NAME = 'created_at'
);
SET @bot_events_created_at_sql := IF(
  @bot_events_created_at_exists = 0,
  'ALTER TABLE bot_events ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'SELECT 1'
);
PREPARE postyar_stmt FROM @bot_events_created_at_sql;
EXECUTE postyar_stmt;
DEALLOCATE PREPARE postyar_stmt;

SET @wallet_ref_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_ledger' AND INDEX_NAME = 'uq_ledger_ref'
);
SET @wallet_drop_index_sql := IF(
  @wallet_ref_index_exists = 1,
  'ALTER TABLE wallet_ledger DROP INDEX uq_ledger_ref',
  'SELECT 1'
);
PREPARE postyar_stmt2 FROM @wallet_drop_index_sql;
EXECUTE postyar_stmt2;
DEALLOCATE PREPARE postyar_stmt2;

SET @wallet_new_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_ledger' AND INDEX_NAME = 'uq_ledger_tenant_ref'
);
SET @wallet_add_index_sql := IF(
  @wallet_new_index_exists = 0,
  'ALTER TABLE wallet_ledger ADD UNIQUE KEY uq_ledger_tenant_ref (tenant_id, ref_type, ref_id, entry_kind)',
  'SELECT 1'
);
PREPARE postyar_stmt3 FROM @wallet_add_index_sql;
EXECUTE postyar_stmt3;
DEALLOCATE PREPARE postyar_stmt3;
