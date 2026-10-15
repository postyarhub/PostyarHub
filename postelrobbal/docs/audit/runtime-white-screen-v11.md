# Postyar Runtime White-Screen Forensic Audit — v11

## Scope

This audit addresses the production white-screen incident observed after the v10 release. The investigation was artifact-first and did not assume a browser-side explanation without evidence.

## Confirmed root cause

The production SPA entry changed from `index-CjIBK3lx.js` to `index-v11.js`, but multiple dependent lazy chunks still contained imports of the old entry. This created a split module graph in which route chunks could load the previous React entry/runtime while the document had already mounted the new entry on the same `#root`.

This stale reference was confirmed by direct inspection of the shipped JavaScript assets and was not inferred from the symptom alone.

A second independent defect was found in three newly generated route chunks:

- `Bots-v10.js`
- `Notifications-v10.js`
- `Referrals-v10.js`

Each failed `node --check` with JavaScript syntax errors. Those three chunks have been replaced with the last-known-good v9 compiled counterparts and their internal entry references were normalized to `index-v11.js`.

## Recovery changes

### Browser runtime

- Repointed all stale `./index-CjIBK3lx.js` imports in public JS assets to `./index-v11.js`.
- Removed all current runtime references to `index-v9` and `index-CjIBK3lx` from active route chunks.
- Replaced the three malformed v10 route chunks with syntax-valid v9 counterparts.
- Re-ran JavaScript syntax validation across every public JS asset.
- Re-ran relative module import integrity checks.
- Verified the SPA HTML references exist on disk.
- Preserved old entry files for cache compatibility, but no active chunk references them.

### Backend runtime/source consistency

Additional concrete TypeScript/runtime issues found during the same audit were repaired:

- `app/src/db/migrate.ts`: explicit `Set<string>` typing for migration names.
- `app/src/modules/stickers/sticker.service.ts`: use `undici.fetch` rather than the ambiguous global Fetch type; compiled runtime updated accordingly.
- `app/src/modules/support/support.routes.ts`: normalize nullable message body before persistence; compiled runtime updated accordingly.
- `app/src/modules/support/support.service.ts`: explicit message aggregation map shape; compiled runtime updated accordingly.
- `app/src/modules/wordpress/wordpress.service.ts`: `ensureDefaultWordpressTemplates()` now obtains its DB handle explicitly; compiled runtime already patched in the recovery worktree.
- `scripts/release-check.sh`: required WordPress plugin path corrected to the actual shipped plugin.
- `config/.env.example`: restored into the release after it was absent from v10.

## Validation performed

### Public JavaScript

- 57 JavaScript asset files checked with `node --check`.
- Result: 57 valid, 0 syntax errors.

### Public module graph

- 255 relative JavaScript imports inspected.
- Missing relative imports: 0.
- Active references to `index-CjIBK3lx.js`: 0.
- Active references to `index-v9.js`: 0.

### Backend compiled runtime

- 93 compiled JavaScript files checked with `node --check`.
- Result: 93 valid, 0 syntax errors.

### WordPress plugin

- 4 PHP files checked with `php -l`.
- Result: 4 valid, 0 syntax errors.

### Release gate

The repository release gate completed with 0 blockers and 1 warning. The warning is the expected absence of intermediate `frontend/dist`; the committed `public_html` SPA runtime is the production artifact used by the deployment script.

## Environment limitation

A full Vite frontend production build could not be completed in this environment because the frontend dependency tree was not installed and package installation timed out. A real browser navigation against the local artifact was also blocked by the execution environment's browser policy. Therefore this audit does not claim a successful live browser test or a successful full Vite build.

The supplied recovery package is based on static artifact validation plus the known-good v9 compiled chunks where the v10 generated chunks were syntactically broken.

## Database safety

No destructive migration was introduced by this recovery. Existing migrations remain additive/idempotent. The normal migration runner should be used after deployment; only pending migrations are applied.
