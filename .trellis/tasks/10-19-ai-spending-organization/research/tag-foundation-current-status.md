# Tag foundation — current status

**Active task:** `.trellis/tasks/10-19-ai-spending-organization`

**Status: tag-foundation slice implemented, independently reviewed, review findings fixed, and green. It is still not the full feature and has not been deployed or committed.**

## What this continuation did

The previous continuation had rolled the workspace back to a clean pre-feature baseline (migrations 001–012, no `tags` table, no `tagId`, no hierarchy routes). That baseline was verified green: `typecheck` ✅, `lint` ✅, server tests 31 files / 686 ✅.

This continuation rebuilt the server tag-foundation slice from `research/tag-foundation-contract.md` with a **TypeScript-side canonicalization** design instead of the earlier JSON1/SQL-trigger design that lost lone escaped surrogates and U+FFFE/U+FFFF through SQLite `unicode()`. A reviewer subagent then independently reviewed the slice; its findings were addressed and re-verified.

## Design (differs from the old JSON1 implementation)

- **Migration 013** creates the additive `tags` metadata table (`id`, `name`, `parent_id`, `deleted`, `created_at`, `updated_at`), a partial unique index on active `name`, and a `parent_id` index. A TypeScript `run(db)` hook backfills distinct normalized names from **all** transaction rows (live and soft-deleted) without rewriting any `tags_json` byte; malformed JSON is skipped; the backfill is idempotent. The runner runs the SQL, the `run` hook, and the version record inside one transaction, so a throwing hook rolls everything back and never records the version.
- **No SQLite triggers and no JSON1 for identity.** Canonical identity is computed in JS (UTF-16 code-unit hex key) via `tags.tagNameKey`; SQLite only stores the name as UTF-8. `unicode()` is never used.
- **`TagCatalogService`** (new) owns hierarchy metadata: `list` (with live usage counts), `getById`, `childrenOf`, `create` (random-UUID id — re-creating a soft-deleted name yields a **new identity**), `update` (rename preserves id; a child may be reparented to another root; a root with children cannot become a child), and `softDelete` (blocked while active children exist).
- **Explicit sync boundary** (no triggers): transaction create/update, AI-organization tag projection writes, and portability CSV import call `ensureTag`. `ensureTag` resolves **by name first** and returns the existing entity's real id (so a renamed tag keeps working), reactivates soft-deleted metadata, and only falls back to a deterministic id for a brand-new name. Import-batch inserts always write an empty tag array, so no tag metadata is created there. Legacy rename/delete (`PATCH/DELETE /api/v1/tags`) updates or soft-deletes the metadata in the same transaction as the row rewrite.
- **Legacy rename merge guard**: renaming a parent tag onto a name that already exists is rejected (409) when the parent still has active children, so a merge can never soft-delete a parent and orphan its children.
- **Hierarchy API** in the protected master-data plugin: `GET /api/v1/tags/hierarchy` is read-only; `POST/PATCH/DELETE` use the existing auth/CSRF conventions.
- **`tagId` transaction filter**: child id matches that exact tag name; parent id matches its own name plus every active child name; deduplicated by OR-composed raw `tags_json LIKE` predicates (same byte-safe mechanism as the existing `tag=` filter); `tag` + `tagId` together is 400; unknown/soft-deleted id returns an empty result. For a child id the match set is exactly its own name because a child cannot itself have children (two-level cap).

## Independent review outcome

The reviewer subagent returned **需修改** with five findings. Disposition:

1. *Child filter over-matching* — **false positive**: `childrenOf(child)` is always empty under the two-level cap, so a child id matches only its own name; the existing test already asserts this. No change.
2. *Legacy rename could soft-delete a parent and orphan active children* — **fixed**: merge onto an existing name now throws `ConflictError` when the source is a parent with active children; regression test added.
3. *Migration failure test did not exercise the `run` hook* — **fixed**: `runMigrations` accepts an optional migrations array, and a test injects a migration whose `run` throws, asserting rollback and that the version is not recorded.
4. *Unused lossy decoder helpers* — **fixed**: removed `tagNameFromKey` and `tagEntriesJson`; added a test that `tagNameKey` is lossless for lone UTF-16 surrogates.
5. *Hierarchy endpoints lacked explicit auth/CSRF tests* — **fixed**: added no-session (401) and missing-CSRF (403) regression tests for the hierarchy routes.

## Verification (this workspace)

- `cd packages/server && pnpm run typecheck` — **passed**.
- `cd packages/server && pnpm run lint` — **passed** (max-warnings 0).
- `cd packages/server && pnpm run test` — **passed: 32 files / 701 tests**.

New/updated test files: `test/tag-catalog.test.ts` (new), `test/db.test.ts`, `test/master-data.test.ts`, `test/transactions.test.ts`.

## Known limitation (documented, not fixed in this slice)

Identity (`id` = `tag-` + UTF-16 hex key) is byte-lossless, but the display `name` column and its active-name unique index are SQLite TEXT. Two distinct legacy names that differ only in lone UTF-16 surrogates would collide in that TEXT index/display; `tagId` filtering for such names is therefore approximate. The legacy `tag=` filter remains byte-exact on the raw `tags_json`. This edge is unreachable from normal UI/CSV input (only crafted JSON with `\uD800`-style escapes) and is deferred to a later slice if byte-exact hierarchy lookup for such names is ever required.

## Remaining / not claimed

- This is the tag-foundation slice only. The full AI spending organization feature (date-range analysis, review cards, note-suggestion lifecycle, atomic apply/conditional undo, the evidence-backed cap) is **not implemented and not approved**; `implement.md` pre-start gates remain open.
- Android/shared/spec/README were not touched. No deployment, no production migration, and **no git commit** was performed.
- The isolated `services/tag-sql.ts` + `test/tag-sql.test.ts` helper is retained unchanged as an experiment; it is not part of the integrated design above.
