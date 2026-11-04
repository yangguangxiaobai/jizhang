# Research: continuous fund budget contract and migration

- Date: 2026-11-03. This is planning evidence and a proposed implementation contract; no database migration was executed.
- User decision: proportional salary allocation and cumulative balances remain; module funding is replaced by four-purpose funds and accounting periods disappear from active flows.

## Source facts

- `packages/shared/src/financial-plan.ts:48` already names growth/reserve/essentials/joy; its default split is 25/15/50/10 at `:64–67`.
- `packages/server/src/db/migrations/019-financial-execution.ts:176–191` limits legacy bill purposes to essentials/joy. Add a new four-purpose representation rather than editing applied migration 019.
- `019-financial-execution.ts:78–98` stores immutable period decisions and sources, while `:103–117` gives a salary one active period membership.
- `financial-planning-periods.ts:809–838` computes targets from aggregate verified income using frozen ratios and snapshots the sources. Per-salary rerounding during migration can change original per-purpose totals by cents.
- `financial-source-lifecycle.ts:15–29` invalidates an entire refund split set when critical facts change and does not auto-reactivate it on restoration. Purpose/category/date changes recompute attribution rather than changing split amount ownership (`:46–68`).
- `salary-service.ts`, `routes/budget.ts` and `ai-spending-organization-service.ts` currently recreate module allocations/templates. Retirement must include their write paths.

## Proposed migration algorithm

1. Apply one new migration after 020 in a transaction. Create fund config revisions, immutable grant revisions/current grant identities, unique salary memberships, transaction fund-purpose facts and bounded migration issue records. Leave applied migrations, legacy financial columns and old records intact.
2. Initialize prospective fund ratios from the latest valid saved financial config. If absent, offer the existing 25/15/50/10 default for new salary funding; never use that default to backfill old salaries silently.
3. For each current active period revision, parse its decision and source snapshots. Require all salary sources to be live, uniquely owned, snapshot-matching and total-consistent; recompute aggregate targets with its frozen ratios and compare exact cents. Import the verified aggregate targets as one legacy-group grant, with a unique membership for each contributing salary.
4. Import neither inactive/replaced revisions nor a second membership for an already claimed salary. A unique origin key and salary membership key make reruns no-ops. Stale, missing, conflicting, invalid or unconfirmed sources become migration issues with source evidence, not guessed grants.
5. Copy valid explicit legacy bill overrides directly. Infer a missing historical purpose only when one unique frozen mapping/window resolves it unambiguously. Multiple conflicting windows, no mapped purpose or invalid source facts remain visibly unassigned. New rows never depend on these mappings.
6. Retain confirmed refund split facts and their lifecycle checks. Credit a split to the current canonical purpose of its live original expense; an unresolved original purpose remains unresolved. Do not credit the same refund as normal income.
7. Validate unique salary coverage, grant source sums, target conservation, historical purpose counts and unchanged base ledger/account facts. Expose known balances and unresolved counts/amounts separately.

## Lifecycle and review

- A new single-salary grant follows amount/date/delete/restore changes using its saved ratios and a source revision; it never adopts later configuration automatically.
- A migrated aggregate grant keeps the original aggregate rounding. If one of its source facts changes, preserve the snapshot, flag the grant for one-time source review and report incomplete coverage. Do not invent a per-salary allocation or turn a provisional total into a confirmed balance.
- Explicit review of an unallocated historic salary uses its current token, chosen ratios, expected fund revision and operation ID. It claims that salary once and records the decision; it creates no month or period.
- A database backup includes both generations of facts. Rolling back presentation may use read-only legacy views; do not auto-enable old budget writers after new fund data exists.

## Required migration tests

- `verifiedLegacyGroupKeepsAggregateTargets`: two small salaries with independent rounding different from the aggregate retain exact original targets.
- `migrationTwiceClaimsSalaryOnce`: rerun adds no grants, members or purpose facts.
- `inactiveRevisionNeverAddsFunding`: only the active verified decision is eligible.
- `staleOrUnconfirmedSalaryStaysUnallocated`: current ratios do not guess historic allocation.
- `overlappingConflictingMappingsRemainUnassigned`: no fabricated historic bill purpose.
- `legacyGrantSourceEditRequiresReview`: original snapshot remains and incomplete status is explicit.
- `migrationPreservesLedgerAccountAndGoalFacts`: original amounts/dates/account associations/tags/notes/goals and refunds remain unchanged.
