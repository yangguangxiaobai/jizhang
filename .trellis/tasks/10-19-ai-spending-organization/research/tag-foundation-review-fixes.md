# Tag-foundation independent review fixes

Status: addressed in source; independent re-review is still required. This document supplements, and does not replace or overwrite, `tag-foundation-independent-review.md`. Scope remains the backend tag-foundation slice only. Migration 013 is additive; migrations 001–012 were not edited. No Android/provider/product/deployment/production/dependency/git operations were performed. Existing mixed WIP was preserved.

## Findings and fixes

1. **Valid non-array and malformed JSON (P1):** migration 013 backfill and both association-catalog triggers now pass only JSON arrays to `json_each`; invalid syntax and valid object/scalar JSON map to `[]`. Canonical SQL parsing trims first, caps each string to 32 characters, de-duplicates by first occurrence and limits to 20 unique names. The transaction filter uses the same defensive JSON type gate and normalization, so catalog/filter reads cannot mistake an object key or scalar string for a tag. Migration/trigger SQL does not rewrite `tags_json`.
2. **Legacy rename orphan/cross-branch merge (P1):** name-based merge onto an active tag now checks source and target hierarchy positions and active children before opening the rewrite transaction. Any merge that would orphan active children or collapse different hierarchy positions returns domain `409 Conflict`; same-position leaf merges preserve the existing flat-name merge behavior and survivor ID. Tests assert source/target hierarchy state remains unchanged on rejection.
3. **Parent count aggregation (P2):** hierarchy DTO counts now parse live transaction tags through `parseTagsJson`. Root count includes its own name and active child names, counting a transaction once if any match; child count is exact. Deleted transaction rows are excluded. The regression case includes direct parent, child, both on the same transaction, and a deleted child-associated transaction; root count is checked against deduplicated `tagId` total.
4. **Blank `tagId` (P2):** route parsing distinguishes absent from provided-empty/whitespace; a provided blank selector throws the established `ValidationError` (400). Service direct callers also reject a blank `tagId` instead of silently omitting the filter. Tests cover omitted, empty, whitespace and unknown IDs.
5. **Canonical trim/truncate semantics (P2):** migration, trigger extraction, hierarchy count and transaction tag filtering use trim-before-cap semantics; tests pin leading/trailing whitespace and >32-character values while asserting raw JSON remains byte-identical.
6. **Migration-013 rollback coverage (P2):** test applies migrations 001–012, injects a conflicting trigger so migration 013 fails after creating its table/index, then asserts the table, index, update trigger, and migration version 13 were rolled back.
7. **20-association limit (P2):** migration backfill and insert/update triggers deduplicate in first-seen order before applying the 20-unique-name cap, matching `parseTagsJson` rather than simply considering the first 20 raw array positions. Regression arrays include a duplicate before the boundary and assert the first excluded unique name is not catalogued.

## Verification evidence

Commands executed from `packages/server` using the existing local pnpm/Vitest binaries; no dependency install was attempted:

- `pnpm exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts` — **139 tests passed across 4 files** after source/test fixes.
- `pnpm run lint` — **passed** (ran concurrently with the above focused test command).
- `pnpm run typecheck` — first attempt **failed** on a newly added test fixture whose tuple literals inferred `string | undefined`; this was corrected with an explicit tuple-array type. The final typecheck result is recorded below after running again.
- An earlier focused run (before the final parity tests) first failed at transform due to a duplicate local declaration; removed. The next focused run passed 133/133. These failed attempts are recorded, not treated as passing verification.
- `git diff --check` was run before the final documentation/test edits and passed; the final post-edit rerun is recorded below.

Review worker reported `vitest` missing in a different environment. This workspace has `packages/server/node_modules/.bin/vitest` and `pnpm exec vitest` successfully ran locally. The previous implementation report's 203-test result is historical and was not independently rerun here; this report makes no claim of a full feature pass.

## Re-review handoff

The independent review remains **BLOCKED pending reviewer re-run**. This is not an acceptance of the complete AI spending organization feature. Re-review the seven findings above, especially SQLite JSON safety/canonicalization and transactional rollback behavior. No provider, Android, production DB, device or deployment verification is implied.

- `cd packages/server && pnpm exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts` — **139 tests passed across 4 files**.
- `cd packages/server && pnpm run lint` — **passed**.
- `cd packages/server && pnpm run typecheck` — **passed**.
- `git diff --check -- <owned files>` — **passed**.

The final focused test/typecheck/lint run was repeated after the last SQL normalization edit. These commands were run using installed local tooling; no dependencies were installed.
