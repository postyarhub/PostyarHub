# PostYar Analytics — Payments / Subscription / Referral Layer

Date: 2026-10-02

## Scope
- Map `payment.completed` values to Rial without polluting event counts.
- Emit `subscription.created` / `subscription.renewed` after payment settlement.
- Emit `payment.completed` for admin-approved card-to-card payments.
- Emit `payment.failed` for rejected manual-review payments.
- Backfill historical analytics event values from payment/referral metadata.
- Surface revenue/subscription/referral KPIs in tenant, admin, and Profile 360 analytics.
- Add Postman contract request for `/api/v1/analytics/revenue`.

## Migration
- `0031_revenue_analytics_backfill.sql`
- Depends on Analytics Core (`0028`) and Delivery/Analytics (`0030`).
- Safe to re-run.

## Validation performed
- Backend `npm run typecheck`: PASS.
- Backend `npm run build`: PASS.
- Postman YAML parse: PASS.
- Full frontend dependency-backed build was not executed in sandbox; the immediately preceding Production release on the target host completed the frontend build successfully, and this patch's TSX files are limited to typed KPI additions using existing components.

## Production procedure
1. Backup source.
2. Unzip this patch at `/home/postyarh/postelrobbal`.
3. Run migration CLI; it should apply `0031`.
4. `cd app && npm run typecheck && npm run build`.
5. `cd frontend && npm run build`.
6. `cp -a frontend/dist/. /home/postyarh/public_html/`.
7. `touch api/tmp/restart.txt`.

No `.env` file and no compiled Asset directory is included in this patch.
