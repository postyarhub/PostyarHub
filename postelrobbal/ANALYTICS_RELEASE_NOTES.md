# PostYar Analytics — Publishing + Delivery Layer

## Scope
This release extends the unified analytics core into the publishing/delivery path without replacing the existing legacy event bus.

### Changes
- Adds `post.delivery.started`, `post.delivery.sent`, and `post.delivery.failed` events.
- Captures target, channel, platform, attempt count, retry state, and provider error class where available.
- Makes analytics emission non-fatal after a provider send or delivery state update, so analytics failures cannot turn a successful send into a failed delivery/retry.
- Adds tenant delivery summary to the unified analytics response.
- Adds per-post, per-target delivery analytics to `/api/v1/analytics/posts/:id`.
- Adds `/api/v1/analytics/deliveries`.
- Adds migration `0030_delivery_analytics_backfill.sql` to baseline current SENT/FAILED targets into the new analytics event model.
- Adds a Postman v3 request for the delivery summary endpoint.

## Deployment order
1. Apply migration `0030_delivery_analytics_backfill.sql` with the existing migration CLI.
2. Build backend (`npm run typecheck && npm run build`).
3. Build frontend (`npm run build`).
4. Publish `frontend/dist` to `public_html` using the host's available copy mechanism; do not use `rsync` on this host.
5. Restart Passenger using the existing project restart mechanism.
6. Run the API smoke checks for `/api/v1/analytics/deliveries` and `/api/v1/analytics/posts/:id`.

## Compatibility
Legacy `post.sent` / `post.failed` events remain emitted for existing consumers. The new delivery events are additive.

## Rollback
Revert source files from the deployment backup. Migration `0030` is additive and does not alter existing tables or states; its inserted analytics rows may remain unless explicitly removed during rollback.
