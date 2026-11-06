# Notes for Claude

- UI language: Vietnamese. Docs/code comments: English. Printed guest bill/receipt: English by default, Vietnamese selectable (Cài đặt › Hoá đơn); layout follows the CukCuk-style bill the owner supplied. Bar ticket stays Vietnamese.
- Every update: bump `version` in package.json (0.x, minor +1 per update until production) and add a CHANGELOG.md entry. The version shows on the login screen via `__APP_VERSION__`.
- Run `npm test` before pushing. D1 Free limits: ≤100 bound params per query, ≤50 queries per request.
- Pushing to main deploys via Cloudflare Workers Builds; new migrations must be applied remotely.
- Guest QR menu page `/m/<token>` is a self-contained HTML page in worker/guest.ts (no React bundle). Nightly R2 backup runs from the cron in wrangler.jsonc (worker/backup.ts).
