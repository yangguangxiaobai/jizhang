# AI Spending Organization, Hierarchical Tags, and Budget Suggestion Cards

Status: planning. This document records approved product decisions and evidence-backed constraints. Implementation is not approved; do not activate the task based on this planning package alone.

## Goal

Let a user review AI-assisted organization of transactions in a chosen date range, correct categories and hierarchical tag assignments, review separate note suggestions without changing original notes, and optionally create or update a future-use budget template through explicit proposal cards. Preserve financial facts and provide conditional undo for the operation's own changes.

## Background and confirmed current behavior

Source audit: `artifacts/ai-organization-capability-audit-20261019.md` (source inspection only; not runtime/device verification).

- Existing organization preview samples up to 200 recent live transactions and has no date-range request. Its executable apply actions are duplicate tag/category merges; semantic reclassification recommendations are advisory only.
- Transactions store tags as name arrays in `tags_json`; there is no tag entity table or tag hierarchy. Categories have a separate, one-parent-level hierarchy. Tags and categories/modules must not be conflated.
- Categories with children are non-bookable under current transaction validation. Existing category rows may already be referenced by transactions and templates; legacy references must remain valid.
- Templates store category/ratio projections. Salary records create allocation snapshots; changing a template does not retroactively change those snapshots. Current-cycle application of a template is an existing separate operation and is out of scope here.
- Existing organization audit is append-only and conditional undo rejects if affected fields changed after apply. Existing assistant writes use prepared cards, but Android has no dedicated date-range organization workspace.
- Server migrations are additive TypeScript modules, ordered in `MIGRATIONS`, each applied transactionally. Migration 012 is the latest migration at research time.
- The shared budget engine owns expense/refund aggregation. Do not introduce a second competing expense calculation.

## Requirements and decisions

### R1 — Scope, dates, coverage, and progress

- Offer calendar-month shortcuts and a custom start/end date range.
- Select transactions by their transaction `date`, not creation/update time. Interpret selected calendar dates in server-local time; start and end dates are inclusive calendar days (query boundary implementation must therefore avoid a client/server timezone mismatch).
- Analyze every eligible live transaction in the selected interval. No sampling, silent truncation, or partial results presented as complete.
- For large accepted ranges, process in bounded batches and expose truthful visible progress. Publish actionable cards only after every batch succeeds. If the selected range exceeds the declared feature cap, explicitly reject it with narrowing guidance. A failed run publishes no actionable partial card.
- Display the exact selected interval and eligible record count. Any snapshot/staleness policy must ensure the reviewed set is the set that apply revalidates.

### R2 — Transaction organization and notes

- Propose category and tag changes grounded in the selected transaction content and show before/after values and affected transactions before execution.
- On confirmation, the operation may add, remove, or replace tag associations on selected transactions. It may reclassify only in-scope transactions and must honor transaction/category type and bookability rules.
- AI may propose new tag entities and parent/child tags. No entity is created during analysis or card display; creation requires the same explicit confirmation as associated transaction changes.
- Original transaction notes are immutable in this workflow. A proposed organized note is displayed and stored separately as an AI suggestion; it must not replace or clear the source note. Suggestion persistence, access, and clearing must follow an explicit lifecycle in the design.
- Never modify amount, type, account, date, refund identity/linkage, or other financial facts.

### R3 — Hierarchical tags

- Tags support at most two levels: parent and child. This hierarchy is independent of category/module hierarchy.
- A transaction may have multiple tags across branches, and may be assigned directly to a parent tag.
- Filtering by a parent includes direct parent assignments and assignments to any child; a transaction appears/counts once even if it matches more than one of those tags. Filtering by a child selects that child.
- Preserve legacy flat tag names and existing transaction associations. Stable identity and name-compatibility strategy is a design/migration requirement; do not silently reinterpret old names or lose associations.

### R4 — Budget proposal cards

- Support both structure-only proposals and module-plus-budget proposals.
- Structure-only creates the proposed category/module structure and organizes its associated selected transactions, with no budget amount or ratio change.
- Module-plus-budget proposes ratios for future use only. The ratios across all modules in the proposed template solution sum to 100%. For a new template, show the complete proposed solution; for an explicitly selected existing template, show the complete set of affected module ratios as a before/after diff.
- Selected-interval actual spending amounts are evidence for the ratio suggestion only. They are not copied or converted directly into budget amounts, do not directly set module ratios as spending amounts, and do not change the current budget.
- Support creating a new template (default) and updating a template explicitly selected by the user. Never choose or overwrite an existing template implicitly; show a before/after diff for updates.
- Template changes affect future template use only. Do not change current-cycle allocations, historical salary/allocation snapshots, or automatically apply a template to any cycle.
- Expense/refund evidence must use the existing shared budget-engine semantics; this decision does not establish a new gross-expense or refund-offset formula.

### R5 — Authorization and atomicity

- AI produces review cards. One explicit user confirmation executes exactly the changes shown by that card. There are no writes during analysis, card creation/display, or background processing; no unattended application.
- A canceled/unconfirmed card causes no mutation. Applying the card must be idempotent and all-or-nothing across selected transaction/category/tag/template changes, with stale-preview conflicts reported rather than silently skipped.
- Audit only the minimum identifiers and before/after projections needed for accountability and conditional undo; never persist prompts, provider secrets/raw responses, or original notes in organization audit.
- Conditional undo is required for the operation's classification, tag-association, and template changes. If a later edit conflicts, report conflict and do not overwrite it. Do not delete a newly created entity that has acquired references outside this operation; define soft-delete/reference protection in design.

### R6 — Native Android contract and evidence

- The feature must support Android through its maintained native inventory. Update `clients/android/README.md` only when implementation is approved and Android code changes; this planning-only turn must not modify it.
- Keep source, automated test, live Provider, and physical-device verification claims distinct. Current Android README baseline is 156 unit tests as of its documented audit; this is a baseline, not evidence for this feature.

## Acceptance criteria

- AC1: A user can choose a month or inclusive custom date range and sees its exact server-interpreted boundaries and eligible count. Only live transactions in that scope are candidates.
- AC2: Accepted ranges are analyzed completely in visible bounded batches. Any over-cap or batch failure is explicit; no truncated or partial actionable result is published.
- AC3: Review shows each proposed category/tag change with transaction identity, before/after state, and evidence/reason. A single explicit confirmation applies only the reviewed scope; cancellation changes nothing.
- AC4: Original notes and all financial facts remain byte/value-identical. Note suggestions are separately displayed and cannot overwrite the original note.
- AC5: Parent/child tags, direct parent assignment, multiple branches, legacy names, and deduplicated parent filtering behave as specified without confusing tags with categories.
- AC6: Structure-only proposals do not alter template ratios or allocations. For module-plus-budget proposals, all ratios in the proposed template solution sum to 100%; a new template displays the complete solution, and an explicitly selected existing template displays every affected module's before/after ratio. Selected-interval actual spending appears only as evidence and is not copied into a budget amount or used to change the current budget. Current/historical allocations remain unchanged; expense/refund evidence follows the shared budget-engine semantics.
- AC7: Apply is atomic, idempotent, stale-state checked, and auditable. Conditional undo restores only unchanged operation-owned fields and returns a conflict without partial undo if later edits collide.
- AC8: Server tests cover migrations/upgrades, legacy data, limits/progress/failure, auth/CSRF, integrity, apply/undo, and the exact no-financial-facts-change invariant. Android implementation and device verification are separately reported.

## Out of scope

- Changing transaction amounts, dates, accounts, types, refund facts, or source notes.
- Automatically changing current or historical budget allocations or applying a template to a cycle.
- Deleting tag entities as a consequence of permission to remove/replace a transaction's tag association.
- Web UI, autonomous/background writes, provider configuration/deployment, live migrations, APK installation, or task activation within this planning turn.

## Decision status

The budget-ratio product decision is resolved: ratios cover all modules in the proposed template solution and sum to 100%. A new template proposal displays the full solution; an update proposal for an explicitly selected existing template displays all affected module ratios as a before/after diff. Selected-period spending is suggestion evidence, not a direct budget amount or a change to the current budget. Evidence calculations continue to use the existing shared budget-engine expense/refund semantics; this does not approve a separate gross-expense or refund-offset policy.

Numerical analysis cap and progress mechanism remain technical validation items, not approved product numbers: the design/research records the 500-transaction cap and 25-transaction batch as provisional proposals only. They must not be presented as user-approved or benchmark-proven.
