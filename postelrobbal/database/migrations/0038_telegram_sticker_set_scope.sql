ALTER TABLE telegram_stickers
  DROP INDEX uq_tg_sticker_file,
  ADD UNIQUE KEY uq_tg_sticker_file (tenant_id, set_id, file_unique_id);
