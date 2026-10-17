-- Preserve the legacy single-media pointer while storing ordered media collections.
ALTER TABLE posts
  ADD COLUMN media_ids_json JSON NULL AFTER media_id;
