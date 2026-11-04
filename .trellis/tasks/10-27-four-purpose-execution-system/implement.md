# Implementation Roadmap and Release Gates

Status: proposed, no implementation started. Each phase is independently releasable; Phase 2 depends on Phase 1 authoritative execution and Phase 3 depends on Phase 2 verified funding facts. Parent planning task stays `planning` until the latest summary is explicitly approved. Create phase implementation children after approval; do not start the existing independent-plan task as an upgrade shortcut.

## Phase 1 — Salary-cycle plan + real spending (highest priority)

Outcome: answer how income should be distributed and whether essentials/joy follow that plan, without inventing growth/reserve execution.

1. Freeze approved compatibility decisions from design: separate net read model; legacy gross envelope references; explicit bounded financial windows; original-cycle refunds; immutable plan revisions and source reconciliation.
2. Freeze shared DTOs/error codes/rule versions, migration inputs and request-key contract; add failing fixtures before implementations.
3. Add additive schema for config/rule revisions, stable periods, source snapshots, bill purpose overrides and refund cents splits. Test migration from current schema and restore an isolated whole-DB backup.
4. Generalize allocation pure function to custom basis-point ratios for the new API only; preserve fixed v1 output and tiny-amount largest-remainder ordering. Add period/purpose/refund execution pure functions.
5. Implement salary request deduplication (optional for old callers), explicit post-save plan preview/confirmation, unique source inclusion, same-cycle extra salary revision, salary correction reconciliation. Do not generate a second salary or income row.
6. Implement mapping inheritance/provenance and optional bill-purpose field across new/edit/read/import/recurring/AI writer paths. Missing field remains backward compatible; old writers must not erase an existing explicit override.
7. Implement confirmed refund splits and legacy review queue; read execution from live facts with pending-coverage flags. Wire delete/restore/purge/source edit behavior, including the existing hard removal of legacy refund_links on soft delete.
8. Expose bounded execution and source-detail endpoints, config adoption and capability detection. Separate old gross envelope figures from new linked net detail and flag 100%-envelope vs 60%-spending inconsistency; no automatic rewrite.
9. Android: shared secondary host and one back owner; preserve My stable entry; home view preference scoped to server/user; home/financial failures isolated; salary prompt and server-authoritative refresh; optional purpose field included in draft baseline/dirty checks/decode/payload/details.
10. Keep manual scenario/12-month forecast available without AI. Show phase-2 actual funding as unavailable, never zero/fulfilled by planned values.
11. Update Android inventory IDs L00/L01/B01/B03/S01/L04, APIs/known gaps/change log after source readback. Record source tests versus device results separately.
12. Run automated and device acceptance matrix, scoped review and explicit release approval.

## Phase 2 — Verified investment/reserve execution

Outcome: answer what has actually been designated/transferred, how much reserve is currently usable, and what remains to save.

1. Freeze dedicated versus partial-earmark modes; explicit as-of liquidity, duplicate ownership and reversal rules. Opening stock is not a current saving contribution.
2. Add bindings, append-only opening/contribution/release/reversal facts and links to existing transfers/direct expenses. Unique source-cents ownership; no mirrored expense for transfers.
3. Integrate transfer mutation and account/bill correction paths: conflict or explicit reverse/rebind when a confirmed movement would become invalid. Preserve old-client safety through derived source checks.
4. Enforce aggregate same-account earmark coverage atomically. After cash depletion, mark all that account's purpose positions coverage-unresolved, exclude from confirmed usable totals and withhold exact reserve gap/ETA until explicit reconciliation; never allocate surviving cents twice or silently choose a losing purpose. Verify aggregate funded<=liquid and whole-ledger balance invariants using A21.
5. Implement reserve withdrawal/refill, direct merchant payment, zero-flow internal transfers and target/coverage/ETA. User confirms actual-essential baseline and target months (five default).
6. Add target-reached suggestions and future-cycle ratio confirmation, including later depleted-reserve review. Never apply suggestions on GET or target crossing.
7. Native funding UI and source drill-down, unknown-result retry; whole-DB backup/restore covers all relations. Explicitly retain CSV full-fidelity limitation; structured portable format is a separate follow-up, not an unstated release promise.
8. Run Phase 1 regression plus Phase 2 acceptance, native inventory and device gate; approve backend-before-APK release.

## Phase 3 — Review and AI explanation

Outcome: explain execution across periods with traceable metrics and realistic forecasts.

1. Freeze success/expense-utilization/savings-rate definitions, zero-income/negative-flow behavior and incomplete-data eligibility. No single misleading combined progress percentage.
2. Add paginated historical execution, reserve coverage history based on dated facts, consecutive eligible success periods and observed-data rolling forecasts with sample windows.
3. Add bounded read-only financial statistics tool to AI registry, exact parity with financial endpoints and tool evidence IDs. No paid AI for normal page reads/calculation. Existing AI mutation routes cannot silently alter ratios or purpose history.
4. Integrate review/forecast UI and explanation entry. If action suggestions are added, route through separately versioned preview → user selection → explicit application with stale-source fingerprints; never execute from free text alone.
5. Re-run all prior phases, AI read-no-writes checks, device tests, inventory and release approval.

## Validation commands (to execute during implementation, not executed in this planning session)

Use repository-pinned Node/pnpm (load provided workspace dependencies if required) and current Android JDK/SDK. Read package scripts again before executing.

```text
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/shared lint
pnpm --filter @jizhang/shared typecheck
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/server exec vitest run --maxWorkers=2
pnpm --filter @jizhang/server lint
pnpm --filter @jizhang/server typecheck
pnpm --filter @jizhang/server build
clients/android/gradlew.bat -p clients/android testDebugUnitTest lintDebug assembleDebug
git diff --check -- <explicit allowlist of touched tracked files>
```

Review newly created files too; `git diff` alone misses untracked files. Source-structure tests are not device interaction evidence. Earlier independent-plan test counts are historical baseline, not this task's results. Never increase unrelated timeouts to conceal regressions.

## Risk / rollback checkpoints

- Before any schema mutation: restored isolated backup, migration failure atomicity and old API compatibility.
- Before enabling salary integration: idempotent salary + plan-source tests; skip/cancel does not undo salary or create plan.
- Before enabling net execution: exact refund allocation and visible ambiguous-history handling; old gross API unchanged.
- Before enabling binding: liquid coverage/as-of consistency and source reversal audit; total assets unchanged by plan-only writes.
- Before release: capability-gated backend first, then APK. Production deployment/installation needs separate human authorization; no auto-deploy from successful tests.
- Disable execution feature to roll application back; no down migration. Only restore DB under the existing maintenance procedure, never overwrite a running WAL database.
