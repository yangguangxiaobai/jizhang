# Tag foundation backend slice — implementation report

## Scope

Active task `.trellis/tasks/10-19-ai-spending-organization`; this is the independently scoped server tag-foundation slice only. No task activation/state change, commit, staging, archive, deployment, production DB, provider, device, dependency or environment operation was performed. Existing mixed WIP was retained. No Android/shared/spec/README files were changed.

## Implemented

- Added additive migration 013 with stable metadata table `tags`, active-name uniqueness, parent lookup index, and legacy metadata backfill from safely parsed JSON arrays. Backfill includes deleted transaction history and leaves every `tags_json` byte unchanged.
- Added SQLite insert/update triggers on `transactions.tags_json` as the shared transactional compatibility boundary. This covers transaction CRUD, master-data rewrites, assistant organization SQL, CSV/JSON imports, merged import insertions, and future direct writers without separately maintained writer-specific hooks. Triggers preserve association JSON and create/reactivate metadata.
- Added `TagCatalogService` for hierarchy list/create/update/soft-delete. Parent depth is limited to two levels; active names are globally unique because association arrays only encode names. Existing legacy names can be adopted as parent/child metadata while preserving their stable ID; retired legacy tags cannot silently move to another branch.
- Added protected `/api/v1/tags/hierarchy` GET/POST/PATCH/DELETE routes. GET only reads; mutations remain inside existing auth/CSRF encapsulation.
- Added `tagId` filtering to transaction list. Parent selection includes direct parent and active children via correlated `EXISTS`; child is exact; counts/pagination are not multiplied. Legacy `tag` remains exact; simultaneous `tag`+`tagId` fails validation.
- Preserved legacy flat endpoints and transaction DTOs. Legacy rename/delete now synchronizes metadata atomically with name-array rewrites and blocks deleting a parent that still has active children.

## Files changed by this slice

- `packages/server/src/db/migrate.ts` — registered migration 013; existing 011/012 additions were already present in this mixed-WIP baseline and are not this slice's edits.
- `packages/server/src/db/migrations/013-tag-hierarchy.ts` — additive metadata/backfill/synchronization triggers.
- `packages/server/src/services/tag-catalog-service.ts` — stable hierarchy metadata domain service.
- `packages/server/src/services/master-data-service.ts` — legacy tag lifecycle synchronization and catalog delegation.
- `packages/server/src/routes/master-data.ts` — protected hierarchy routes.
- `packages/server/src/services/transaction-service.ts` — parent/child stable-ID filter.
- `packages/server/src/routes/transactions.ts` — `tagId` query parsing.
- `packages/server/test/db.test.ts` — migration backfill, byte preservation, idempotence, trigger coverage.
- `packages/server/test/master-data.test.ts` — hierarchy, depth, parent filter dedup/count/pagination, legacy adoption, lifecycle.
- `.trellis/tasks/10-19-ai-spending-organization/research/tag-foundation-implementation.md` — this implementation report.

## API contract

- `GET /api/v1/tags/hierarchy` → `{items:[{id,name,parentId,depth,count}]}`; read-only.
- `POST /api/v1/tags/hierarchy` `{name,parentId?}` → 201 tag DTO.
- `PATCH /api/v1/tags/hierarchy/:id` `{name?,parentId?}` → updated tag DTO.
- `DELETE /api/v1/tags/hierarchy/:id` → 204; parent with active children returns conflict.
- `GET /api/v1/transactions?tagId=<id>`: exact child, or parent plus direct children; AND-composes with other current filters. `tag` plus `tagId` is 400. Existing name API and `tags:string[]` DTO unchanged.

## Verification

- `cd packages/server && pnpm exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts test/portability.test.ts test/import-batch-confirm.test.ts` — passed, 6 files / 203 tests.
- `cd packages/server && pnpm run typecheck` — passed.
- `cd packages/server && pnpm run lint` — passed.
- Earlier attempts exposed and fixed a route syntax typo, missing `tag` query type, incorrect migration test setup order, hierarchy adoption of an existing flat legacy tag, and a test reading better-sqlite3's scalar `COUNT(*)` row as an array. Those attempts are not represented as passing checks.

## Independent review follow-up

`research/tag-foundation-independent-review.md` reported BLOCKED. Its seven findings were addressed in source and focused regression tests in `research/tag-foundation-review-fixes.md`; independent reviewer re-run is still required. This does not accept or complete the full AI spending organization feature. The previously reported 203-test run is historical and was not repeated by the independent reviewer; this session's exact checks are in the supplemental fix report.

## Remaining risks / not claimed

- This delivers tag foundation only, not AI range analysis/cards/apply/undo, the complete PRD feature, or Android integration.
- No 500-row cap, note retention, or referenced-category-parent policy was implemented or decided.
- Migration uses SQLite JSON1 (`json_valid`, `json_each`), available in the project's SQLite runtime; upgrade tests exercise local better-sqlite3.
- Rename/delete compatibility with legacy arrays is retained, but stable-ID metadata does not change the old wire representation. Old clients cannot express branch identity; global uniqueness is therefore intentional.
- Independent review is pending in the parent session. Do not interpret source tests as provider/device/production verification.
