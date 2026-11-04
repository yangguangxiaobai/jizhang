# 核心记账与财务规划精简 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans; obey the project's Trellis phase/context/review protocol.

**Goal:** Execute the five independently verifiable children and integrate the daily recording/monthly planning/manual goal workflow.

**Architecture:** Additive API/read models with existing financial semantics, sequential Compose integration, isolated manual-progress storage.

**Tech Stack:** Kotlin/Compose, TypeScript/Fastify, SQLite, shared pure cents/date functions.

**Spec:** [prd.md](prd.md), [design.md](design.md), [acceptance.md](acceptance.md), [user implementation plan](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md).

## Global Constraints

All constraints and interfaces in design.md apply. This parent coordinates and reviews; activate the child owning the next deliverable, not the parent for application implementation. User approval is recorded in parent and child task metadata; activate children sequentially. C1 is locally implemented/reviewed with device checks pending; C2 is active.

## Review Focus

Wage/retry duplication=C2-03/C2-09; gross/net/refund scope=C2-04/C2-06; calendar/cycle scope=C2-05/C3-03; manual versus predicted money=C4-06/C4-07; stale or unsupported-server state=G04/G05.

## Ordered checklist

- [ ] Review the main Markdown and scope decisions; record implementation approval against this version before activation.
- [ ] Establish current source, API and test baseline in an isolated test service/database; retain existing uncommitted user changes.
- [ ] Recheck affected Android inventory/specs and make each child's implement/check manifests current.
- [ ] Execute C1 entry/recording and its acceptance cases; independently review it before C2.
- [ ] Execute C2 monthly plan/salary/mapping and its acceptance cases; independently review it before C3.
- [ ] Execute C3 statistics/drilldown/expense review and its acceptance cases; independently review it before C4.
- [ ] Execute C4 manual progress plus isolated migration/restore and its acceptance cases; independently review it before C5.
- [ ] Execute C5 import/optional AI and its acceptance cases; independently review it before integration.
- [ ] Run G01's complete synthetic-accounting journey and G02/G03 accounting/compatibility fixtures.
- [ ] Run shared tests/build and server lint/typecheck/tests/build, then Android JVM/lint/assembleDebug according to current quality guidelines.
- [ ] Complete device checks for navigation, IME, hidden-page hit testing, goal inputs, import selection and weak-network/replay.
- [ ] Update affected stable inventory IDs and verification levels; review all parent requirements against evidence.
- [ ] Commit only the approved implementation scope after checks; archive children/parent only when their actual acceptance criteria are fulfilled.

## Validation commands

At repository root:

~~~powershell
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/server lint
pnpm --filter @jizhang/server typecheck
pnpm --filter @jizhang/server test --maxWorkers=2
pnpm --filter @jizhang/server build
~~~

At clients/android:

~~~powershell
./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
~~~

Success means the actual command exits0, relevant tests have no failures, lint has no new blocking errors, and output is saved. Existing warning baselines must be stated. No old recorded test count is a fresh result.

## Risk/rollback checkpoints

- After C1, confirm new secondary AI/plan navigation does not dispose retained drafts or intercept hidden-page input.
- After C2, compare unchanged legacy wage/envelope/pool outputs and the new net plan independently; no implicit historical rescaling.
- After C3, compare category summary against complete matching transactions, including records beyond the first page.
- Before C4, verify the actual next migration ordinal, upgrade an isolated old snapshot, and restore it with every writer stopped.
- After C5, test old cards and explicit selection/approval under source hash/token changes and unknown results.
- Product release and production deployment have separate evidence; an additive schema alone is not a tested old-server rollback.
