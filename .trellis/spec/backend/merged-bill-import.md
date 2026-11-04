# Merged assistant bill import (backend)

> Evidence scope: current source in `packages/server/src/routes/import-batches.ts`, `services/import-batch-service.ts`, `services/import-batch-types.ts`, `services/import-batch-identity.ts`, `services/import-batch-analysis.ts`, `services/xlsx-lite.ts`, `services/bill-decode.ts`, `services/assistant-types.ts`, `db/migrations/012-import-batches.ts`, `db/migrate.ts`, and `packages/shared/src/{platform-bills,csv}.ts`. This documents observed source behavior, not every approved product requirement. Benchmark values remain uncalibrated against user exports.

## Scenario: multi-file merged bill import

### 1. Scope / Trigger

- Trigger: create one bounded, server-owned import workspace from 1–5 uploaded WeChat XLSX / Alipay CSV files; inspect merged rows, run optional advisory analysis, collect a human review and make one atomic final ledger write.
- This is a dedicated route/storage/DTO path, separate from the existing one-file assistant import path. Legacy preview/confirm and generic assistant JSON budgets remain unchanged (legacy row limits 200/100; generic assistant JSON array/object bounds 200/100).
- Source evidence: route registration is delegated from `routes/assistant.ts` to `routes/import-batches.ts` inside the assistant route module; new routes require the same authenticated plugin context and CSRF hooks. Global `app.ts` JSON body budget remains 8 MiB; byte-upload batch routes locally specify `MERGED_BODY_LIMIT=12 MiB`.
- Not established by this spec: a real export benchmark or production safety calibration. Numeric parser limits are implemented refusal thresholds only; do not call them measured-safe.

### 2. Signatures (HTTP / DB)

All routes are under `/api/v1/assistant/conversations/:conversationId/import-batches` and use `{ error: { code, message } }` on errors.

| Method and path | Observed request / response |
|---|---|
| `POST /.../import-batches` | `{ files:[{fileName,source?,fileBase64}], clientRequestId, analyse? }` → `201 {batch}` for create, `200 {batch}` on idempotent replay. `source` accepts `auto|wechat|alipay`; `analyse` defaults true. |
| `GET /.../import-batches/:batchId` | → `{batch}`; `Cache-Control: no-store`. |
| `GET /.../:batchId/rows` | Query `limit`, `cursor`, `filter`, `includeVersion` → dedicated `ImportBatchRowsPageDto` with version/revisions, rows, total and next cursor. |
| `GET /.../:batchId/rows/:itemId/duplicates` | Query `limit`, `cursor`; readonly server comparison page. |
| `GET /.../:batchId/categories` | Query `includeVersion`; active categories + suggestions and view revision. |
| `POST /.../:batchId/review` | `{version,analysisRevision,viewRevision,selectedItemIds,categoryAssignments,noteOverrides,approvedCategories,conflictDecisions}` → `{reviewToken,version,analysisRevision,viewRevision,expiresInSec,summary}`. |
| `POST /.../:batchId/analyse` | `{clientRequestId,files:[{fileIndex,fileBase64}]}` → `202 {batch}` accepted; `200` replay. Analysis is asynchronous. |
| `POST /.../:batchId/files/:fileIndex/remove` | `{expectedVersion,clientRequestId,targetFileIndex?,files:[{fileName,source,fileBase64}]}`; body gives the resulting full file set. |
| `POST /.../:batchId/files/:fileIndex/replace` | `{expectedVersion,clientRequestId,files:[{fileName,source,fileBase64}]}`; body gives all resulting original files. |
| `POST /.../:batchId/confirm` | `{reviewToken,expectedVersion,files:[{fileIndex,fileBase64}]}` → `{batch,result}`. |
| `POST /.../:batchId/cancel` | `{expectedVersion,clientRequestId}` → `{batch}`. |

Migration 012 (`db/migrations/012-import-batches.ts`) additively creates `assistant_import_batches`, `assistant_import_batch_rows`, `assistant_import_batch_categories`, and `assistant_import_batch_operations`, plus batch/row indexes. It persists metadata, parsed facts, review/result and operation idempotency records, not original file bytes. No existing table is altered by migration 012.

### 3. Contracts (fields, caps, auth, atomicity, idempotency, live view)

#### Request and response fields

- File input names must be 1–200 characters and contain no path separator/NUL; extension is CSV or XLSX and explicit source must match. Base64 is decoded by the server; client digests, item IDs and ledger IDs are not authority inputs.
- `categoryAssignments[itemId]` is `{kind:'existing',categoryId}` or `{kind:'suggestion',suggestionId}`. `approvedCategories[]` currently uses wire `resolution:'create'` with optional `reuseCategoryId`; this allows reuse to be explicit without a separate wire enum. Approved category proposals contain suggestionId/name/type/parentId.
- Review summary is server-authored and includes selected count, amount, expense/income/refund-income, selected row category/name/type/note, source file counts, exclusions/conflicts and selected category create/reuse counts. Explicit empty note override clears; absence preserves resolved source note.
- `summary.counts.userExcluded` is `null`: the server has no authoritative persisted user-exclusion field. Do not describe rule-ignored rows as user-excluded. `ruleIgnored`, preexisting, conflicts are overlapping attributes, not a mutually exclusive partition.
- Import result distinguishes inserted/selected, excluded and preexisting. Existing code treats selected as inserted on success; it does not define an automatic `ignored` exclusion—positive parser rows with informational status reasons can still be explicitly selected.

#### Authorization and ownership

- Batch writes are authenticated assistant mutations and inherit the assistant route plugin's session/CSRF hooks. Each service operation verifies conversation and batch ownership; unowned or archived-context records are not treated as the caller's batch. Keep route registration in the same protected Fastify encapsulation context.
- Read-only GETs do not invoke the provider. Review and confirm do not invoke the provider either.
- New import is isolated from registry tools, `assistant_pending_actions`, legacy `/actions/:id/confirm`, and legacy import cards. The lightweight assistant card uses `kind='text'` plus additive `content.importBatch`; do not relax the required payload rules for `kind='tool-card'`.

#### Bounds and limits

Feature constants in `import-batch-types.ts`: at most 5 files; 5 MiB/file; 8 MiB aggregate source bytes; 12 MiB route body; 3000 raw data rows/file and 5000/batch; 64 columns; 1000 characters/cell; 64 ZIP entries; 8 MiB inflated entry; 16 MiB shared aggregate inflation across the batch; 6 MiB decoded text/file and 16 MiB aggregate; cooperative 3000 ms parser deadline; 500 materialized items; 5000 source references; page max 100/default 50; review TTL 900 s; at most 20 new-category suggestions and 20 sequential provider calls of 25 rows (10 min overall analysis budget).

These limits reject rather than truncate. XLSX central-directory/local-header and decompressed-length checks precede/guard materialization. CSV has optional incremental bounds; legacy callers that omit limits keep their old behavior. Deadline is cooperative, not hard CPU preemption. The migration check is not a parser performance benchmark; do not claim real-export calibration or safety until separately measured and recorded.

#### Category and eligibility boundary

- Existing category assignments are checked against current active, bookable leaf categories of the transaction's type at review/confirm. Suggestion assignment requires that suggestion to be explicitly included in approved categories; only approved suggestions referenced by selected rows are created/reused.
- Review rejects malformed/missing assignments, invalid category IDs/types, failed-file state, running analysis, and stale versions/views. Selection is separately constrained by positive amount, not already existing, conflict eligibility, and explicit conflict decisions.
- `weak_collision` and `ledger_collision`: any member selected is rejected. `fact_conflict`: explicitly choose zero or one member (or exclude the group). Legacy weak `pb-` matches are advisory, not a hard blocker. Rule-status/ignored reason remains informational when the row otherwise meets eligibility.
- New category uniqueness/reuse is revalidated against current catalog in the final transaction. Wire currently represents both create/reuse via `resolution:'create'` plus optional `reuseCategoryId`; exact-one active matching leaf may be reused by service rules, ambiguity must be explicitly resolved, and no soft-deleted category is restored.

#### Live view and atomic confirmation

- GET batch/rows/categories provide a current read-only `viewRevision` based on batch facts and live catalog/account/eligibility inputs. GET does not mutate DB state. `POST review` checks the submitted view inside a transaction; mismatch is stale (409) and does not silently rebase. The user must reread, then explicitly submit review against the fresh view.
- Review stores the full normalized review set, revisions, current view/base/category fingerprints, random opaque review token and expiry. A new review replaces the old one. Client-local unsent edits cannot be observed server-side; client must discard its local token and request a new review after edits.
- Confirm retransmits every original file. Bytes are decoded, hashed, parsed and merged before the DB write transaction. The final synchronous SQLite transaction rechecks batch ownership/state/version, review token/TTL/revisions/view/catalog/eligibility and live transaction IDs, then resolves account/category references, creates/reuses approved-used categories, inserts selected transactions and stores confirmed result/provenance. No await/provider/network work belongs inside that transaction. Any failure rolls back the complete write set.
- Same confirmed review token and file digests returns the stored original result; changed token/files conflict. New ledger/catalog/eligibility changes since review return stale; do not silently skip a newly existing transaction or alter reviewed totals. `GET batch` is the read path for uncertain network outcomes.
- Cancel/archive fencing updates persistent metadata before aborting in-flight provider reads. Cancel does not write financial/master data. Confirmed rows/history are retained; no automatic batch cleanup is evidenced here.

### 4. Validation & Error Matrix

| Condition | Observed behavior |
|---|---|
| Invalid body shape, request ID, file name, source/extension or base64 | `400 ASSISTANT_INVALID` |
| File/count/byte/parse/inflate/text/row/item/source budget exceeded | `400 IMPORT_BATCH_LIMIT_EXCEEDED` (no cropping) |
| Duplicate file bytes within one batch | `400 IMPORT_BATCH_DUPLICATE_FILE` |
| File parse failure | Persisted failed-file status; browse allowed, review/confirm blocked until explicit remove/replace; counts stay unknown (`null`) rather than fabricated zero. |
| Required category absent/invalid assignment | `400 IMPORT_BATCH_CATEGORY_REQUIRED` or `ASSISTANT_INVALID` depending validation boundary |
| Category ambiguity/conflict | `400 IMPORT_BATCH_CATEGORY_CONFLICT` |
| Wrong owner/not found | `404 ASSISTANT_NOT_FOUND` |
| Stale version/review/view/eligibility | `409 IMPORT_BATCH_STALE_VERSION` or `409 ASSISTANT_ACTION_STALE` according to boundary |
| Reused idempotency key with different payload | `409 IMPORT_BATCH_IDEMPOTENCY_MISMATCH` |
| Confirmed batch with different review/files | `409 IMPORT_BATCH_ALREADY_CONFIRMED` |
| Active assistant provider/generation lock | `409 ASSISTANT_GENERATION_ACTIVE` |
| Missing auth or CSRF | Existing session/CSRF contract (`401`/`403`); assertions must include both status and standard error shape. |

### 5. Good / Base / Bad Cases

- **Good:** Two files with the same full platform order ID and identical financial facts yield one merged row with both source refs. Review a positive row, explicitly assign an active same-type category, issue an opaque review token, and confirm once. All transaction/category/result writes commit atomically.
- **Base:** A row has a parser rule/status reason or an advisory legacy weak-ID match. Surface that reason; the user can still include a positive, nonexisting, otherwise eligible row. A missing provider or failed all-or-nothing analysis leaves manual review available; do not relabel deterministic fallback as successful AI output.
- **Bad:** Select a member of a weak/ledger collision, use a deleted/wrong-type category, change bytes after review, or let live ledger state change between review and confirm. Reject the selection or mark review stale; never choose an arbitrary row, silently skip, truncate rows, partially publish AI recommendations, or leave partial final writes.

### 6. Tests Required (assertion points)

- Route tests via `app.inject()` assert auth/CSRF, wrong-conversation ownership, response envelope/status, route-specific 12 MiB caps, unchanged global body budget, GET read-only behavior and no provider calls on GET/review/confirm.
- Migration tests from a genuine pre-012 schema assert existing-table schema/row preservation, four new tables and indexes, `integrity_check=ok`, no FK violations and second initialization idempotence. A fresh post-initialize database is not a pre-012 baseline.
- Parser/service tests assert file/aggregate bounds, 500/501 behavior, pre-materialization XLSX/CSV limits, no original-byte persistence, duplicate file handling, status-rule selectable eligibility, weak collisions blocked, legacy weak matches advisory, and full financial-identity behavior.
- Review/confirm integration tests assert opaque token/full review binding/expiry, live-view staleness/re-read, explicit empty note semantics, current-category leaf/type checks, operation/idempotency replay and mismatch, confirmed replay, no silent skip after ledger changes, and rollback of all state on injected final-row failure.
- Analysis tests assert GET does not start a provider, analysis states and cancellation/restart fences, whole-run all-or-nothing publication, no partial AI suggestions on shard failure, fallback separation, and >20 suggestion refusal.
- Do not treat synthetic fixture counts, test-only generated data, or code-inspected constants as real export benchmark evidence. Do not run unrelated full-project tests as part of this spec-only verification task.

### 7. Wrong vs Correct

#### Wrong

```ts
// Put merged rows through the legacy generic assistant JSON path, which has 200/100 limits.
const card = normalizeAssistantJson({ rows: all500Rows, reviewToken });
// Or trust a client digest as proof that bytes match the reviewed file.
```

#### Correct

```ts
// Dedicated DTO/storage retains the 500-item bound; server digests decoded original bytes.
const parsedFiles = parseImportBatchFiles(body.files);
const result = batchService.confirm(conversationId, batchId, {
  reviewToken: body.reviewToken,
  expectedVersion: body.expectedVersion,
  files: parseOriginalFiles(body.files),
}); // synchronous transaction rechecks the reviewed live view and writes all-or-none
```

Do not widen the global assistant JSON budget to accommodate batches. Do not persist original file bytes, treat a legacy weak hash as proof of duplication, or move provider work into final confirmation.
