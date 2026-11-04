# Final Planning Review — AI Spending Organization

Date: 2026-10-20  
Task: `10-19-ai-spending-organization`  
Review status: **Ready for final user review; not implementation-ready.** Task remains `planning`. This review does not authorize `task.py start`.

## Goal

Enable Android users to review complete AI-assisted transaction organization for a selected month/custom date interval, correct category and hierarchical-tag assignments, inspect separate note suggestions, and optionally propose future-use budget-template changes. Preserve source notes and all financial facts, require explicit confirmation, and support conditional undo.

## In scope

- Inclusive calendar-month/custom date-range selection, server-local interpretation, full coverage, honest bounded progress, explicit over-cap/failure behavior, and exact reviewed-scope revalidation.
- Reviewable category/tag changes with before/after state, hierarchical tags independent of categories, and preserved legacy associations.
- Separate note suggestions that cannot overwrite source notes.
- Structure-only and module-plus-budget proposal cards; create a new template by default or update only a user-selected template with complete visible diff.
- Atomic, idempotent, authorized apply and conflict-safe conditional undo.
- Android native integration and maintained inventory update in the later approved implementation change; distinguish source/test/provider/device evidence.

## Out of scope

- Changing amounts, transaction type, account, date, refund facts/linkage, or original notes.
- Applying a template to current cycles, changing current/historical allocations, or altering salary snapshots.
- Implicitly selecting/overwriting a template, autonomous writes, web UI, provider deployment/configuration, live migration, APK installation, or implementation in this planning turn.

## Acceptance criteria

1. User selects a month or inclusive custom range and sees server-interpreted boundaries and eligible count; only live in-scope transactions qualify.
2. Accepted intervals are fully analyzed; cap failures and batch errors are explicit and never yield partial actionable cards.
3. Review presents every proposed category/tag change and transaction before/after; only explicit confirmation applies it, and cancellation is read-only.
4. Original notes and all financial facts remain unchanged; suggestions are separate.
5. Parent/child tags, direct parent assignment, multiple branches, legacy flat names, and deduplicated parent filtering work without conflating tags and categories.
6. Structure-only proposals do not change ratios/allocations. Ratio proposals cover the complete proposed template solution and total 100%; new-template cards show the full solution, and explicitly selected existing-template updates show all affected module ratios as a before/after diff. Selected-interval spending is evidence only—not a budget amount, direct ratio amount, or current-budget change. Evidence uses shared budget-engine expense/refund semantics; this decision does not approve a separate gross-expense/refund-offset formula. No current/historical allocations change.
7. Apply is atomic, idempotent, stale-state checked, and audited; conditional undo restores only unchanged operation-owned state and has no partial effect on conflict.
8. Server migration/legacy/limits/progress/failure/auth/integrity/apply/undo tests and financial-invariant tests pass in implementation. Android implementation and device verification are reported separately.

## Confirmed decisions

- **Ratio blocker resolved:** all modules in the proposed template solution total 100%. New template cards show the complete solution; existing-template updates require explicit user selection and show all affected module ratios before/after.
- Selected-period actual spend is evidence for the suggestion only. It does not directly set a budget amount, directly change the current budget, or authorize an inferred gross/refund formula.
- Use the existing shared budget engine's expense/refund semantics; do not implement a competing aggregation rule or presume a new refund-netting rule.
- Do not silently overwrite templates, rewrite legacy transactions/templates, reclassify historical records to accommodate category structure, or weaken bookability rules.
- The 500-row cap / 25-row batch are technical proposals only: neither user-approved nor benchmark-proven.
- Planning is not implementation authorization. A separate explicit final-review approval is required before `task.py start`.

## Remaining risks / implementation research gates

These are technical compatibility/validation gates, not a remaining ratio product question:

- **Referenced category parents:** design a compatibility strategy for categories with existing transaction/template references before adding child structure. Preserve old references and current new-entry bookability. If that cannot be proven for a proposal, reject/block that proposal rather than silently rewriting old data.
- **Legacy hierarchical tags:** verify stable identity, old name-array read/write compatibility, round trips, duplicate labels across branches, renames and legacy associations across all clients/routes.
- **Note suggestions:** specify authorization, retention, retrieval, and clear/delete lifecycle; never place source notes in audit or persist raw provider prompts/responses.
- **Evidence mapping:** validate how authoritative shared expense/refund aggregation maps to proposed modules without adding a novel gross/refund policy.
- **Capacity/progress:** benchmark representative payload size, memory, latency, provider calls, timeouts and failures at batch boundaries; choose and explicitly review a feature-specific cap before activation. Accepted runs must not sample or truncate.
- Final API/progress/card DTO and error/state-transition contract must be agreed with Android ownership before split implementation.

These gates may expose user-visible compatibility constraints; if so, return to user review rather than concealing them as technical “ready.”

## Planning artifact readiness

- `prd.md`: updated with resolved product semantics and acceptance criterion; no ratio-blocker language remains.
- `design.md`: updated with resolved ratio contract and explicit technical compatibility/validation gates.
- `implement.md`: updated pre-start gates and implementation checklist; no remaining ratio-resolution gate.
- `research/planning-research.md`: updated to mark numerical limits as provisional and remove the stale ratio-blocker wording.
- `implement.jsonl`, `check.jsonl`: curated context manifests retained.
- `task.json`: expected to remain `planning`; no task activation is requested or performed.

The planning package is coherent for final user review, but **not ready to start implementation** until technical gates are researched and implementation receives explicit approval.

## Scope and verification record

Only planning artifacts under `.trellis/tasks/10-19-ai-spending-organization/` are in scope. No product source, Android inventory, task status/pointer, or Git operation is authorized. Run `python ./.trellis/scripts/task.py validate 10-19-ai-spending-organization` and inspect scoped Git changes after writing; report actual results without implying implementation tests were run.
