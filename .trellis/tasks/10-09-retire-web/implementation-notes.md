# Stage 1 implementation evidence (2026-10-09)

- Removed Fastify static hosting, SPA fallback, webDistDir config/options and the static-plugin dependency. Legacy WEB_DIST_DIR is ignored. No schema, ledger, auth or health contracts changed.
- Root dev/build now target the API and shared package. Web reference build/browser tests are explicit scripts; old iPhone aliases remain as temporary compatibility wrappers.
- Retained Web source. Browser fixtures use a dedicated Vite preview host with API proxying, separate from production buildApp; startup/shutdown/restart remain isolated per temporary ledger.
- Existing server HTTP contracts remain in packages/server/scripts. Replaced obsolete webpage-success assertions with JSON NOT_FOUND checks. Legacy e2e-pwa delegates to a read-only API-only probe, which can also target a supplied HTTPS origin.

## Verification

- Before implementation, the new stale-Web regressions failed on nine former shell/static success responses (200 versus required 404).
- After implementation, app tests: 18 passed; full server tests: 478 passed across 20 files; shared tests: 174 passed across 7 files.
- Server lint, typecheck and build passed. Root pnpm build passed and built only shared/server.
- Dedicated temporary reference-host smoke passed: root/deep-page HTML on reference host, production JSON404, proxied health/unknown API JSON, listener restart at the same port.
- Targeted lint for changed fixture and HTTP scripts passed after removal of an already-unused helper in the touched transaction script. Production files/root package formatting and diff whitespace checked.

## Pending gates

- Actual Web build/browser parity tests not run in this subtask; packages/web/dist was absent. Use build:web-reference and test:web-reference for explicit temporary comparison.
- Container/Caddy/live HTTPS checks belong to deployment task. The destructive legacy ledger-reset HTTP suites were not executed against a user's ledger.
- Android full parity/device acceptance remains required before stage 2 Web source deletion. Stage 1 local code verification does not mark deployment or full retirement complete.
