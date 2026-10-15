# Content & Campaign Center — Composition Update

Scope:
- Persist manual Campaign selectionIds through the existing WordPress campaign API schema.
- Add server-side template preview using the same renderTemplate implementation used by campaign execution.
- Add live template preview in the existing template editor.
- Add campaign composition preview using the selected template and item type.
- Preserve existing template, emoji/sticker, channel and campaign UI structure.

Files:
- app/src/modules/wordpress/wordpress.routes.ts
- frontend/src/wordpressTools.ts
- postman/collections/PostYar Analytics/templates-preview.request.yaml
- postman/collections/PostYar Analytics/.resources/Templates-Preview.resources/examples/200 OK.example.yaml

No migration is required.
