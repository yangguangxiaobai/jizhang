# Design: Android-first API delivery

## Architecture and contracts
Android Kotlin/Compose -> HTTPS https://jz.yansuu1.xyz/api/v1/** -> existing Caddy -> Fastify/server + shared -> existing SQLite /data. Keep integer cents, epoch milliseconds, session cookies, CSRF headers, raw upload/download contracts and server-owned calculations. No replacement backend or database.

## Web retirement in two stages
Stage 1: remove production static hosting and SPA fallback from server; return the existing JSON NOT_FOUND response for /, old page paths and unknown API routes. No replacement landing page. Docker builds/copies server/shared only; stale assets must not accidentally re-enable hosting. Keep Web source solely as temporary parity reference.
Stage 2: after Android full-feature parity acceptance and extraction of useful contract tests/fixtures, remove packages/web, Web-only scripts/dependencies and active build/documentation references. Preserve Git history and archived task evidence. Do not delete shared business code or backend assets used by Android. Retirement remains open until both stages pass.

## Android completion
Audit repositories, UI and API fields against actual server routes and temporary Web references. Prioritize session restoration, address/cookie isolation, authorization errors, required mutation fields, file workflows and navigation. Default URL becomes https://jz.yansuu1.xyz while remaining configurable. Use a stable production launcher and keep demos out of production entry points. Preserve full feature scope from the existing Android PRD; missing features are defects to complete, not silent exclusions.

## Deployment and migration
Inspect the actual old image, Compose project, volume, database and environment before changing the server. Preserve the AI encryption key and other required secrets without logging values. Create a consistent SQLite backup and verify restoration into an isolated location; preserve photo and backup data. Keep the old image/config for rollback. Never run down -v or recreate an empty volume as a migration shortcut.
Host Caddy forwards to 127.0.0.1:8081; container Caddy needs a shared network service address. Select after inspecting the live topology. Validate before reloading; preserve other sites and ownership of ports 80/443. Keep optional private cutout service and resource limits; document its unavailable-service fallback.

## Verification evidence and limits
Local API tests, Gradle build/lint and contract checks precede deployment. Device tests and real-server checks require actual reachable devices/access; mark unavailable checks pending instead of asserting success. Do not permanently delete Web until required Android parity evidence is complete. Build/signing success does not establish usability; release signing is user-local.

## Changes superseding older plans
The current user decision permits backend/deployment changes, restores jz.yansuu1.xyz as the intended URL, prioritizes Android and retires Web. Older no-backend-change and three-active-client assumptions do not govern this delivery. Existing Harmony source remains; Harmony 5/6 expansion is deferred.
