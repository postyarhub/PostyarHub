# PostYar Content + Campaign + Rubika Unified Release

Date: 2026-10-02

This release continues from the current Production baseline. It intentionally does NOT replace `frontend/src/wordpressTools.ts`; a targeted script patches only the loading state on the existing file so the established Campaign Picker scope is preserved.

## Included

- User Analytics responsive/modern layout with separated 30-day platform delivery panel, two-card lower composition, AI/Workflow card, Revenue/Subscription card, and post-level channel/platform/result detail.
- Human-readable delivery/automation error labels and suggested actions.
- Admin dashboard clickable KPI tiles, platform-specific channel/bot active/inactive breakdown, shared analytics panel, subscription-by-plan visualization, and modern event report.
- WordPress + WooCommerce unified dashboard with per-site connection settings, automation settings, send-image setting, message style, channel destinations, content listing, and product listing.
- Template popup modernization and shortcode presentation improvements while preserving existing emoji/sticker/template assets.
- Targeted fix for the existing “در حال آماده‌سازی قالب‌ها و کمپین‌ها…” loading surface, with a bounded state-loading timeout.
- Generic server-error wording made actionable and repeated error toasts throttled.
- Rubika Bot API alignment: `getMe`, `updateBotEndpoints`, `getUpdates` cursor, `requestSendFile`/upload/`sendFile`, documented button/metadata handling, documented edit/delete methods, HTTPS webhook requirement, and BotFather/group-channel guidance.
- Rubika failed webhook registration is retained as an `ERROR` bot record with health metadata so the user can retry instead of losing the connection attempt.
- Migration 0034 for WordPress `send_image` and WordPress content listing.

## Protected invariants

- Do not package or touch `.env`.
- Do not replace `frontend/src/wordpressTools.ts` wholesale.
- Do not reintroduce global `campaignPickerType`.
- `type` remains local to the functions that consume it.
- `syncCampaignPickerFromForm(_root, state)` keeps `state` and does not create duplicate picker state.
- Existing emoji, sticker, template and platform assets remain intact.
