PostYar Analytics — Final Entity Drill-down Integration

Scope
- User Profile 360 consumes the unified tenant analytics entity summaries plus automation metrics.
- Top posts link to the existing PostDetail route and therefore reuse the existing per-post delivery/event analytics.
- WooCommerce/WordPress Campaign Center adds a per-campaign analytics drill-down using the existing GET /api/v1/analytics/campaigns/:id endpoint.
- No database migration.
- No backend endpoint changes.
- No deletion or replacement of existing public assets.

Deployment
1. Backup app/src and frontend/src.
2. Unzip at project root.
3. cd frontend && npm run build.
4. cp -a frontend/dist/. /home/postyarh/public_html/
5. touch api/tmp/restart.txt

This patch is additive and intentionally preserves the current campaign controls and visual structure.
