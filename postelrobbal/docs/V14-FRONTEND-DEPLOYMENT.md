# Postyar V14 — Frontend deployment

V14 fixes the production frontend mismatch by shipping one content picker runtime and removing the legacy UX-v11 picker. The `/dashboard/stickers` page is no longer a standalone UI; its route redirects to `/dashboard/posts/new`.

Production frontend must be built from `frontend/` and synchronized to `$HOME/public_html/`. Do not manually patch compiled Vite bundles.

Required Node runtime on the cPanel host:
`/home/postyarh/nodevenv/postelrobbal/api/22/bin/`
