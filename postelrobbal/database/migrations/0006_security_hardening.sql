-- Postyar migration 0006 — security/concurrency hardening
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Singleton claim row for transactional first-user SUPER_ADMIN bootstrap.
-- Runtime registration never creates DDL; all schema exists before traffic.
CREATE TABLE role_bootstrap (
  id      TINYINT NOT NULL PRIMARY KEY,
  user_id CHAR(26) NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve an existing administrator when upgrading an already-populated DB.
INSERT INTO role_bootstrap (id, user_id)
SELECT 1, id FROM users
WHERE role = 'SUPER_ADMIN'
ORDER BY created_at ASC, id ASC
LIMIT 1;

-- Cleanup of the historical placeholder card number. Production payment cards
-- must be configured by an administrator, never shipped as a seed.
UPDATE system_settings
SET value_json = JSON_ARRAY()
WHERE setting_key = 'cardToCardCards'
  AND value_json LIKE '%ویرایش از پنل مدیریت%';

-- Retention/cleanup indices for high-volume transient tables.
ALTER TABLE password_reset_tokens
  ADD KEY idx_prt_expires_used (expires_at, used_at);

ALTER TABLE sessions
  ADD KEY idx_sessions_expiry_revoked (expires_at, revoked_at);
