# Backend implementation status — merged import batch

Status: COMPLETE for the assigned backend scope (all planned stages implemented, tested and verified locally). Independent review, Android integration, and the separately gated real-provider/device/deployment steps remain with the parent.
Owner: yansuu1 (backend sub-agent, exclusive `packages/server/src|test`, minimal `packages/shared/src/platform-bills.ts` + its tests, index if needed)
Frozen sources: `prd.md`, `design.md`, `implement.md`, `research/merged-import-protocol-v1.md` (normative), `research/merged-import-protocol-fixtures-v1.json`, `research/backend-import-investigation.md`.
Evidence floor: parent-confirmed plan `开始`; baseline `artifacts/ai-bill-import-baseline` (205 copied source/test/spec files + full expanded `git status`, 1280 entries).

No authorization for: deployment, dependency install, real provider calls, model/secret/timeout config, real ledger writes, device work, git stage/commit/archive.

## Scope and file plan

| File | Purpose | State |
|---|---|---|
| `packages/shared/src/platform-bills.ts` | optional parser budgets + optional `sourceRow`/`fullExternalId`/`sourceTimestamp` metadata; legacy defaults untouched | DONE |
| `packages/shared/test/platform-bills.test.ts` | new metadata + budget assertions (legacy assertions kept) | DONE |
| `packages/server/src/services/xlsx-lite.ts` | optional bounded zip/inflate limits (structural + per-entry + batch-shared accumulator) | DONE |
| `packages/server/src/services/assistant-active-lock.ts` | shared conversation provider-work exclusion (generation/legacy/batch) | DONE |
| `packages/server/src/services/bill-decode.ts` | pass-through optional decode limits/text-byte cap | DONE |
| `packages/server/src/services/import-batch-types.ts` | constants, DTOs, error taxonomy, dedicated JSON serialisation | DONE |
| `packages/server/src/services/import-batch-identity.ts` | pure canonical JSON / sha256 / identity / merge-order helpers | DONE |
| `packages/server/src/services/import-batch-service.ts` | parse+merge+store+GET+review+confirm+file mutations+cancel | DONE |
| `packages/server/src/services/import-batch-analysis.ts` | bounded sharded AI analysis, all-or-nothing, fences, GET never runs provider | DONE |
| `packages/server/src/db/migrations/012-import-batches.ts` | four additive tables | DONE |
| `packages/server/src/db/migrate.ts` | register migration 012 | DONE |
| `packages/server/src/routes/import-batches.ts` | authenticated plugin routes | DONE |
| `packages/server/src/app.ts` | register batch routes inside `extraRoutes` | DONE |
| `packages/server/src/services/assistant-types.ts` | additive `content.importBatch` on `kind='text'` | DONE |
| `packages/server/test/import-batch-identity.test.ts` | identity/merge/order unit tests | DONE |
| `packages/server/test/import-batch.test.ts` | route/service/e2e contract tests | DONE |
| `packages/server/test/import-batch-analysis.test.ts` | analysis fences/all-or-nothing/budget tests | DONE |
| `packages/server/test/import-batch-confirm.test.ts` | review/confirm/category/file-mutation/rebase tests | DONE |
| `packages/server/test/import-batch-limits.test.ts` | caps, refund facts, XLSX ceilings, message allowlist | DONE |
| `packages/server/test/benchmark/import-batch-bench.ts` | local synthetic budget calibration | DONE |

Not owned / not touched: `clients/android/**`, `README.md`, `.trellis/spec/**`, `packages/web/**`, `packages/cutout/**`, task artifacts other than this file.

## Checklist (protocol resolutions)

- [x] 012 four additive tables (batch/rows/categories/operations); no shipped migration edits.
- [x] Dedicated batch DTO/serialisation; generic assistant JSON 200/100 and global 8 MiB body unchanged.
- [x] New routes inside the authenticated plugin (`extraRoutes`), CSRF for mutations, ownership check per route.
- [x] GET never starts a provider; review/confirm never start a provider.
- [x] Server-computed `requestHash` from real decoded bytes + metadata + options; no client hashes.
- [x] Create idempotency on the batch row; analyse/remove/replace/cancel idempotency in the operations table; replay before consumed-version check; mismatch 409.
- [x] Materialised item cap 500 inclusive of ignored/existing/conflict; >500 rejects without cropping.
- [x] Strong identity merges identical facts across files with all sources; note is not a conflict; full `sourceTimestamp` participates.
- [x] Weak (no order id) occurrence identity = full file digest + source row; weak legacy `pb-` match advisory only.
- [x] Hard `alreadyExists` only from strong ledger id / occurrence ledger id.
- [x] `fact_conflict` 0-or-1 with explicit decision; `ledger_collision`/`weak_collision` any selection rejects.
- [x] AI `existing|new|null` mutual exclusion, all-or-nothing publication, deterministic fallback kept separate, >20 suggestions explicit failure.
- [x] Analysis states `idle|running|complete|failed`; owner/version/revision fences written before abort; restart marks `running` failed without rerun.
- [x] `categoryAssignments` discriminated union required per selected row; `newOther` fallback proposal still needs approval.
- [x] Review issues an opaque random token, stores the full normalised set with expiry, replaces older tokens, invalidated by analysis/file/cancel changes.
- [x] Confirm re-parses the retransmitted originals outside the DB write transaction, then one synchronous transaction writes accounts/categories/bills/result; no provider inside.
- [x] Same confirmed token + file digests returns the original result; different payload 409; live changes 409 instead of silent skip.
- [x] File failure entries keep unknown counts as `null`, block review/confirm, keep the workspace inspectable, and require explicit removal/replacement.
- [x] Result reports `inserted/selected/excluded/preexisting` (`selected === inserted`), no `skipped` obfuscation.
- [x] Original bytes never persisted; raw rows/metadata only.
- [x] Batch card metadata stays `kind='text'` + `content.importBatch`; no new tool name, no pending action, tool-card validation not relaxed.
- [x] Budgets benchmarked locally (synthetic generator + existing redacted fixtures) and reported; no cap widening, no real export claims.

## Verification log

Baseline before any change: `pnpm --filter @jizhang/server test` → 24 files / 582 tests pass.
Raw combined evidence for the final run (commands, exit codes, test counts, benchmark output, changed
paths): `artifacts/ai-bill-import-batch-verification.log`.

| Stage | Command | Exit | Result |
|---|---|---|---|
| baseline | `pnpm --filter @jizhang/server test` | 0 | 24 files / 582 tests pass (pre-change baseline) |
| shared | `pnpm --filter @jizhang/shared test` | 0 | 7 files / 185 tests pass (incl. new metadata/budget cases) |
| server | `pnpm --filter @jizhang/server test` | 0 | 29 files / 662 tests pass (incl. 5 new batch suites) |
| shared | `pnpm --filter @jizhang/shared lint` | 0 | clean, 0 warnings |
| shared | `pnpm --filter @jizhang/shared typecheck` | 0 | clean |
| shared | `pnpm --filter @jizhang/shared build` | 0 | clean |
| server | `pnpm --filter @jizhang/server lint` | 0 | clean, 0 warnings |
| server | `pnpm --filter @jizhang/server typecheck` | 0 | clean |
| server | `pnpm --filter @jizhang/server build` | 0 | clean |
| budget | `node --expose-gc packages/server/node_modules/tsx/dist/cli.mjs packages/server/test/benchmark/import-batch-bench.ts` | 0 | see "Budget evidence" |

## Budget evidence (local, synthetic, no real export)

Command: `node --expose-gc packages/server/node_modules/tsx/dist/cli.mjs packages/server/test/benchmark/import-batch-bench.ts`
(script: `packages/server/test/benchmark/import-batch-bench.ts`; synthetic CSV/XLSX generator, in-memory SQLite, no production data, no provider, no DB file).

| Scenario | Outcome | Items | Parse ms | Heap delta MiB |
|---|---|---|---|---|
| 5 files × 100 rows (CSV): the 500-item boundary | accepted | 500 | 51 / 50 / 51 (3 runs) | +11.2 / +11.3 / +11.4 |
| 1 file × 501 rows (CSV): one over the cap | rejected `IMPORT_BATCH_LIMIT_EXCEEDED` | — | 9 | n/a |
| 1 file × 3001 raw rows (CSV) | rejected `IMPORT_BATCH_LIMIT_EXCEEDED` (raw-row budget) | — | 27 | n/a |
| 1 file × 64 MiB inflated XLSX (zip expansion) | rejected `IMPORT_BATCH_LIMIT_EXCEEDED` (per-entry inflate budget) | — | 1 | n/a |

These are **local synthetic** figures on this workstation, not real-export calibration. The 500-item
boundary case costs ~50 ms of parsing and ~11 MiB of heap, which is comfortably inside the proposed
budgets on this machine; a real-export run is still required before any safety claim.

## Deviations / notes for the parent

1. `comparisonAccountId` is part of `financialEqual` for merge comparability but **excluded from the `itemId` digest**, so `itemId` stays stable when the live 微信/支付宝 account appears later. No Android field change.
2. `ledgerStatus` in `financialEqual` is a derived semantic value (`bookable|blocked`) rather than display text, because the protocol explicitly excludes display `rawStatus` wording from equality while requiring status semantics to matter.
3. `sourceTimestamp` is normalised to `YYYY-MM-DD HH:MM:SS` (or `null` when the export has no time of day); it never changes `transactions.date`, which stays day-granular via `parseDateLabel`.
4. Budgets are `[FRP]`: implemented as proposed and locally benchmarked; they remain unvalidated against real exports and no claim of safety is made.
5. **Real wrinkle found while implementing:** `platform-bills.ts` truncates strong ledger ids to 64 chars (`wx-{orderId}.slice(0,64)`). Two orders longer than that truncate to the same ledger id; they are now marked as a **`ledger_collision`** and any selection of either member is rejected, matching "never pick 1". A legitimate cross-file merge of the same order id is *not* a collision.
6. **Proposed caps are implemented literally** (5 files, 5 MiB/file, 8 MiB total, 12 MiB route body, 3000/5000 raw rows, 64 columns, 1000 cell chars, 64 zip entries, 8 MiB/entry, 16 MiB batch-shared inflate, 6/16 MiB decoded text, 3000 ms cooperative deadline, 500 items, 20 calls, 15 min review TTL). No cap was widened. The one implementation-level addition is a shared `counter` object threaded through the XLSX reader so the 16 MiB inflate budget is a genuine batch total.
7. `sourceCategory` is stored on the batch row (display/analysis only) and explicitly excluded from financial equality, as the protocol requires.
8. The confirm path recomputes the parsed row projection and **rejects** (409 `ASSISTANT_ACTION_STALE`) if it no longer equals the stored projection, so a review can never be confirmed against a different interpretation of the same bytes.

## Route inventory (all inside the authenticated plugin, CSRF for mutations)

| Method | Path |
|---|---|
| POST | `/api/v1/assistant/conversations/:cid/import-batches` |
| GET | `.../import-batches/:batchId` |
| GET | `.../import-batches/:batchId/rows` (`limit`,`cursor`,`filter`,`includeVersion`) |
| GET | `.../import-batches/:batchId/rows/:itemId/duplicates` (`limit`,`cursor`) |
| GET | `.../import-batches/:batchId/categories` (`includeVersion`) |
| POST | `.../import-batches/:batchId/analyse` |
| POST | `.../import-batches/:batchId/review` |
| POST | `.../import-batches/:batchId/confirm` |
| POST | `.../import-batches/:batchId/files/:fileIndex/remove` |
| POST | `.../import-batches/:batchId/files/:fileIndex/replace` |
| POST | `.../import-batches/:batchId/cancel` |

Legacy single-file routes (`POST /messages` with one attachment, `platform-import.prepare`,
`POST /actions/:id/confirm`, `GET /actions/:id/rows/:rowId/duplicates`) are untouched, as are the
generic assistant JSON 200/100 budgets and the global 8 MiB body limit.

## Resume point

All stages DONE. Remaining: parent-owned spec/README/inventory updates, independent review, Android
integration, and the separately gated real-provider / device / deployment steps. The evidence log for
the run above is `artifacts/ai-bill-import-batch-verification.log`.
