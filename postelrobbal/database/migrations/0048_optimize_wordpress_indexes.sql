-- Performance optimization: composite indexes for high-frequency tenant & site queries
ALTER TABLE wordpress_products
  ADD INDEX IF NOT EXISTS idx_wpprod_tenant_site (tenant_id, site_id, last_synced_at);

ALTER TABLE wordpress_contents
  ADD INDEX IF NOT EXISTS idx_wpcontent_tenant_site (tenant_id, site_id, created_at);
