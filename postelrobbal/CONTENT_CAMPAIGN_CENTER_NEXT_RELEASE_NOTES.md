# PostYar Content & Campaign Center — Next Composition Layer

Scope:
- Add authenticated POST /api/v1/templates/preview using the existing renderTemplate() engine.
- Add Template Editor live preview for product/article sample contexts.
- Add Campaign Composition preview using the selected template and content type.
- Preserve existing manual picker, campaign selectionIds, analytics, channel controls and template CRUD.
- No database migration.

Deployment:
- Backend build is required because wordpress.routes.ts changes.
- Frontend build is required because wordpressTools.ts changes.
- Publish frontend dist to public_html.
- Restart Passenger via api/tmp/restart.txt.
