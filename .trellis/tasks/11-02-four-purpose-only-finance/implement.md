# Execution index: continuous four-purpose fund budgets

## Delivery status

The prior delivery produced the plan only. The user subsequently authorized implementation on 2026-11-03 and the task is now in progress: P01 checks 1–4, P02 and P03 are recorded complete; P04 is underway and P05–P11 are pending. P01's commit-related check remains unchecked. See the canonical checklist and `execution-evidence.md` for actual progress; production migration, deployment and commits are not authorized.

The canonical checklist is [the implementation plan](../../../docs/superpowers/plans/2026-11-03-four-purpose-fund-budget-simplification.md). Read it with [the PRD](prd.md), [design](design.md), [audit](review.md) and [migration contract](research/fund-budget-contract.md). This index does not duplicate the canonical task steps.

## Ordered milestones and responsibility

| Order | Milestone | Inputs | Release/checkpoint evidence |
|---|---|---|---|
| P01 | Close test-only baseline gates | Prior audit F03/F04 | Focused tests/lint/typecheck and preserved assertions |
| P02 | Shared fund types/arithmetic | Exact cent and ratio contracts | Allocation/projection/negative balance tests and shared build |
| P03 | Additive storage/verified historical migration | P02 and frozen historical evidence | Idempotent migration, aggregate rounding and unchanged base facts |
| P04 | Fund config/summary/history review API | P03 storage | Snapshot-consistent balances, bounded history and partial coverage |
| P05 | Salary funding without modules | P04 API/store | One salary/one grant, frozen ratios, replay and lifecycle |
| P06 | Four-purpose ledger/refunds/filters | P02–P05 | Four-value round-trip, gross/net distinction, consistent scopes |
| P07 | Retire module/cycle/AI writers | P04–P06 replacement flows | No fresh legacy-budget write or AI recreation |
| P08 | Android fund/salary/entry/history UI | Fixed P04–P07 contracts | Owned reads/replay/leave guards; local JVM/lint/APK evidence |
| P09 | Retained audit defects | P08 and original reproductions | Import replay/entity counts/goal quarantine/Back/stale tests |
| P10 | Portability and alternate writers | P06/P09 | Purpose CSV round-trip, explicit unknowns, complete DB backup |
| P11 | Specs/catalogue/integration | P01–P10 | Fresh quality gates and separately recorded device evidence |

One integrated Trellis task owns the financial contract and final release. No child tasks were created for the original planning delivery. The order above is explicit; shared service/UI files remain single-writer even if a future coordinator delegates disjoint preparation work.

## Requirement-to-task coverage

| Requirement / acceptance | Tasks |
|---|---|
| R1 / AC1 | P01, P09, P11 |
| R2 / AC2 | P07, P08, P11 |
| R3 / AC3 | P07, P08 |
| R4 / AC4 | P06, P08 |
| R5 / AC5 | P03, P10 |
| R6 / AC6 | P11 |
| R7 / AC7 | P05, P07 |
| R8 / AC8 | P02, P03, P06, P08, P10 |
| R9 / AC9 | P02, P05 |
| R10 / AC10 | P02, P04, P05, P08 |
| R11 / AC11 | P02, P05, P06 |
| R12 / AC12 | P03, P04 |
| R13 / AC13 | P06, P08 |
| R14 / AC14 | P10 |
| R15 / AC15 | P04, P05, P08, P09 |
| R16 / AC16 | P01, P08, P09 |

## Verification commands for later execution

- Repo root shared preparation: `pnpm --filter @jizhang/shared build`.
- Focused shared/server tests: `pnpm --filter @jizhang/shared exec vitest run test/fund-budget.test.ts` and corresponding P03–P10 server test files.
- Integrated gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Android working directory `clients/android`: `./gradlew.bat --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`.
- These commands were proposed in the planning delivery, not run there to validate newly implemented code. See `execution-evidence.md` for checks actually run during subsequent implementation.

## Risk/rollback checkpoints

- Before any later actual migration, verify an existing whole-database backup and recheck migration number/source ownership; use isolated fixtures first.
- Migration must preserve legacy aggregate targets and salary membership. Unverified history is an issue queue, not an invented opening amount.
- Review exact request/revision/session recovery at each new write boundary; never replace an uncertain old key.
- Read-only legacy views may remain for evidence. No rollback or stale client may silently resurrect module/period writers.
- Do not reset/clean the dirty worktree or commit unrelated previous implementation hunks. Source implementation was subsequently authorized on 2026-11-03; production migration, deployment and commits remain unauthorized.

## Context delivery

`implement.jsonl` and `check.jsonl` contain real spec/research paths. Source files and the large Android catalogue are not injected as context entries; the executor reads affected source/catalogue sections during the owning task. Native Trellis context injection is preferred, with child-side reads if injection is unavailable.
