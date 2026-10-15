# Postyar UI / Content Release v10

## Scope

This release addresses the user-facing gaps identified after the WordPress integration:

- cache-busted dashboard/landing/shell styles
- ready-to-use message templates with preview action
- inline sticker/emoji picker attached to content text areas
- internal Telegram sticker-pack import from inside the picker
- WebP sticker conversion to PNG in the browser when possible for cross-platform media upload
- clickable analytics/referral report surfaces with modal detail views
- professional notifications surface
- simplified bot connection/management surface
- payment callback notice with the gateway message returned by the backend
- WordPress plugin Vazirmatn-first typography

## Telegram sticker library boundary

Telegram Bot API supports retrieving all stickers in a named sticker set. It does not expose a global catalogue of every sticker on Telegram. Therefore the internal library stores complete imported packs selected by the user, plus the local media library. No claim is made that a global Telegram catalogue is bundled.

## Validation limits

- PHP syntax checks were run on changed WordPress plugin files.
- `node --check` was run on the changed JavaScript runtime bundles.
- TypeScript changed backend files were syntax-transpiled where possible.
- Full Vite/TypeScript production build could not be completed because the frontend dependency tree was unavailable and `npm install` timed out in the build environment. No successful full build is claimed.
- No real production payment was fabricated; WinaPay verification remains server-side and will correctly fail until the provider activates/permits the merchant.
