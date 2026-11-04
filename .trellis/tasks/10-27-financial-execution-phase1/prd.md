# Phase 1 — Salary Cycles and Actual Purpose Spending

## Approval and goal

User explicitly approved the parent final planning summary and instructed implementation with configured subagents on2026-10-27. Implement Phase1 of `../10-27-four-purpose-execution-system/` only. Parent PRD R1–R3,R6–R8 and acceptance A01–A18,A29–A30 are authoritative, incorporated by reference rather than duplicated.

## Requirements

- Stable finite salary-cycle plans with frozen ratio/mapping/source assumptions, append-only confirmed revisions, unique selected salary inclusion and explicit source-change reconciliation.
- Default25/15/50/10 exact conserved cents; custom future ratios sum100%; no ledger side effects from planning. Salary creation and plan operation safe replay for new clients.
- Explicit category rules, child/parent inheritance, per-bill optional override, unresolved classifications; no automatic historical rewrite.
- Separate financial gross/refund/net execution with conserved per-original refund splits and source lifecycle validation. Preserve existing gross ledger/envelope APIs and independent fixed v1 plan API.
- Preserve legacy full-income envelope budgets as labeled references, surface inconsistency with50/10 purpose ceilings; no silent rescaling/duplicate allocation.
- Android home remembered mode, single budget/financial host from home/My, salary preview confirmation, purpose field and authoritative refresh. Unavailable funding progress is not simulated.
- Preserve all unrelated existing work. No Phase2 movement/binding implementation, Phase3AI statistics, deployment, install, bank operation or automatic commit.

## Acceptance

Meet parent cases A01–A18 and automated gate A29. Prepare device matrix A30 and state honestly if device unavailable. New tests must cover tiny/overflow ratios, cycle edge cases, idempotency/CAS, lifecycle, refund allocation, compatibility, account invariance, and native strict parsing/state guards. No assumed historical test result counts as new verification.

## Evidence

Parent research.md contains code anchors. Parent design.md and implement.md define approved architecture/phase order. Child contract.md will freeze concrete technical schema before parallel product implementation; any material departure from parent product behavior returns to parent review rather than silently expanding scope.
