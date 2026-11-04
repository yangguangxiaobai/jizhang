# Backend live-view review — COMPLETE

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`

## Implemented
- `GET batch`, `GET rows` and `GET categories` compute and return a read-only current `viewRevision` from batch/source/analysis facts, current bookable catalogue, accounts, and current ledger eligibility. Per-row existing/account eligibility and batch live summary/filter values are based on the same current state; GET writes no database state.
- `POST review` compares the supplied view revision inside the SQLite transaction before validation/normalization. It refreshes stored eligibility/catalogue metadata only after the revision matches, then normalizes the selected assignment set, creates the token, computes the authoritative summary and binds the token to the exact view. A stale read returns 409 and no review/batch mutation; fresh GET then review can rebase.
- `POST confirm` rechecks the current live view against the token-bound review revision inside its transaction, alongside catalog/eligibility/fingerprint checks. It rejects new ledger entries rather than skipping them.
- Review `selectedRows` now return resolved note (source note unless overridden; explicit `""` remains empty), `categoryName`, `categoryType`, and `approvedNewCategoryName` when the approved plan will create the category. Existing row IDs and financial values remain.
- Summary adds explicit overlapping `counts`: selected/notSelected complement each other, while preexisting/ruleIgnored/conflictRows are independent overlapping attributes. `userExcluded` is null because the server has no trusted persisted user-exclusion state. Legacy `excluded` remains total minus selected.
- Review/confirm validates current live category IDs against the active bookable leaf catalogue and matching type. Ambiguous same-name suggestions require explicit reuse ID or a unique renamed name; explicit reuse ID must still match name/type/parent, and confirmation revalidates leaf state.
- `importable` and `existing` row filters resolve from current ledger IDs; weak-collision selected rows remain blocked.

## Changed implementation and tests
- `packages/server/src/services/import-batch-service.ts`
- `packages/server/src/services/import-batch-types.ts`
- `packages/server/test/import-batch-confirm.test.ts`
- `packages/server/test/import-batch-regression.test.ts`

## API / Data contract
Additive review response row fields: `categoryName`, `categoryType`, `approvedNewCategoryName`; `note` now provides resolved server value instead of null when no override was sent. Additive `summary.counts` details overlapping semantics; `userExcluded: null` explicitly means unknown/untracked, not zero. Request fields, status/error shape, category approval `resolution:'create'` with optional `reuseCategoryId`, and confirm contract remain unchanged.

Frontend handoff: render review response fields directly and do not infer category names from IDs or source notes from null. Do not label `ruleIgnored` as user-excluded. Resolution encoding is unchanged.

## Route+DB regression evidence
Tests use the real Fastify `app.inject()` endpoints and isolated SQLite test DB. They directly simulate an independent business transaction/category write between client GET and review; verify stale review 409 and unchanged batch/row/category state, then reread R2 and review/confirm. Other tests prove read-only GET table equality, current eligibility, differing revision during paginated reads, resolved source/override/explicit-empty notes, 500 selected rows and 500 assignments, and dedicated DTO response behavior. No production database or live service was used.

## Verification — final run
| Command | Outcome |
|---|---|
| `pnpm --filter @jizhang/shared lint` | PASS |
| `pnpm --filter @jizhang/shared typecheck` | PASS |
| `pnpm --filter @jizhang/shared test` | PASS — 7 files, 187 tests |
| `pnpm --filter @jizhang/shared build` | PASS |
| `pnpm --filter @jizhang/server lint` | PASS |
| `pnpm --filter @jizhang/server typecheck` | PASS |
| `pnpm --filter @jizhang/server test` | PASS — 30 files, 684 tests |
| `pnpm --filter @jizhang/server build` | PASS |

Final logs: `artifacts/import-live-view-{shared,server}-{lint,typecheck,test,build}.log`. No Android/device, provider, deployment, dependency installation, config/model change, Git staging/commit/reset, or production DB work occurred.
