# Implementation Plan — Personal Item Assets

## Change Boundary

Behavior gap: the app has no durable item records. Add an independent item domain with optional photos and ledger references. Do not alter transaction write paths or existing financial projections.

Expected code areas:

- Backend: migration 010, migration registry, item service, authenticated item routes, app route registration, unit/route/migration tests.
- Web: typed API client, item store, item list/editor/detail views, router entries, dashboard/“我的” entry points, and mobile/browser verification.
- Persistence: store bounded photo bytes in SQLite so current backups cover them.

Explicitly excluded: source Python integration, model weights, automatic cutout/visual recognition, receipt OCR, AI provider changes, and modifications to existing ledger calculations or the six-tab navigation.

## Ordered Checklist

1. **Backend schema**
   - Add additive TypeScript migration 010 for item rows and a one-photo-per-item BLOB table.
   - Add indexes for live status/category/date list queries and transaction link lookups.
   - Test fresh install, existing database upgrade, repeat migration, backup-before-migration, and rollback on migration failure.
2. **Domain service**
   - Implement item CRUD, category/search/status filters, soft delete, photo replacement, transaction-link validation, and summary DTOs.
   - Centralize holding-day/net-cost/daily-cost calculations in the server domain layer with injected clock/local-date helpers.
   - Validate lifecycle transitions and keep stale/purged transaction links non-destructive.
3. **Authenticated API**
   - Add thin routes inside the authModule.extraRoutes array.
   - Enforce a decoded photo cap of 2 MiB and JPEG/PNG/WebP signature allowlist; never log image payloads or filesystem paths.
   - Serve photos only from an authenticated, no-store, nosniff endpoint.
4. **Web data layer**
   - Add item DTOs, queries, request methods, and photo URL handling in the web API client.
   - Add a Pinia store with explicit load/refresh paths after writes.
5. **Web experience**
   - Implement list/summary/filter, create/edit with optional photo and item category, detail, optional purchase/sale transaction linking, and sale/retirement flows.
   - Add dashboard and “我的” entry links; preserve the existing six tabs and all bookkeeping routes.
   - Use the approved Ardot page “03 物品资产” for layout; replace the future cutout step with ordinary photo upload in this release.
6. **Cross-layer verification**
   - Prove item CRUD, links, and lifecycle changes do not change transaction rows, account balances, budget output, or financial statistics.
   - Prove photo retrieval is authenticated and uncached, and that malformed/oversized payloads fail safely.
   - Verify a photo survives a database backup/restore round trip.
   - Verify UI loading/empty/error/success states and mobile touch/safe-area requirements.

## Validation Commands

Run from repository root after implementation:

    pnpm -r run lint
    pnpm -r run typecheck
    pnpm -r run test
    pnpm --filter @jizhang/web run build
    git diff --check

Also run the relevant served-browser suite for the item routes/views when the local Docker daemon is available; do not claim server deployment verification from unit tests alone. Confirm the built image serves the new SPA/API and that a backup/restore test includes photo bytes.

## Risk and Rollback

- **Image size / DB growth:** only one compressed photo per item, hard decoded-size cap 2 MiB, photos omitted from list JSON.
- **Accidental ledger coupling:** test ledger and derived financial responses for exact equality before/after item operations and optional linking.
- **Migration rollback:** additive migration only; an older app version ignores the new tables. Never edit shipped migration files or delete user rows during rollback.
- **PWA bundle gate:** the user approved updating the raw-asset limits to JS 352 KiB and CSS 96 KiB for this route-split feature. The checker and frontend quality spec now record those limits; retain the separate gzip measurements in research/web-bundle-budget.md.
- **Existing worktree changes:** preserve all previously modified UI files, tar archives, and deployment scripts; stage only files belonging to this task if/when a later commit is requested.
- **No production deployment in this implementation task** unless the user explicitly asks after code review.
