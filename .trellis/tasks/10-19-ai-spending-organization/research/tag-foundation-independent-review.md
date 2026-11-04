# Independent review — tag-foundation backend slice

**Review scope:** `.trellis/tasks/10-19-ai-spending-organization` tag-foundation slice only. Reviewed `check.jsonl`, PRD, design, implementation authorization, tag-foundation contract and implementation report, backend database/directory/error guidelines, current source/tests, and the slice diff against the recorded baseline/WIP context.

**Verdict: BLOCKED — not an independent quality pass.** Findings below concern tag-foundation only; this does not assess or pass the whole AI feature. The provisional 500-record cap is not enabled or approved here. No provider, network, production DB, device, installation, dependency, stage, or commit operation was performed. No product source was changed.

## Findings

### [P1] SQL triggers treat valid non-array JSON as associations

- **Source:** `packages/server/src/db/migrations/013-tag-hierarchy.ts:17-21,23-35,38-50`
- **Evidence:** SQLite `json_each` accepts any valid JSON value, not only arrays. I executed the migration trigger SQL against a local in-memory SQLite database. Inserting `tags_json='{"k":"leak"}'` created metadata `leak`; inserting `tags_json='"scalar"'` created metadata `scalar`. For `["ok",1,true,null,{},[]]`, only the string `ok` was created. The current triggers gate only on `json_valid`, and the backfill likewise passes any valid JSON value into `json_each`.
- **Impact:** The established `parseTagsJson` contract in `services/tags.ts:44-54` returns an empty list for valid non-array JSON. The migration/triggers instead invent tags from object values and scalar strings, so catalog/filter behavior diverges from legacy readers and can surface metadata that no valid tag-array reader recognizes. This is a defensive-read compatibility defect, not merely malformed-syntax handling.
- **Minimum fix:** Gate backfill and both triggers on `json_type(tags_json)='array'` (and `json_type(NEW.tags_json)='array'`), with malformed and non-array valid JSON treated as no associations. Keep the raw transaction value byte-identical. Add object/scalar/array-with-nonstring regression cases.

### [P1] Legacy rename onto an existing name can orphan active children

- **Source:** `packages/server/src/services/master-data-service.ts:528-543`
- **Evidence:** When a source metadata row exists and a target metadata row exists, `renameTag` soft-deletes the source row, then rewrites transaction names to the target. It does not reject a source parent with active children or reparent those children. The only child-protection check is in `deleteTag` at lines 551-553. A request renaming parent `A` to existing root `B` after `A` has child `C` leaves active `C.parent_id=A` while `A.deleted=1`; the hierarchy GET hides A but still returns C with a dangling parent ID. The existing FK permits this because the row remains physically present.
- **Impact:** The catalog contains an orphaned active child; parent filters and hierarchy navigation cannot resolve a live root. It violates parent/child lifecycle stability and the invariant that soft deletion cannot leave invalid active structure.
- **Minimum fix:** In the existing-name merge branch, reject a rename if source has active children (or define and implement an explicit validated reparent/merge policy). Check both direct legacy rename and hierarchy rename-to-existing paths, and assert no active child has a missing/deleted parent after each mutation.

### [P2] Hierarchy DTO count is exact per tag, not parent-plus-children deduplicated

- **Source:** `packages/server/src/services/tag-catalog-service.ts:19-32`
- **Evidence:** `list()` calculates each tag's count by matching only that row's name. The parent row does not include transactions tagged directly with children. The parent `tagId` transaction filter does include both parent and children and its `EXISTS` shape deduplicates transaction rows, but the hierarchy DTO count does not use that same set. The current hierarchy test (`master-data.test.ts:600-615`) checks filtered total 3 but never checks parent/child counts.
- **Impact:** Parent catalog count disagrees with the user-requested parent aggregation semantics and the number returned by filtering that parent. Direct parent and child assignments can be counted inconsistently across hierarchy and transaction list.
- **Minimum fix:** For a root tag, count live transactions with an `EXISTS` over its own name OR its active direct child names; for a child, count only exact child membership. Add cases where one transaction carries parent and child simultaneously, and verify it counts once and agrees with `tagId` total.

### [P2] Blank `tagId` silently disables filtering

- **Source:** `packages/server/src/routes/transactions.ts:36-39,57-65`; `packages/server/src/services/transaction-service.ts:806-809`
- **Evidence:** `optionalString` maps whitespace/empty strings to `undefined`; therefore `GET /api/v1/transactions?tagId=` (or whitespace) reaches the service without a tag filter and returns the unfiltered result rather than a 400. Unknown nonblank IDs do correctly throw validation. This is especially risky for clients that intend an ID filter but accidentally send a blank value.
- **Impact:** A malformed/unknown selector silently falls back to an unfiltered list, contrary to the stated no-silent-fallback validation requirement.
- **Minimum fix:** Parse `tagId` distinctly from optional filters: absent means no filter; present but blank is `ValidationError`; nonblank unknown/deleted remains 400. Test absent, blank, whitespace and unknown separately.

### [P2] Backfill IDs are based on truncated labels without enforcing full legacy parser semantics

- **Source:** `packages/server/src/db/migrations/013-tag-hierarchy.ts:17-21`; `packages/server/src/services/tag-catalog-service.ts:22-26`
- **Evidence:** The migration uses `trim(substr(value,1,32))`, while `parseTagsJson` trims first and then slices the normalized name (`tags.ts:20-30`). The query's substring-before-trim also differs for strings with leading whitespace, and list counts truncate without trimming. Existing valid API writers normalize before persistence, but legacy/direct SQL values are explicitly in scope for defensive backfill and writer compatibility.
- **Impact:** A legacy value with leading whitespace can be catalogued/count differently from `parseTagsJson`, and names containing spaces at the 32-character boundary can get a different canonical label. It risks unstable identity or a hierarchy count that cannot match the legacy DTO association.
- **Minimum fix:** Make migration and counts follow the exact current canonicalization contract (trim then cap at 32; deduplicate is not needed for identity but should not change transaction JSON), and pin boundary cases with raw bytes preserved.

### [P2] Migration 013 failure rollback is not directly tested; full path unavailable in this environment

- **Source/tests:** `packages/server/test/db.test.ts:84-109,329-345`
- **Evidence:** The added migration test verifies an upgrade through 012, byte preservation for one row, and rerunning the migration runner; the other test proves the generic runner transaction with a synthetic table-and-throw probe, not a failure occurring partway through migration 013 itself. Existing `initializeDatabase` coverage indirectly runs 013 on a fresh DB, but no 013-specific failed-DDL rollback assertion checks absence of `tags`, indexes, triggers, and version 13 after failure. I attempted the requested focused Vitest command from `packages/server`; it failed before tests because `pnpm exec vitest` reported `Command "vitest" not found`. No dependency installation was attempted.
- **Impact:** Fresh and runner idempotence have source-level/general coverage, but migration-013-specific failed rollback and full route/service focused test results remain unverified in this review. Do not report the implementation report's prior 203 tests as independently rerun.
- **Minimum fix:** Add a controlled test invoking the migration runner with a migration-013 SQL fault after partial DDL and assert all 013-created objects/data/version roll back. Re-run the allowed focused suite in an already-provisioned local workspace and record actual output.

### [P2] Migration and triggers can catalogue more than the 20-tag association limit

- **Source:** `packages/server/src/db/migrations/013-tag-hierarchy.ts:19-21,31-35,46-50`; `packages/server/src/services/tags.ts:16-40`
- **Evidence:** The canonical normalizer caps associations at `MAX_TAGS=20`, while SQL backfill and triggers catalogue every string member with no index/count bound. Direct SQL writers can insert a >20-element valid array: readers expose only the first 20, but the metadata table can contain names from later elements. The trigger also ignores container type (see P1).
- **Impact:** Catalog names can appear despite not belonging to any association visible under the established parser; catalog and list semantics diverge for oversized legacy/direct-write rows.
- **Minimum fix:** Align SQL catalog extraction to the same first-20 string-element behavior after array validation, or establish a synchronizer that receives only normalized lists. Add a 21-tag SQL regression proving no metadata for the unexposed 21st association and unchanged JSON.

## Confirmed/source-checked items

- Migration 013 is appended as migration 13 in the current `MIGRATIONS` array; no test assertion was found that hardcodes migration count/version 12 or would have had its assertion weakened/removed.
- Migration backfill selects transaction rows without filtering `deleted`, so it intends to include deleted bills. The added byte-preservation test itself uses a live row, so this deleted-row property is not independently test-asserted.
- Migration backfill does not update `transactions`; the test confirms one raw JSON string remains unchanged.
- `GET /api/v1/tags/hierarchy` calls a SELECT-only `list()`; no catalog write is invoked on GET.
- Deletion semantics are distinct in source and match the slice contract: hierarchy `DELETE /api/v1/tags/hierarchy/:id` soft-deletes metadata only and leaves legacy associations untouched; legacy `DELETE /api/v1/tags/:name` retains its historical behavior of removing associations from live transaction rows and then soft-deleting matching metadata. This is not the same as deleting an entity as a side effect of removing an association. The API documentation/client copy should preserve this distinction; no entity hard-delete occurs.
- Child filter is exact and parent filter uses correlated `EXISTS`; this avoids row multiplication and preserves existing filters. `tag` plus nonblank `tagId` is rejected. Existing filter tests do not comprehensively assert blank/unknown, AND combinations, deleted-only count exclusion, or malformed/non-array payload behavior.
- Mutating hierarchy routes are registered in `registerMasterDataRoutes`, and `app.ts:149` registers that route module under the existing auth-module descendant encapsulation; this matches the auth/plugin guideline at source level. The shown tests exercise authenticated route helpers, but no independent auth/CSRF matrix was run due missing Vitest executable.
- `normaliseTags` still imposes the 32-character and 20-association limit on existing service writes; the new metadata service rejects overlong entity names. Direct catalog imports are not a change to legacy DTO arrays.
- No explicit reparent implementation cycle can exceed two levels when all extant parent data is valid: parents must be active roots and a root with active children cannot become a child. The unresolved orphan condition is primarily caused by source merge/soft-delete behavior above.

## Verification performed

- Read current WIP diff and implementation report; compared migration ordering and source routes/services against the specified backend slice.
- Ran a local in-memory Python SQLite probe using SQL equivalent to migration 013's `json_each` guard semantics. It reproduced catalog insertion from valid object/scalar JSON.
- Attempted focused server tests: `pnpm exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts test/portability.test.ts test/import-batch-confirm.test.ts` from `packages/server`; blocked because the local Vitest executable is unavailable. No tests are claimed passing here.
- Did not run dependency installation, live provider/network tests, production/device tests, or deployment.

## Required handoff

Backend owner should address the P1 findings before treating tag foundation as accepted, then add focused route/migration regressions and rerun the approved local suite. This review artifact is the only file written by this review; no implementation fixes were attempted.