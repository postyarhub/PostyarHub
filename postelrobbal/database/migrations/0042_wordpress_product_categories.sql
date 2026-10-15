-- Add source product taxonomy metadata for site-scoped catalog filters.
ALTER TABLE `wordpress_products`
  ADD COLUMN `categories_json` JSON NULL;
