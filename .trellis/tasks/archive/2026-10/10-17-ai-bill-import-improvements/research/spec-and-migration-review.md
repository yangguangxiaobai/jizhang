# Spec and migration evidence review — merged import

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Scope: source-backed backend contract/spec update and local SQLite migration 012 inspection only. No product, tests, Android or README edits; no full project tests; no provider/device/deployment/dependency/model-config work; no staging/commit/archive/todo changes.

## Read set

- `check.jsonl` and task `prd.md`, `design.md`, `implement.md`.
- Frozen contract `research/merged-import-protocol-v1.md`.
- Backend investigation and reviews: `backend-independent-review.md`, `backend-eligibility-review.md`, `backend-live-view-review.md`; also consulted their verification records where referenced.
- Source: `packages/server/src/routes/import-batches.ts`; `services/import-batch-service.ts`, `import-batch-types.ts`, `import-batch-identity.ts`, `import-batch-analysis.ts`, `services/xlsx-lite.ts`, `services/bill-decode.ts`, `services/assistant-types.ts`; `db/migrations/012-import-batches.ts`, `db/migrate.ts`; `packages/shared/src/platform-bills.ts`, `packages/shared/src/csv.ts`.
- Existing spec pages: backend `index.md`, `ai-provider.md`, `directory-structure.md`, `error-handling.md`, and `database-guidelines.md`.

## Source-backed implementation facts and important limits

- New routes are a separate route module wired from assistant routes. Create/review/analyse/remove/replace/confirm set the feature body limit to 12 MiB; global JSON body budget is not changed. GET is read-only; review/confirm contain no provider work. Current source has dedicated DTO/storage and does not send batch row arrays through generic assistant JSON normalization.
- Current request fields include `clientRequestId`, source file bytes, `viewRevision`, normalized review fields and opaque `reviewToken`; current approved-category wire is `resolution:'create'` plus nullable `reuseCategoryId` (reuse isn't a separate resolution enum). The current protocol/spec must describe that actual wire shape.
- Migration 012 defines four new tables (batches, rows, category suggestions, operation idempotency) and four `idx_import_*` indexes. It adds no columns to existing tables and stores parsed/source/review facts, not original raw bytes.
- Parser constants currently enforce 5 files, 5 MiB/file, 8 MiB total source bytes, 12 MiB request limit; 3000 raw rows/file and 5000 aggregate; 64 columns/1000 chars; 64 ZIP entries, 8 MiB per entry, 16 MiB batch-wide inflation; 6 MiB decoded text/file and 16 MiB total; cooperative 3 s deadline; 500 materialized rows/5000 source refs; 900 s review TTL. These are implemented thresholds, not genuine-export benchmark evidence.
- Eligibility uses positive amount, non-existing state, and excludes weak/ledger collision selection. `weak_collision` and `ledger_collision` block any selected member; `fact_conflict` needs zero-or-one explicit resolution. A positive row whose parser reason is status/rule ignored can still be selected; `ignored` is not by itself a human-exclusion flag. Legacy weak-ID matches are advisory only.
- Live GET view revisions are read-only; review validates supplied view and binds a server-issued token to the normalized review. A changed live ledger/catalog view requires re-read/review, not silent skipping. Confirm re-parses and checks retransmitted bytes outside the DB transaction, then revalidates and performs category/account/transaction/result writes in one synchronous transaction.
- Android review artifacts report two cross-layer concerns outside this scope: explicit category approvals must reflect a user gesture (not an auto-approved default); weak-collision blocking must match backend. No Android edits were made here.

## Local pre-012 migration exercise

Script: `artifacts/merged-import-migration-check.mts`; captured output: `artifacts/merged-import-migration-check.log`.

The script creates a temporary DB under the OS temp directory, applies actual migration SQL versions 1–11, then inserts small synthetic catalogue/history rows and snapshots every preexisting user table's schema hash, row hash and count. It applies migration 012 in a transaction, snapshots again, checks table/index preservation, checks the four new tables/indexes, and runs `integrity_check` / `foreign_key_check`. Then it calls the real `initializeDatabase` twice: because version 012 is already applied, the first init performs only normal idempotent seed completion; the second init must make no migration or seed changes. This measures migration preservation before seed completion, so the expected seed additions cannot be misattributed to migration 012. No `DATA_DIR`, production DB, backup, account wallet data or real personal content is opened. The script deliberately does not call `initializeDatabase` before its pre-012 baseline and does not call app seeding until after the migration snapshot; this avoids treating a post-init seed DB as pre-012 and avoids seed-on-boot additions contaminating the migration before/after comparison.

Observed final output (`EXIT:0`):

- Pre-012 migration prefix: versions 1–11; 21 existing user tables.
- Migration run applied `[12]`; `backupPath:null` (temporary probe).
- Existing user tables unchanged: `true`; changed tables `[]`; post-migration user table count 25.
- Existing explicit indexes preserved: `true`; four required new tables all present; four named batch indexes present.
- SQLite `integrity_check`: `ok`; `foreign_key_check`: `[]`.
- Second migration run applied `[]`, pending `[]`; real `initializeDatabase` second run applied no migration and inserted 0 categories/accounts/templates. The first post-migration initialization inserted 7 omitted seed categories and 1 template as expected; the second initialization left DB snapshot unchanged.

This is local SQLite migration evidence only. It is not a real database export, production migration, rollback drill, parser/resource benchmark or proof that configured caps are safe for real user exports. No private/wallet data is included in the artifacts.
