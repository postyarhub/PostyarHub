-- Optional Bearer API token / key for authenticating with gold and currency price providers
ALTER TABLE gold_configs
  ADD COLUMN IF NOT EXISTS api_token VARCHAR(1024) NULL AFTER source_url;
