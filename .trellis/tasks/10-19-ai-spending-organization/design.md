# Design — AI Spending Organization

Status: source implementation completed 2026-10-22 for server phases 1–3 and Android A105–A106; physical-device, real-Provider and independent-review acceptance remain pending. The approved PRD and product decisions below remain authoritative.

## Architecture and boundaries

Use an authenticated feature-specific server service under `packages/server/src/services`; keep route code limited to body parsing, auth/CSRF already supplied by the authenticated API plugin, orchestration and DTO mapping. Reuse the established AI provider/config path and server-side domain services. Never let the model select arbitrary database identifiers or author executable mutations: the server owns the eligible record snapshot, valid categories/tags/templates, normalized proposals, projections, fingerprints, limits and transaction writes.

Keep four phases distinct:

1. **Analysis** — accept a month shortcut or explicit inclusive date range; derive server-local epoch boundaries from transaction dates; validate bounds and eligible record count. Read only the range's live rows, produce bounded provider inputs, process all chunks, and report progress. No writes to ledger, tags, categories or templates. If any chunk fails, the run fails as a whole and yields no actionable partial card.
2. **Snapshot/review** — persist or otherwise safely bind a review snapshot to a deterministic complete input set, proposals and expiry/version. Cards show interval, record coverage, every affected transaction, exact before/after category/tag associations, new tag/category structure, note suggestions separately, and template diff/evidence. Re-read/fingerprint relevant transaction fields, category hierarchy, tag state and target template at confirmation; stale state is a conflict, not a skip.
3. **Card approval/apply** — one authenticated explicit confirmation selects the exact card's reviewed changes. Idempotency key/replay handling must return the original outcome for exact replay and reject key reuse with a different request. A single SQLite transaction revalidates the snapshot and all domain invariants, inserts any approved entities, applies selected transaction projections and optional template changes, and appends audit data. Any error rolls back every write. No external/provider call inside this transaction.
4. **Conditional undo** — read the operation audit and compare every operation-owned after-state before writing. If any later edit conflicts, return the feature's stable conflict error and make no changes. If all match, restore only these fields and append an undo event. Protect new entities with references outside this operation: do not hard-delete them; use the existing soft-delete convention only when reference/lifecycle rules permit it, otherwise report a conflict or retain the entity as unused.

## Data and API contract shape (provisional)

No endpoint contract is declared final before product decision and implementation review. Design for a feature-scoped analysis/review endpoint, progress/status read path or existing durable stream/job infrastructure where appropriate, an explicit apply endpoint tied to a review/card token and idempotency key, and an undo endpoint tied to operation ID. Reuse existing assistant generation streaming/job machinery only if it can provide durable, scoped, full-run progress and cancellation/failure semantics without storing unsafe raw content; do not force the generic conversation/tool-card model to own this dedicated workflow.

Request scope includes either a calendar month identifier or `startDate`/`endDate` (mutually exclusive). Server computes exact interval `[serverLocalStart(startDate), serverLocalStart(dayAfter(endDate)))`; disclose server-local timezone in response. Verify supported date range against existing transaction date validation and safe epoch bounds. User sees inclusive date labels, server timezone/coverage, eligible count and progress (completed/total batches and records); progress never implies that partial recommendations are executable.

Analysis inputs should contain only information necessary for semantic organization. Notes may be used as transient provider input only under the existing provider boundary, redaction/size controls and feature contract; they must not be persisted in audit or proposal storage as original notes. Persisting a separate AI note suggestion is permitted by user decision but requires explicit retention/access/clear lifecycle and must not mutate source notes. The service remains deterministic about identifiers, record scope, valid targets and normalized output.

## Schema / legacy compatibility

- Latest checked migration is 012 (`import-batches`). Any schema change requires a new additive TypeScript migration appended in `src/db/migrate.ts`; never edit shipped migration history. Migration runner provides transaction-per-migration and pre-upgrade backup behavior.
- A stable tag entity identity/hierarchy is necessary for parent/child semantics; current `tags_json` stores legacy names only. Plan an additive tag table (stable IDs, name, nullable parent ID, lifecycle timestamps/soft-delete fields) and a compatibility representation/projection only after detailed old-writer analysis. Preserve existing tag arrays and old Android clients' read/write behavior; decide how old names map, how collisions across hierarchy paths are disambiguated, and how old clients adding names are resolved. Do not destructively rewrite or discard legacy names during backfill.
- Backfill should be deterministic, restart-safe, and preserve transaction associations. Use a staged compatibility approach if a one-shot migration cannot preserve old-client writes. Parent/child parent references must be validated as max depth two; cross-branch multi-tag membership and direct parent assignment remain valid.
- **Template ratio and selected-period evidence semantics are resolved** as documented above. Implementation must preserve complete template-solution ratios summing to 100%, full new-template proposals, and complete affected-module diffs for explicit existing-template updates. Actual spending is suggestion evidence only, not a budget amount or current-budget mutation; use shared expense/refund semantics without inventing gross/refund policy.
- The category-parent, legacy-tag, note-suggestion lifecycle, evidence mapping, and calibrated-cap items are technical compatibility/validation gates, not resolved implementation details. Research them before implementation; preserve existing records and behavior, and do not silently migrate or rewrite user data to force the proposed workflow.
- Template rows use `modules_json` category/ratio entries. Existing validator requires nonempty unique modules, positive finite ratios summing to 1 within `RATIO_SUM_TOLERANCE`, and forbids selecting a parent and its child together. Future template edits must pass the same validator and not touch allocations/salary snapshots.
- New entities must not be removed by undo when later referenced. Existing domain records use soft deletion; determine safe lifecycle in tests and implementation.

## Aggregation and semantic integrity

Use the shared expense/refund contribution helpers and existing server definitions for eligible expenses; do not infer refund meaning from note text or count an income-typed refund as expense. The user confirmed actual interval spending amounts are evidence, not proposal budget amounts. The selected-range actual evidence contract should explicitly state whether totals are gross expenses or another metric consistent with the shared budget engine; do not calculate a second interpretation.

Parent-tag filtering must form a deduplicated transaction set: direct parent association OR any child association, with one result per transaction. Child selection matches that child only. Existing category filtering semantics do not implement tag hierarchy and cannot be reused as if they did.

## Limits, batching and progress

Existing evidence: generic organization semantic preview cap is 200 and assistant bill import currently sends sequential chunks of 25; import pipeline has distinct caps (e.g. merged import up to 500 items) that do not imply this feature's safe capacity. Provider transport response limits (2 MiB) are not evidence that large analysis is safe or complete. Therefore, propose a feature-scoped numeric cap only after representative synthetic and available real-data characterization of memory, request size, provider calls, latency and timeout behavior. The research/implementation plan must record proposed numeric cap and evidence; if calibrated tests are unavailable, mark cap provisional and request explicit acceptance before code is activated rather than presenting an arbitrary value as proven safe.

Every accepted run must finish all batches. Any provider or normalization failure marks the entire run failed; no partial actionable result. Explicitly reject intervals beyond cap before producing cards. Retry policy must not duplicate writes; only failed analysis may be retried, producing a new review snapshot/version. Progress must be tied to one run and reject stale late completions.

## Security, privacy, error behavior

Use existing session and CSRF guards, domain validation, safe provider error mapping, and `{error:{code,message}}`. Validate date shape/order, range cap, category type/bookability, tag count/name/depth, template selection and ratios at server trust boundaries. Do not log credentials, notes, provider prompts or raw provider bodies. Provider is advisory; it cannot expand scope, invent valid IDs, mutate state, or turn a partial response into success.

## Rollout and rollback

No live migration or deployment is included. Migration is additive, test upgrade from existing versions 001–012 using fixture databases including legacy flat tags and referenced parent categories, and verify rollback of failed migration leaves schema/data/version intact. Code rollback must continue reading existing schema/data. Do not make tag IDs mandatory for old clients until compatibility is proven. Runtime feature activation should be gated until API/native clients support the same contract; details require product/implementation review.

## Budget ratio and evidence semantics

The product decision is resolved: all modules in the proposed template solution are represented and their ratios sum to 100%. A new-template card shows the complete proposed solution. An update card targets only the template explicitly selected by the user and shows every affected module ratio before and after. Selected-interval actual spending is explanatory evidence for the suggestion; it is neither a budget amount nor a direct current-budget change. The suggestion logic must follow existing shared budget-engine expense/refund semantics. This decision does not define a new gross-expense denominator or refund-offset rule; do not invent one.

## Open technical compatibility and validation gates

These are unresolved implementation/research constraints, not remaining product questions and not grounds to declare the package implementation-ready:

- **Referenced category parents:** Current category parents cannot receive new transactions, but historical transactions/templates may directly reference a category before it becomes a parent. Before implementing structure creation, inspect all category/template/transaction constraints and choose a compatibility strategy that preserves old ledger/template references and the current bookability rule. Do not implicitly move, reclassify, delete, or reinterpret historical transactions or templates. If preserving both constraints for a proposed structure cannot be demonstrated, reject/block that specific structure proposal rather than silently rewriting existing data.
- **Legacy tag identity:** Determine whether/how stable hierarchical tag entities can coexist with legacy flat `tags_json` writers and name-based readers. Preserve old names and associations, resolve collisions and old-client round trips explicitly, and do not silently map a legacy name to a different branch or identity.
- **Note suggestion lifecycle:** Specify access control, persistence duration, retrieval, and clearing/deletion for separate AI note suggestions; source notes remain immutable and must not be copied into audit. Minimize retained content and do not persist prompts/raw provider responses.
- **Evidence/ratio calculation:** Reuse the shared budget engine's expense/refund semantics. Verify how its authoritative module/category aggregation maps to proposed modules; do not introduce a competing gross/refund formula.
- **Capacity/progress:** The 500 eligible-row maximum and 25-row sequential batch are provisional engineering proposals only. Benchmark representative bounded payloads, memory, latency, provider calls, timeouts and failure at batch boundaries; obtain explicit acceptance of the calibrated cap before activation. No sampling or silent truncation is permitted.

These gates should be researched and documented during implementation planning. Any finding that changes the user-visible scope or requires a new product choice must return to product review; technical risk must not be hidden behind a “ready” label.
