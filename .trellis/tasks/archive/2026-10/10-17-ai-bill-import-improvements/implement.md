# Implementation plan — merged bill import (planning)

Status: IMPLEMENTATION APPROVED by user 开始. Frozen source: research/merged-import-protocol-v1.md, read with design.md and synthetic fixtures. No deployment/install/live-provider/real-booking/config/dependency/commit authorization.

## 1. Approval and baseline
- [x] User requested task creation and native sub-agents.
- [x] User chose merged transactions rather than per-file confirmations.
- [x] User approved 500 merged items, one atomic confirmation, explicit rejection above 500 without truncation.
- [x] User approved human-reviewed new categories created only inside final bill-confirmation transaction, cancelled/failed imports leaving none.
- [x] Present complete final planning summary, including proposed failure/conflict/file-cap policies, and receive fresh approval.
- [x] Freeze API fields, examples and ownership after final approval; run task.py start only then.
- [x] Save the mixed-WIP baseline (tracked/untracked file inventory plus affected file copies); never reset, stage all or commit unrelated work.

## 2. Ownership and architecture
One integrated task: backend/shared and Android depend on one batch contract and one final integration acceptance. A parent/child split is not needed just to run these owners in parallel.

| Owner | Exclusive paths | Responsibility |
|---|---|---|
| Backend | `packages/server/src/`, `packages/server/test/`; minimal `packages/shared/src/platform-bills.ts` and corresponding tests/index if needed | Bounded pure parsing; server identity/merge; additive batch storage/routes/analysis runner; atomic review/confirmation and category handling |
| Android | `clients/android/app/src/main/java/com/yansuu1/jizhang/{ui,ui/feature/assistant,repo,net}`, corresponding tests | SAF multi-select, dedicated batch DTOs, paginated unified workspace, independent global drafts, exclusion/category review, safe uncertain-result reconciliation |
| Parent | Task artifacts, `.trellis/spec/`, `clients/android/README.md` | Protocol arbitration, independent review dispatch, stable inventory and evidence gates |

Use existing Fastify + better-sqlite3 synchronous `db.transaction`, Compose state and pure helpers. Do not introduce ORM, ViewModel architecture, external queue or dependencies. Batch routes own their writes; no new registry tool/pending action, no relaxation of legacy tool-card validation. Add only safe `kind=text/content.importBatch` metadata and display support.

## 3. Ordered execution
### 0 — Freeze/readback (before parallel implementation)
- [x] Reconcile design/contract/UX/PRD and fixture examples; one error/DTO source of truth.
- [x] Confirm request identities are server-computed from validated actual content, not trusted client hashes; token-bound final review carries normalized edit set and authoritative financial summary.
- [x] Check migration next number at implementation time (currently 012); specify additive batch/rows/categories persistence and operation-idempotency records.

### 1 — Backend/shared (parallel with Android after contract freeze)
- [x] Bounded CSV/XLSX entry checks, inflate ceilings, row/column/cell limits and cooperative deadline checks. Optional shared parser limits/metadata preserve legacy behavior. No global JSON-budget increase.
- [x] Proposed caps: 5 files, 5MiB/file, 8MiB total, 12MiB feature-only body; 3000 raw rows/file and 5000 total; 64 columns/1000 chars per cell; ZIP entries≤64, entry≤8MiB and whole-batch inflate≤16MiB; decoded text≤6MiB/file/16MiB batch. All reject explicitly, never crop. Synthetic benchmark evidence exists; real-export calibration remains outstanding and no safety claim is made.
- [x] Full platform-order identity grouping with financial equality, note alternatives and source traceability; distinct no-order occurrences may all be imported, weak legacy matches remain advisory. Exact-origin repeats and stable-ID hard repeats remain blocked. Ledger-ID collisions cannot silently merge or discard legitimate transactions.
- [x] Dedicated batch DTO/storage/hash and page reads (≤100/page), materialized total≤500. Do not pass 500 edits/rows through generic 200/100 assistant JSON normalization or legacy strict-import path.
- [x] File failure records block review/confirm but not workspace browsing; remove/replace retransmit all remaining source bytes and use version/idempotency checks. Retain drafts only where factual content is unchanged; explicitly report invalidated rows.
- [x] Asynchronous bounded AI analysis with independent status/revision, owner/lease/cancellation fences, restart-to-failed without rerun; GET performs no model work. All-or-nothing AI suggestions, explicit failure/no fake success, separate deterministic fallback, >20 new-category suggestions explicit failure.
- [x] Review stores full normalized selection/categoryAssignments/approved proposals, version/analysis revision/catalog/base evidence, expiration and opaque token. Cancel, new analysis or file changes invalidate it.
- [x] Final confirm validates original bytes and review evidence, rechecks live references before any create, then creates/reuses only approved used categories, resolves accounts and writes all selected bills plus result in one transaction. No provider work inside confirmation; no self-stale fingerprint after creating categories.
- [x] Confirm-repeat returns existing result for identical review/source identity; changed confirmed payload conflicts. Changed live ledger since review is stale, never silently changes reviewed counts/totals. Cancel/archive metadata fences abort analysis without financial writes.

### 2 — Android (parallel, no backend-file ownership)
- [x] SAF multiple documents with preflight rejection, hashes/source/file feedback. New import uses merged-batch route even for one newly selected file; historical legacy cards still use old path.
- [x] Unified paginated workspace/global selection up to500, no page-local loss of101st/201st edits; server item IDs and ordinals only. Identity/version/request/session gates prevent old page or analysis callbacks overwriting current state.
- [x] Selected/unselected/user-excluded are separate; rule reason is informational. Add explicit exclude/reinclude feedback even when already unselected. Hard duplicate/nonpositive rows stay locked with reasons; busy/uncertain blocks edits clearly. No draft clearing on filtering/comparison/exclusion.
- [x] Valid AI recommendation/fallback can initialize reviewed category; manual overrides win through retry. New-category names/types/associated rows require explicit approval; missing Other also needs approval before creation. Only used approved suggestions reach final review.
- [x] Server review summary supplies selected income/expense/refunds, files, exclusions/conflicts and categories to create/reuse. Any local edit discards local review token; final confirm sends same token + exact source bytes, never reruns AI. Unknown result queries same batch before retrying.
- [x] Existing readonly ledger duplicate comparison remains available via a batch-row-owned server endpoint; do not pretend legacy actionId route can compare a new itemId.

### 3 — Independent quality/integration
- [x] Independent review covers full data flow, DTO readback, limits, auth and ownership; documented findings were addressed and backend/shared gates rerun.
- [x] Measure bounded parser/batch peak memory, parse duration and worst-case accepted inputs with synthetic fixtures. This closes only the synthetic evidence step; it is not genuine-export calibration.
- [ ] Calibrate resource budgets against a representative real export before any production-safety claim.
- [x] Update stable Android feature IDs/limits/entrypoints/API matrix/gaps and code-backed specs without treating plans as implementation evidence.
- [x] Produce source/mock/build evidence report. Real-provider, deployment, installation/device actions and actual financial confirmations remain unverified and out of scope.

## 4. Required commands after code changes
```bash
pnpm --filter @jizhang/shared lint
pnpm --filter @jizhang/shared typecheck
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/server lint
pnpm --filter @jizhang/server typecheck
pnpm --filter @jizhang/server test
pnpm --filter @jizhang/server build
cd clients/android
./gradlew testDebugUnitTest lintDebug assembleDebug --no-parallel
```
Record exact exit codes, logs, test XML counts and artifact hash. A build is not device acceptance; prior task results are not this task's test results.

## 5. Required regression matrix
- 0/1/100/101/200/201/500/501 item boundaries; full cross-page selection/notes/categories; no silent generic-JSON crop.
- Same file twice rejected; exact-origin reupload idempotent; stable full-order duplicate folded with all sources; notes differ but financial facts equal; amount/date/type/refund conflict requires selected source or exclusion; long order-ID truncation collision rejects selected collision records.
- No-order identical real occurrences same-file and cross-file may both be selected; weak legacy match is advisory; actual digest/ledger-ID collisions cannot masquerade as duplicates.
- File failure explicit, remove/replace version/conflict/metadata checks, no raw bytes persisted; partial failure/caps/ZIP boundaries reject without partial batch replacement or financial writes.
- Valid/null/new category analysis; wrong-type/unknown reference/extra financial field rejected; shard failure clears AI proposals, fallback remains distinct; >20 suggestions not silently truncated; manual drafts survive analysis retry.
- Existing live leaf reuse, ambiguous same-name explicit resolution, deleted/nonleaf/cross-type refusal, missing Other explicit approval, approved-unused no creation.
- One final transaction includes all500 plus approved categories/accounts/result; inject final-row failure and assert all relevant tables unchanged; cancelling/archiving writes no financial/master data.
- Server-issued review cannot self-stale from edits/approved creation; expiry/revision/file/catalog/ledger changes invalidate correctly; no model call on review/confirm/GET; identical confirm returns original even after later catalog edits, different payload rejects.
- Auth/CSRF/wrong conversation/archive/restart/in-flight analysis/late provider response races, create/analyse/mutation idempotency mismatches, uncertain-confirm result query and double-click protections.
- Refund original stays gross expense; only explicit parsed refund movement carries refund-income identity, no invented amount/link; `noteOverrides[""]` retains exact clear semantics, Unicode truncation safe.
- Legacy single-file200/100 interfaces, history rendering, duplicate comparison and existing streaming/session defenses remain intact.

## 6. Rollback/commit boundary
Revert only task-owned hunks/new files, not entire mixed files or production state. Additive migration must preserve old-code readability. No installation, deployment, real test booking, secret/model/default-timeout changes, dependency install, staging/commit/archive is authorized by task creation/planning. Do not claim database recovery by copying a live WAL database or restore over later live writes.
