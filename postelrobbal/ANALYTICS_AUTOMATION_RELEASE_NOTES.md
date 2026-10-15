PostYar Analytics — AI + Workflow + Error Intelligence

Scope
- Instrument direct AI calls (auto-reply/workflow/settings test) and queued AI jobs.
- Record duration, token counts, source, purpose and stable dedupe keys.
- Enrich workflow started/completed/failed events with duration, platform, AI calls, outbound messages and error code.
- Add tenant/admin automation summaries and error intelligence to the unified analytics engine.
- Add GET /api/v1/analytics/automation?days=30 and a Postman v3 request/example.
- No new DB table or migration: telemetry remains in analytics_events.

Deployment order
1. Unzip at project root.
2. Run migration 0032 with the existing migrate-cli.
3. npm run typecheck && npm run build in app.
4. npm run build in frontend.
5. cp -a frontend/dist/. /home/postyarh/public_html/
6. touch api/tmp/restart.txt

Do not modify config/.env or delete existing public assets.
