# PostYar WordPress Analytics Route Fix — 2026-10-02

## Reason
Production Acceptance found `GET /api/v1/analytics/wordpress?days=30` returning HTTP 404.

## Cause
A later analytics patch overwrote the analytics service/route without preserving the previously implemented WordPress analytics function and route.

## Scope
- Restores `getWordPressAnalytics()` in `app/src/modules/analytics/analytics.service.ts`.
- Restores `GET /analytics/wordpress` in `app/src/modules/analytics/analytics.routes.ts`.
- Adds only the required `wordpressSites` schema import.
- No migration.
- No frontend changes.
- No public_html changes included.

## Deployment
Backend typecheck/build, then restart Passenger. The existing frontend already calls this endpoint.
