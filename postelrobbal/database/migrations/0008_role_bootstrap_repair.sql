-- Postyar migration 0008 — repair and permanently guard the first administrator.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Keep only the earliest existing administrator. This repairs databases where
-- historical registration logic accidentally granted SUPER_ADMIN to everyone.
UPDATE users
SET role = 'USER'
WHERE role = 'SUPER_ADMIN'
  AND id NOT IN (
    SELECT keep_id FROM (
      SELECT id AS keep_id FROM users
      WHERE role = 'SUPER_ADMIN'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    ) AS keeper
  );

-- Ensure the singleton bootstrap row points to the surviving administrator.
INSERT INTO role_bootstrap (id, user_id)
SELECT 1, u.id
FROM users u
WHERE u.role = 'SUPER_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM role_bootstrap WHERE id = 1)
ORDER BY u.created_at ASC, u.id ASC
LIMIT 1;

UPDATE role_bootstrap rb
JOIN (
  SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at ASC, id ASC LIMIT 1
) a ON 1=1
SET rb.user_id = a.id
WHERE rb.id = 1;

-- If a legacy DB contains users but no administrator, the earliest account becomes
-- the sole bootstrap owner before the DB guards are installed.
INSERT INTO role_bootstrap (id, user_id)
SELECT 1, u.id
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM role_bootstrap WHERE id = 1)
ORDER BY u.created_at ASC, u.id ASC
LIMIT 1;

UPDATE users u
JOIN role_bootstrap rb ON rb.id = 1 AND rb.user_id = u.id
SET u.role = 'SUPER_ADMIN', u.status = 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'SUPER_ADMIN');

-- The bootstrap administrator must always remain active. This also repairs a
-- legacy database where the administrator had previously been suspended.
UPDATE users u
JOIN role_bootstrap rb ON rb.id = 1 AND rb.user_id = u.id
SET u.role = 'SUPER_ADMIN', u.status = 'ACTIVE';

DROP TRIGGER IF EXISTS trg_users_super_admin_insert;
DROP TRIGGER IF EXISTS trg_users_super_admin_update;

-- No code path may create a second SUPER_ADMIN. The only legal INSERT role is the
-- account whose id is already stored as the singleton bootstrap owner.
CREATE TRIGGER trg_users_super_admin_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
  IF NEW.role = 'SUPER_ADMIN' AND NOT EXISTS (
    SELECT 1 FROM role_bootstrap rb WHERE rb.id = 1 AND rb.user_id = NEW.id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'مدیر ارشد فقط برای مالک اولیه مجاز است';
  END IF;
END;

-- The bootstrap administrator cannot be demoted or changed into another role.
-- A second user can never be promoted to SUPER_ADMIN.
CREATE TRIGGER trg_users_super_admin_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF NEW.role = 'SUPER_ADMIN' AND NOT EXISTS (
    SELECT 1 FROM role_bootstrap rb WHERE rb.id = 1 AND rb.user_id = NEW.id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'مدیر ارشد فقط برای مالک اولیه مجاز است';
  END IF;
  IF OLD.role = 'SUPER_ADMIN' AND NEW.role <> 'SUPER_ADMIN' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'نقش مدیر ارشد قابل تغییر نیست';
  END IF;
  IF OLD.role = 'SUPER_ADMIN' AND NEW.status <> 'ACTIVE' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'وضعیت مدیر ارشد قابل تعلیق یا غیرفعال‌سازی نیست';
  END IF;
END;
