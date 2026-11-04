# Backend Independent Review — merged AI bill import

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Reviewer: yansuu1
Status: **COMPLETE — backend review gates passed; parent action required for Android finding**

Scope: `packages/server/` and task-owned `packages/shared/` changes/tests, plus read-only Android DTO wire comparison. Product implementation was already present. No Android, spec, README, task protocol, deployment/device/provider/live-ledger, dependency/model-configuration, staging or commit changes were made.

## Findings and decisions

### 1. Dedicated DTO and identity/review semantics
- The 500-item batch uses dedicated server DTO/storage/serialization and paging; it does not flow through generic assistant JSON normalization (legacy 200-array/100-key caps remain untouched). Global Fastify body limit remains 8 MiB; batch request routes use the scoped 12 MiB limit.
- Strong financial identity includes full `sourceTimestamp`; weak occurrence identity uses full file digest + source row; exact occurrence duplicates are hard-blocked, legacy weak matches advisory only. Strong ID collision guards compare full semantic keys, including different order IDs mapping to one truncated ledger ID.
- Full review state is stored server-side (selected IDs/assignments/notes/approved proposals/conflict decisions, opaque token, revisions, base/catalog fingerprints and summary). Backend validates an active same-type assignment for each selected row; using a suggestion requires its approval. This does not itself guarantee a human approval action if the client pre-populates approvals (see Android finding).
- Existing tests confirm confirmation bytes/catalog/version/live eligibility/rebase/account rules, last-row failure rollback, same-payload replay and changed-payload conflict; also auth/CSRF/ownership, conversation archive fencing, provider active lock, async cancel/restart fences, file operation replay/idempotency and confirmed-result preservation.

### 2. Corrected bounded parsing defect (no API/wire change)
Audit found that, despite file-byte/inflate/text caps, XLSX sheet parsing could allocate sparse columns and full row/cell matrices before checking the CSV limits. CSV parsing similarly materialized the entire matrix before the shared parser budgets ran, and the batch raw-row budget was previously enforced after parsing a file. This violated the frozen pre-allocation bound requirement.

Local fix and focused regression coverage:
- XLSX now validates central-directory record/local-header boundaries and actual decompressed lengths, plus applies row/column/cell limits before worksheet materialization.
- Shared CSV parser supports optional allocation-time row/column/cell caps; legacy callers omitting caps retain the prior behavior.
- `parsePlatformBills` applies bounded parsing to header discovery/full parse and uses the remaining aggregate row budget for each file.
- Added server XLSX shape tests and shared aggregate-row refusal test.
- No protocol fields/statuses changed.

### 3. Android-only finding for parent (read-only; no Android edits)
`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt:177-204` auto-populates `approvedCategories` for new suggestions during load/reload, then sends that map to review. That makes server approval validation pass without an explicit user approval gesture, contrary to frozen protocol v1 §7 / PRD R4. Parent should have the Android owner remove this auto-approval and retain suggestion drafts until explicit approval. This is outside my exclusive server/shared scope and remains unresolved.

Android DTO readback (`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt`) confirmed batch, rows, categories, structured review summary and duplicate comparison model fields against server DTOs; no additional mismatch found in those read paths. No Android files were modified.

## Verification
Exact run output and exit codes are persisted in `research/backend-independent-review-verification.log`.

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @jizhang/shared lint` | 0 | clean |
| `pnpm --filter @jizhang/shared typecheck` | 0 | clean |
| `pnpm --filter @jizhang/shared test` | 0 | 7 files, 187 tests passed |
| `pnpm --filter @jizhang/shared build` | 0 | clean |
| `pnpm --filter @jizhang/server lint` | 0 | clean |
| `pnpm --filter @jizhang/server typecheck` | 0 | clean |
| `pnpm --filter @jizhang/server test` | 0 | 30 files, 679 tests passed |
| `pnpm --filter @jizhang/server build` | 0 | clean |
| `node --expose-gc packages/server/node_modules/tsx/dist/cli.mjs packages/server/test/benchmark/import-batch-bench.ts` | 0 | synthetic benchmark output in log |

Synthetic benchmark re-run: 500 generated CSV records accepted in 97 ms / +6.6 MiB heap; 501 materialized items rejected; 3001 raw rows rejected; 64 MiB inflated XLSX refused at 8 MiB entry limit. These are synthetic/local figures only, **not** real-export calibration and not a production safety claim. No genuine user bill sample, real provider, device, deployment or live accounting verification was performed.

## Exact changed paths in this review
- `packages/server/src/services/xlsx-lite.ts` — bounded XLSX structure and worksheet materialization.
- `packages/server/src/services/import-batch-service.ts` — parser budget threading and preservation check that untouched files remain unchanged during replace/remove; preserves identity-independent reorder behavior.
- `packages/server/test/import-batch-limits.test.ts` — worksheet row/column/cell bound regression coverage.
- `packages/server/test/import-batch-confirm.test.ts` — untouched-file byte substitution regression coverage.
- `packages/shared/src/csv.ts` — optional bounded incremental CSV parsing.
- `packages/shared/src/platform-bills.ts` — bounded parser application and batch remaining-row cap.
- `packages/shared/test/platform-bills.test.ts` — aggregate raw-row budget regression.
- `.trellis/tasks/10-17-ai-bill-import-improvements/research/backend-independent-review.md` — this review result.
- `.trellis/tasks/10-17-ai-bill-import-improvements/research/backend-independent-review-verification.log` — final gate and benchmark logs.

These paths existed within a mixed-WIP worktree. No baseline reset/stage/commit was done. Preexisting product hunks were retained rather than replacing files wholesale.

## Remaining limits / handoff
- Parent should route the explicit-approval Android finding to the Android owner; this report does not fix it.
- Request concurrency was inspected in the synchronous SQLite transaction and active-lock architecture; stress/performance under many simultaneous large uploads was not run. No global admission-control mechanism was added because it would exceed frozen scope.
- Synthetic benchmark is not production calibration. No real exports, real provider, device, deployment, dependency/configuration changes or actual accounting were exercised.
- No material backend API/wire contract change; no follow-up client adaptation is needed for the parser fixes.
