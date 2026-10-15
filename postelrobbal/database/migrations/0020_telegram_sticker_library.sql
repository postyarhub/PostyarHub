-- Telegram sticker library. Additive and idempotent.
CREATE TABLE IF NOT EXISTS telegram_sticker_sets (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  telegram_name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  sticker_type VARCHAR(30) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tg_sticker_sets_tenant (tenant_id),
  UNIQUE KEY uq_tg_sticker_set (tenant_id, telegram_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS telegram_stickers (
  id CHAR(26) NOT NULL PRIMARY KEY,
  tenant_id CHAR(26) NOT NULL,
  set_id CHAR(26) NOT NULL,
  file_id VARCHAR(512) NOT NULL,
  file_unique_id VARCHAR(255) NOT NULL,
  sticker_type VARCHAR(30) NOT NULL,
  emoji VARCHAR(32) NULL,
  position_index INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tg_stickers_tenant (tenant_id),
  KEY idx_tg_stickers_set (set_id, position_index),
  UNIQUE KEY uq_tg_sticker_file (tenant_id, file_unique_id)
) ENGINE=InnoDB;
