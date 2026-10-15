# PostYar Content & Campaign Center — Manual Picker

This release completes the explicit item-selection workflow for WordPress/WooCommerce campaigns.

## Included
- Manual selection for up to 20 WooCommerce products or WordPress articles per campaign.
- Searchable product picker and article picker inside the existing Campaign Center.
- Persistent `selection_ids_json` storage on `wordpress_campaigns`.
- `selectionType=manual` supported by campaign creation/update and scheduler/forced runs.
- Tenant-safe picker APIs:
  - `GET /api/v1/wordpress/products?page=1&pageSize=100&siteId=...&q=...`
  - `GET /api/v1/wordpress/contents?page=1&pageSize=100&siteId=...&q=...`
- Existing automatic selection modes, templates, shortcode catalog, channels, analytics and UI structure are preserved.
- New migration: `0033_campaign_manual_selection.sql`.

## Validation
- Backend `npm run typecheck`: PASS
- Backend `npm run build`: PASS
- Frontend `wordpressTools.ts` TypeScript syntax parse: PASS
- Full frontend dependency install/build was not rerun in the sandbox because the package-install transport timed out; the production host remains the authoritative frontend build environment.
