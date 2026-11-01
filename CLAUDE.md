# Notes for Claude

- UI language: Vietnamese. Docs/code comments: English. Printed guest bill/receipt: English (bar ticket stays Vietnamese).
- Every update: bump `version` in package.json (0.x, minor +1 per update until production) and add a CHANGELOG.md entry. The version shows on the login screen via `__APP_VERSION__`.
- Run `npm test` before pushing. D1 Free limits: ≤100 bound params per query, ≤50 queries per request.
- Pushing to main deploys via Cloudflare Workers Builds; new migrations must be applied remotely.
