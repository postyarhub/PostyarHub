-- Add WordPress post/page type and taxonomy metadata for article filters.
ALTER TABLE `wordpress_contents`
  ADD COLUMN `content_type` VARCHAR(32) NOT NULL DEFAULT 'post',
  ADD COLUMN `excerpt` TEXT NULL,
  ADD COLUMN `categories_json` JSON NULL;
