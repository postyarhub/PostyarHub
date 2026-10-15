# Postyar Release v10 — UI, Content, Stickers, Analytics, Referrals, Notifications, WordPress

## User-facing changes

1. Replaced cache-sensitive frontend shell/landing/theme/chart asset names with v11 names and main bundle `index-v11.js`.
2. Added a global internal sticker/emoji picker to every textarea/contenteditable field in the dashboard and WordPress admin surface where the browser can see the field.
3. Sticker picker supports importing a complete named Telegram sticker pack into the tenant's internal library, selecting a pack, selecting a sticker, and converting WebP to PNG in the browser when possible before media upload.
4. Added ready-template preview action in the WordPress content center.
5. Advanced analytics runtime provides clickable metrics, platform breakdown, daily detail, recent posts/events and modal details.
6. Referral users are clickable with modal detail including user, subscription and reward information.
7. Notifications are presented as a professional inbox with read/unread controls.
8. Bot management is presented as a simple platform-by-platform connection wizard with lifecycle actions.
9. WinaPay failure messages preserve server-side verification and now surface the provider message/code and remind the administrator that merchant activation/permission must be completed by the gateway provider.
10. WordPress plugin admin UI uses Vazirmatn as the first font family and loads it as an external web font; no font binaries are included in the deliverable.
11. WordPress site quota remains enforced in backend and represented in admin plan limits through `max_wordpress_sites`.

## Architecture

- Existing provider adapters, Queue, Worker, posts/post_targets/outbox and tenant isolation remain canonical.
- No second queue or parallel publisher architecture was introduced.
- Telegram sticker storage is tenant-scoped using the existing sticker tables and active Telegram bot credentials.

## Telegram sticker library boundary

The Telegram Bot API can retrieve the complete contents of a named sticker set. It does not provide a global catalogue of every Telegram sticker in the world. Therefore this release implements a complete internal library for imported packs, not a fabricated global catalogue.

## Payment note

WinaPay verification intentionally remains server-side. A merchant that is not yet activated/approved by the gateway provider may fail Verification. The software must not convert that into a false successful settlement.

## Validation performed

- JavaScript runtime files: `node --check` successful.
- Changed WordPress PHP files: `php -l` successful.
- Changed backend TypeScript files: transpile-only syntax checks successful.
- ZIP integrity will be checked with `unzip -t`.
- Full frontend `tsc --noEmit` / Vite production build was not completed because the frontend dependency tree is absent and `npm install` timed out. No successful full build is claimed.

## Deployment note

The release intentionally does not redistribute font binary files. Preserve the existing `public_html/fonts/` directory on the production server when replacing the web runtime. The WordPress plugin uses the Vazirmatn web font through an external CSS source rather than carrying font binaries in the plugin package.
