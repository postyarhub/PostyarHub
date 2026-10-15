ALTER TABLE wordpress_campaigns
  ADD COLUMN selection_ids_json JSON NULL AFTER selection_type;
