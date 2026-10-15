# POSTYAR — Content / Stickers / Bots / Analytics V13

Date: 2026-09-29
Base: `postelrobbal-content-stickers-v12.zip`

## Scope

This release continues V12 and addresses the nine items requested in the previous repair session, without treating the separate Sticker Library page as the primary user workflow.

### Content templates

The content tools popup now contains ten ready templates with category filters, live sample values, preview, and Apply. The popup is available beside detected content fields rather than requiring a separate templates page.

### Emoji / Sticker / Custom Emoji

The standalone dashboard menu entry for `کتابخانه استیکر` has been removed from navigation. The internal picker is the single user-facing workflow for emoji, imported Telegram packs, Custom Emoji and ready templates.

Public Telegram packs can be imported from the same popup through a selected active Telegram bot. Both `t.me/addstickers/...` and `t.me/addemoji/...` are accepted. Imported packs are stored per tenant and shown as pack tabs with emoji-based filtering.

Static emoji data is loaded from the project's internal Unicode library. Third-party emoji/sticker artwork is not falsely represented as a universally redistributable bulk download; Telegram packs are imported by pack through the Telegram API.

### Sticker media correctness

Sticker metadata now preserves dimensions, animation/video flags, preview thumbnail file ID and custom emoji ID. Animated TGS stickers can use their Telegram thumbnail for preview, while WEBM video stickers are recognized as `video/webm` and validated by the EBML signature.

### Bots

Bot detail management now supports editing existing commands and keywords, not only add/delete. Bot users can be opened in a detail modal showing the fields actually available from the current API data.

### Analytics

The overview endpoint now honors the selected 7/30/60/90-day range. Daily analytics are allowed up to 90 days. Existing cards, channels, posts, events and daily rows remain clickable and open detail modals.

### Referrals / Notifications

The referral user list continues to open full user/subscription/reward details in a modal. The dashboard notification center continues to support all/unread filtering, mark-all-read, detail modal and notification preferences. The admin notification bell remains available separately.

## Files changed

- `public_html/index.html`
- `public_html/assets/content-tools-v15.js`
- `public_html/assets/vendor-jsx-runtime-shim.js`
- `public_html/assets/gen/contentTools.js`
- `public_html/assets/gen/layouts/Layout.js`
- `public_html/assets/gen/pages/dashboard/PostNew.js`
- `public_html/assets/gen/pages/dashboard/WooCommerce.js`
- `public_html/assets/gen/pages/dashboard/BotDetail.js`
- `public_html/assets/gen/pages/dashboard/Analytics.js`
- `postelrobbal/frontend/src/contentTools.ts`
- `postelrobbal/frontend/src/layouts/Layout.tsx`
- `postelrobbal/frontend/src/pages/dashboard/PostNew.tsx`
- `postelrobbal/frontend/src/pages/dashboard/WooCommerce.tsx`
- `postelrobbal/frontend/src/pages/dashboard/BotDetail.tsx`
- `postelrobbal/frontend/src/pages/dashboard/Analytics.tsx`
- `postelrobbal/frontend/public/assets/content-tools-v15.js`
- `postelrobbal/app/src/db/schema.ts`
- `postelrobbal/app/src/providers/telegram/telegram.ts`
- `postelrobbal/app/src/modules/stickers/sticker.service.ts`
- `postelrobbal/app/src/modules/media/media.service.ts`
- `postelrobbal/app/src/modules/analytics/analytics.routes.ts`
- corresponding compiled backend `dist` files
- `postelrobbal/database/migrations/0026_telegram_sticker_format_metadata.sql`

## Validation

- SHA256 of the V12 input archive was verified before modification.
- JavaScript syntax validation over the production asset tree: 0 errors.
- Project `release-check.sh`: 0 blockers; one pre-existing warning that frontend `dist` is an intermediate build output and is not committed.
- The full TypeScript semantic typecheck was not claimed because the release environment does not contain a complete dependency graph.
- Full browser E2E was not claimed because Chromium repeatedly failed to start reliably in this environment.

## Deployment note

This archive preserves the V12 release layout under the top-level `release_v13/` directory. Apply the production contents from `release_v13/public_html` to the web root and the corresponding `release_v13/postelrobbal` source/backend files according to the project's normal deployment procedure. Apply migration `0026_telegram_sticker_format_metadata.sql` once through the existing migration mechanism; it is additive and idempotent.
