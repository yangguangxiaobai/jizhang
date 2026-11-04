# Tag-foundation Unicode residual follow-up

**Active task:** `.trellis/tasks/10-19-ai-spending-organization`

## Scope and outcome

This follow-up executes the residual P2 review work against the already-present backend tag foundation. It does not implement the broader AI-spending-organization feature. Existing `parseTagsJson` / `normaliseTags` behavior is intentionally unchanged: JS `.slice(0, 32)` is the compatibility contract and counts UTF-16 code units. No migration 001–012, custom SQLite function, product/API expansion, Android/provider/deployment/dependency change, or Git operation was made.

The added tests make the edge cases and current behavior explicit. The SQL-vs-JavaScript supplementary-plane mismatch remains a **known P2**, not a claimed fix. Migration 013, triggers, and transaction filtering currently use SQLite `substr`, which counts Unicode code points. For legacy/direct-SQL rows with `['😀'.repeat(20) + 'tail']`, migration/trigger catalog identity is the full 20-emoji-plus-`tail` string while JS parsing yields 16 emoji; a legacy `tag=` filter for that parsed value does not match. Raw `tags_json` remains untouched.

Under the user’s constraints (preserve parser semantics, no custom SQLite function/CLI initialization, no older migration edits), an exact SQL implementation of UTF-16-code-unit truncation requires a nontrivial SQL-side surrogate-aware character walk, replicated consistently in migration backfill, triggers, and filtering. This change does not introduce that risk/complexity without a demonstrated reviewed approach. The P2 remains visible and reproducible in tests rather than being concealed.

## Regression coverage added

- **BMP cap:** tests verify the existing 32 UTF-16-unit parser cap and that SQLite’s 32-code-point cap agrees for BMP text.
- **Astral boundary:** tests assert the old parser returns 16 emoji at a 32-code-unit boundary; migration/trigger/direct-SQL filtering expose and document the different SQL identity at a 20-code-point boundary.
- **Whitespace / non-strings:** Unicode trim (NBSP, ideographic space and BOM) plus array values containing numbers, null, object and nested array are exercised; only strings become SQL catalog entries.
- **Raw JSON:** migration/trigger assertions verify source `tags_json` is byte-for-byte unchanged.
- **API round-trip and IDs:** legacy transaction POST/GET serialization/parsing keeps the existing JS canonical value; hierarchy listing provides the stable catalog ID and the ID filter is exercised for the API-written canonical entry.
- **Concurrent direct SQL + undo:** after AI tag/category merge apply, a direct SQL tag edit is made. Undo returns `409 AI_ORGANIZATION_CONFLICT`; the external tag value, applied category changes and allocation projection remain untouched; no partial undo audit event is appended.

## Files changed by this follow-up

- `packages/server/test/db.test.ts` — Unicode BMP/emoji/trim/non-string backfill and trigger assertions, with raw JSON preservation.
- `packages/server/test/transactions.test.ts` — parser UTF-16 boundary, legacy API string round-trip + stable ID filter, and the direct-SQL astral mismatch regression.
- `packages/server/test/ai-organization.test.ts` — direct-SQL concurrent tag edit causes all-or-nothing undo conflict, including a second action’s unchanged state.
- This report — residual, tradeoff and verification evidence.

No server production source or migration SQL was changed in this follow-up; migration 013 and relevant services were inspected and tested as the existing implementation.

## Verification

Commands run from `packages/server` unless noted:

- `pnpm exec vitest run test/db.test.ts test/master-data.test.ts test/transactions.test.ts test/ai-organization.test.ts test/portability.test.ts test/import-batch-confirm.test.ts` — **6 suites, 212 tests passed**.
- Root `pnpm run lint` (workspace recursive lint) — **passed**.
- Root `pnpm run typecheck` (workspace recursive typecheck) — **passed**.
- An initial attempt to invoke `pnpm exec vitest` at the repository root failed because Vitest is package-local; rerunning from `packages/server` succeeded. No dependencies were installed.

These are local source/test checks only; no provider, production database, device or deployment verification is claimed.

## Remaining P2

SQL `substr` code-point truncation is not equivalent to JS UTF-16 `.slice` truncation for astral symbols at the 32-unit boundary. This can diverge in migration/backfill, direct SQL trigger cataloging and legacy `tag=` filtering versus `parseTagsJson` values. The legacy API writer’s normal path normalizes via JS and its stable ID round-trip is tested, but the direct-SQL/legacy malformed or out-of-band data edge remains. Resolve only with a reviewed surrogate-aware SQL strategy applied consistently to backfill, both triggers and filter SQL, or a separately approved canonicalization change (which would alter old parser semantics). Do not mark this P2 resolved based on this follow-up.
