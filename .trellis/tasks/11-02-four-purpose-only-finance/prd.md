# Continuous four-purpose fund budgets

## Goal

Replace accounting cycles and category/module fund budgets with continuous four-purpose fund budgets. Salary income is allocated by saved ratios to growth/reserve/essentials/joy, and each purpose balance carries forward without monthly resets. Ordinary bookkeeping uses the necessary ledger fields, one purpose, tags and notes.

## Authorization and delivery

- Task creation/planning was approved on 2026-11-02.
- On 2026-11-03 the user explicitly confirmed retaining proportional salary allocation and cumulative purpose balances, replacing module funding with four-purpose fund budgets.
- The earlier handoff was planning only. The user subsequently authorized implementation on 2026-11-03; the task is now in progress. Production migration, deployment and commits remain outside that authorization.
- The existing dirty worktree is the source baseline. Preserve other changes and the prior audit evidence.

## Background and evidence

- The completed bounded prior-repair audit is `review.md`; its detailed Android/backend reviews and local verification logs are under `research/`.
- Local audit evidence records shared 388 tests, server 1,047 tests and Android 580 tests passing. At that historical audit, server lint and test typecheck were red at the two test-code anchors below. These are recorded audit results, not checks newly run while writing this plan; P01 subsequently repaired and passed both gates, as recorded in `execution-evidence.md`.
- The current transaction purpose supports essentials/joy only; growth/reserve are funding purposes. Both the API and SQLite constraints need an additive four-purpose contract (see `research/simplification-impact.md`).
- Confirmed income targets are aggregate period snapshots; `financial_period_sources` enforces one active period per salary. Preserve a verified aggregate snapshot rather than rounding every historic salary independently or importing every revision.
- Android is the maintained client; the retired Web/PWA is outside scope. Documentation is English and user-facing copy is Chinese.

## Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Preserve and hand off the prior repair audit with evidence and verification limits. | AC1 |
| R2 | Remove created/confirmed accounting cycles and start-day/monthly-reset prerequisites from active bookkeeping. Calendar dates remain filters only. | AC2 |
| R3 | Remove the active module/category-budget feature and its setup/entry requirements without deleting historical transactions. | AC3 |
| R4 | Keep necessary ledger fields, a primary four-purpose choice, tags and notes straightforward in recording/editing. | AC4 |
| R5 | Preserve historical ledger, salary/account/refund/goal facts and recoverable purpose associations with a non-destructive compatibility boundary. | AC5 |
| R6 | Update affected tests/specs/Android stable IDs and distinguish source/JVM/build from device verification. | AC6 |
| R7 | Retire secondary module-budget generators and mutations, including salary templates/allocations, pools and AI budget proposals. | AC7 |
| R8 | Support all four purpose names coherently through validation/storage/read/edit/filters/portability, replacing current two-purpose-only transaction support. | AC8 |
| R9 | Allocate each new salary once using exact integer cents, saved four-purpose ratios and a frozen ratio snapshot. | AC9 |
| R10 | Maintain continuous cumulative purpose balances without monthly reset. Configuration is prospective; overspending may produce visible negative balances. | AC10 |
| R11 | Keep fund deductions/corrections/deletion/restoration/confirmed refunds consistent with authoritative ledger facts and existing accounting boundaries. | AC11 |
| R12 | Migrate only verified unique historical funding/attribution once and disclose unresolved facts instead of guessing. | AC12 |
| R13 | Share purpose/tag/date/account/category/text scopes between list, summary and drilldown; separate filtered activity from continuous balances. | AC13 |
| R14 | Preserve new purposes through CSV/backups and alternative ledger writers; unsupported import purpose evidence remains explicitly unassigned. | AC14 |
| R15 | Preserve exact keyed recovery, revision checks, server/user ownership, pending-write quarantine and outer leave guards. | AC15 |
| R16 | Close the actionable prior-audit defects in retained flows or prove their active prerequisites were retired; keep evidence and test gates honest. | AC16 |

## Acceptance criteria

- AC1: `review.md` and its source/reproduction/test evidence remain intact and linked in the handoff.
- AC2: Entering November or the tenth creates no financial period, resets no balance and requires no preview/confirm/reconcile step.
- AC3: Active main screens and recording/editing need no category-module budget setup.
- AC4: Manual ordinary expense/non-refund income records use one purpose plus the existing necessary ledger fields and optional tags/notes. Refunds follow original confirmed attribution.
- AC5: Existing amounts/dates/account/category/tag/note information, salaries/refunds/goals and recoverable purpose evidence remain intact; no destructive reset is used.
- AC6: Historical/refund and shared/server/Android quality checks are planned and recorded separately from actual device checks; Android catalogue IDs are preserved and only source-rechecked audit dates advance.
- AC7: A new salary saves without a legacy module allocation/template; ordinary/AI tools cannot regenerate active module budgets or pools.
- AC8: All four values round-trip coherently through source validation, canonical storage, retrieval, editing, filters and portability. Missing old evidence never gets a guessed purpose.
- AC9: A 100,000-cent salary at 25/15/50/10 allocates 25,000/15,000/50,000/10,000; keyed replay creates no extra salary/grant and one-cent allocation conserves the total.
- AC10: After an essentials expense=12,000, confirmed refund=3,000 and a second salary=100,000, balances are 50,000/30,000/91,000/20,000. Month filtering and later ratio edits do not reset or rewrite them.
- AC11: Ordinary expense remains gross 12,000 and refund income is 3,000; the refund credits funds only once. Transfers/manual goal entries cause no fund delta; source edits/deletions/restorations follow defined lifecycle.
- AC12: Re-running migration adds no duplicate grant/source/purpose facts and preserves verified aggregate rounded targets. Unconfirmed/stale/conflicting sources show incomplete coverage rather than a fabricated complete zero.
- AC13: Purpose-filtered list, summary and drilldown return consistent scopes. Current balances use continuous facts; activity uses server-owned half-open windows.
- AC14: CSV preserves fundPurpose, accepts old files without it and reports unknown nonempty values with line evidence. Whole database backup, not ledger CSV alone, preserves complete salary/grant/config history.
- AC15: Lost responses/restarts/stale revisions/account switches/Back cannot duplicate writes or silently discard unresolved requests.
- AC16: A01–A06 and F01–F04 have concrete ownership in P01/P08/P09; retained failures receive meaningful regressions and retired flows are source-checked, not marked fixed without evidence.

## Prior audit finding ownership

| ID | Severity / evidence | Owning future work |
|---|---|---|
| A01 | P2: shared plan/goal owner tickets can discard reads; `MonthlyPlanWorkspace.kt:117–175`. | P08 replaces active period workspace; P09 checks independent retained goal read ownership. |
| A02 | P1: import mutation recovery loses original keyed outcome; `AssistantBatchImportWorkspace.kt:137–140`, `:670–705`, `:1193–1200`. | P09 exact import mutation hydration/replay. |
| A03 | P2: Back routes bypass pending/dirty guard; `MainShell.kt:281–292`, `AssistantBatchImportWorkspace.kt:1110`, `MonthlyPlanWorkspace.kt:79–88`, `MyTab.kt:146–165`. | P08/P09 shared outer leave ownership. |
| A04 | P2: stale template errors miss salary repair path; `SalarySheet.kt:630–631`, `:644–668`, catalogue `README.md:283`. | P05/P08 retire the active template requirement; retain exact old replay evidence. |
| A05 | P1: unresolved manual goal operation permits another write and rejection drops form values; `ManualGoalProgressWorkspace.kt:453–547`, `:558–589`. | P09 retained goal write quarantine and draft preservation. |
| A06 | P2: failed refresh shows stale goal actuals without status; `StatsTab.kt:235–238`, `:322–339`. | P08/P09 visible stale/error status and owned refresh. |
| F01 | P1: identical keyed file removal retries return 400; `import-batch-service.ts:1758–1790`. | P09 operation lookup before current index/last-file validation. |
| F02 | P2: duplicate renamed category suggestions count two creations but create one; `import-batch-service.ts:2471–2525`, `:2735–2819`. | P09 normalize entity identity before review counts. |
| F03 | P2 gate: unused final assignment; `financial-goals.test.ts:1177`. | P01 test-only lint repair. |
| F04 | P2 gate: possibly undefined first module; `salary-operation-replay-regression.test.ts:233`. | P01 test-only narrowing repair. |

Severity above is planning priority; the original audit reports remain the evidence source. Line anchors must be rechecked against the executor worktree.

## Key decisions

- The product keeps fund allocation and cumulative balances; it is not a classification-only replacement.
- New salary ratios are frozen per grant. Historic confirmed multi-salary targets stay aggregate, with unique salary memberships, to conserve original rounded totals.
- Use an additive fund-purpose representation and separate fund grants, preserving the legacy two-purpose columns and period history for read-only compatibility.
- A selected ordinary non-refund income credits one purpose; salary uses the proportional grant path. A confirmed refund credits original purposes only.
- Existing categories remain ledger metadata. They no longer create budgets or silently reclassify new transactions.
- Historical uncertainty requires a one-time source review; it is not a recurring accounting-cycle confirmation.

## Out of scope

- The original planning delivery excluded product-code implementation, commits, deployment and database changes. Implementation was subsequently authorized; production migration, deployment and commits remain unauthorized.
- Retired Web/PWA revival, broad visual redesign, offline sync, generic workflow/event frameworks or new dependencies.
- Deleting old transactions, salary records, goal facts, audit history or unrelated working changes.
- Automatic fund movements from account transfers or manual saving/investment progress; those facts keep their existing separate meaning.

## Artifact status

- Requirements converged for the original planning handoff; no blocking product question remains. Implementation was subsequently authorized on 2026-11-03 and is in progress.
- `design.md` defines contracts, migration, accounting and UI boundaries.
- `implement.md` indexes the execution steps in `docs/superpowers/plans/2026-11-03-four-purpose-fund-budget-simplification.md`.
- `implement.jsonl` and `check.jsonl` contain real spec/research context. P01 checks 1–4, P02 and P03 are recorded complete; P04 is underway and P05–P11 are pending. P01's commit-related check remains unchecked. See `execution-evidence.md` and the canonical plan for recorded progress.
