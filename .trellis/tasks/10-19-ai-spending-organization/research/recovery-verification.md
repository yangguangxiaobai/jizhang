# Tag-foundation scoped recovery verification

**Task:** `.trellis/tasks/10-19-ai-spending-organization`  
**Task status:** remains `in_progress`; no archive, commit, staging, production/provider/device, or database deployment performed.

## Outcome

Tag foundation is **not implemented / not ready**. This was a minimal orphan cleanup, not restoration of the reported 212-test feature. The six focused server suites plus isolated helper now pass on the pre-tag-foundation behavior; this does not validate migration 013, catalog CRUD, or hierarchical `tagId` filtering.

- Removed the current `tagId` query parser/argument from `packages/server/src/routes/transactions.ts`; route now matches the existing transaction service contract.
- Kept the existing `tags_json`-based legacy tag vocabulary routes and their old tests untouched.
- The pre-tag-foundation migration and master-data service/routes are intact: `migrate.ts` has no migration 013 reference; master-data routes expose only legacy tags endpoints, backed by the existing service methods. No dangling migration import or missing master-data service method was found.
- Restored `ai-organization.test.ts` to the captured pre-feature baseline plus preserved a separate, unrelated undo-conflict test that was already present in the dirty current source. Removed only the two newly inserted assertions querying the absent `tags` table. No test expectation was changed to force a green result.
- Exact removed feature test/source deltas are retained under `artifacts/deferred-tag-foundation-tests/`; the route removal is retained as a patch. A `tag-sql` isolated helper/test remains unintegrated and is not treated as production feature coverage.

## Recovery snapshot

Before edits, the affected current files were copied with SHA-256 manifest to `artifacts/recovery-current-snapshot/`. It contains the current `transactions.ts`, `ai-organization.test.ts`, and `migrate.ts`; `source-hashes.json`, `git-status.txt`, and `head.txt` from the task baseline were read first. Baseline comparison confirmed the migration, master-data route/service, transaction service, and DB/master-data/transaction tests already match the supplied implementation-baseline hashes. `transactions.ts` contained only the additive `tagId` route change against HEAD. `ai-organization.test.ts` had the tag-table assertions and an added undo-conflict test; only the two missing-table assertions were removed, retaining the independent test.

| File | Recorded baseline SHA-256 | Current SHA-256 | Result |
|---|---|---|---|
| `packages/server/src/db/migrate.ts` | `3e55385b8bd1e36d05f433a394d016e4cab48e8f530ffddc21536647078159e5` | `3e55385b8bd1e36d05f433a394d016e4cab48e8f530ffddc21536647078159e5` | match |
| `packages/server/src/routes/master-data.ts` | `53a259bf084e5dee7d7fbae45b31b3b941ffefeab2f27b1404704926471b7008` | `53a259bf084e5dee7d7fbae45b31b3b941ffefeab2f27b1404704926471b7008` | match |
| `packages/server/src/routes/transactions.ts` | `48ec434ca94e487cdccc23f953d5ccf225626a21e78fbb6b0ff430a42aa48751` | `48ec434ca94e487cdccc23f953d5ccf225626a21e78fbb6b0ff430a42aa48751` | match |
| `packages/server/src/services/master-data-service.ts` | `a0d9a4daa5f8b98edd659911fdf436c6e692bd8d61eace64c029ab2ee4072871` | `a0d9a4daa5f8b98edd659911fdf436c6e692bd8d61eace64c029ab2ee4072871` | match |
| `packages/server/src/services/transaction-service.ts` | `77a6fdd0406c51e0845f615f5d9055f1e1c79656ea64146a19211811019d3a3b` | `77a6fdd0406c51e0845f615f5d9055f1e1c79656ea64146a19211811019d3a3b` | match |
| `packages/server/test/db.test.ts` | `cc2ffbe47f413cc73dc7b8b9e81f274a5465b3f4c40e683dd23f46280d19a0a9` | `cc2ffbe47f413cc73dc7b8b9e81f274a5465b3f4c40e683dd23f46280d19a0a9` | match |
| `packages/server/test/master-data.test.ts` | `06762902f34cb1e0a608cb6c133b8846eef24d0f3dbc8c66331e54b83988930e` | `06762902f34cb1e0a608cb6c133b8846eef24d0f3dbc8c66331e54b83988930e` | match |
| `packages/server/test/transactions.test.ts` | `1ff05e721d5cca743b44aec4848464baf05af6941c1eaae48e37d987e0f3a177` | `1ff05e721d5cca743b44aec4848464baf05af6941c1eaae48e37d987e0f3a177` | match |
| `packages/server/test/ai-organization.test.ts` | `04258e5a535112527525cab3e5aba77860e8a6ea834770976d2d768fa94257de` | `2a246d2ac7f3655ec50b5d24944c613f4209f1002ed3caa91d916046de675e3c` | changed (scoped recovery or pre-existing WIP) |

## Verification

Command: `pnpm --dir packages/server exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts test/portability.test.ts test/import-batch-confirm.test.ts test/tag-sql.test.ts --reporter=dot`

- **7 test files passed; 201 tests passed, 0 failed.** This count includes the isolated `tag-sql.test.ts` helper test and the preserved AI undo-conflict test. It is not the previously cited 212 feature tests.
- `pnpm --filter @jizhang/server lint` — passed.
- `pnpm --filter @jizhang/server typecheck` — passed.
- `git diff --check -- packages/server/src/routes/transactions.ts packages/server/test/ai-organization.test.ts` — passed.
- Source scan: no `013-tag-hierarchy`, `MIGRATION_013`, `TagCatalogService`, or `tagId` reference remains under `packages/server/src`.

## Deferred feature-specific material

- `artifacts/deferred-tag-foundation-tests/ai-organization-tag-foundation-additions.patch` — original exact unified diff of tag-related test additions, including the full newly added tag-aware undo-conflict case. Keep deferred until the tag table and coherent feature are implemented.
- `artifacts/deferred-tag-foundation-tests/ai-organization-tags-table-assertions.patch` — exact captured patch for the embedded assertions removed from the legacy test.
- `artifacts/deferred-tag-foundation-tests/transactions-tagId-route.patch` — exact route delta removed from tracked source.

These artifacts preserve the feature tests without adapting, skipping, or changing their assertions. They are intentionally not included in green test execution.
