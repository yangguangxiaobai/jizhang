# Implementation Plan — AI Spending Organization

Status: source implementation completed 2026-10-22; task remains `in_progress`. Server phases 1–3 and Android A105–A106 are implemented and locally verified. The pre-start gates below are retained as historical planning records; activation was authorized in `research/implementation-authorization.md`, and unresolved acceptance items are listed in `research/spending-organization-status.md`. Device, real-Provider and independent-review acceptance remain pending.

## Pre-start gates

1. Complete technical compatibility research for referenced legacy category parents, tag ID/name dual compatibility and same-name tags across branches, and AI note-suggestion retention/access/clear lifecycle. Preserve old ledger/template references and current validation; do not silently rewrite user data. Any research finding that changes user-visible behavior returns to product review.
2. Calibrate the proposed 500-row run cap / 25-row sequential batch with representative payload, provider-call, memory, latency, timeout, and partial-failure evidence. These remain engineering proposals, not accepted/proven limits; document the measured result and obtain explicit acceptance before activation.
3. Verify how actual-spending evidence maps to proposed modules using the shared budget engine's expense/refund semantics. Do not add a competing gross/refund calculation or claim that the ratio decision approved one.
4. Agree final API/progress/card DTO contract with Android implementation ownership before parallel implementation. Planning-only work does not edit Android or API source.
5. Obtain explicit final review approval before `task.py start`; this planning turn does not grant implementation approval.

## Independent review follow-up

The tag-foundation independent review reported BLOCKED. Its seven backend findings are addressed in source/tests and documented with evidence in `research/tag-foundation-review-fixes.md`; independent re-review remains required. This does not approve implementation of the full AI spending organization feature. Do not treat the historical 203-test implementation report result as independently rerun.

## Ordered execution checklist

### 1. Final contract and evidence baseline
- Refresh source line references and verify migration head, endpoint/auth/CSRF conventions, current Android source and documented 156-test baseline.
- Freeze date wire format (month vs inclusive `startDate`/`endDate`), server-local interpretation, exact response coverage fields, analysis error contract, progress lifecycle, cancellation/retry, stale review behavior, and idempotency semantics.
- Confirm no feature-scoped numeric ceiling is promoted without measured evidence. Add feature-specific error codes to the established `{error:{code,message}}` contract.
- Define ratio suggestions across the complete proposed template solution, totaling 100%; show a new template's full solution or all affected module before/after ratios for an explicit existing-template update. Show interval spend as evidence only, not budget amount/current-budget mutation. Map evidence through shared budget-engine expense/refund semantics without inventing a gross/refund policy.
- Define allowed provider payload/redaction, response schema, normalization, and what evidence facts are displayed. Provider output must never invent transaction/category/tag/template IDs or widen scope.

### 2. Legacy schema and compatibility design
- Additive TypeScript migration after current migration 012; register it at the end of `MIGRATIONS`, never edit shipped migrations.
- Implement stable tag IDs and max-two-level parent relation with deterministic legacy-name backfill, but only after old Android/API writers are accounted for. Preserve legacy transaction tag associations and old-client round trips. Include same-name-on-different-branch and rename semantics.
- Define and implement category-parent compatibility so adding a child cannot invalidate existing direct transaction references or allow new transactions to violate current bookability validation.
- Add durable run/review/audit/idempotency schema only for data needed by progress, exact snapshot, apply and conditional undo. Ensure no original notes, credentials, prompts or raw Provider bodies are stored in audit.
- Migration tests: fresh database; upgrade at versions 001–012; idempotent boot; realistic flat-tag collisions/malformed tag JSON; legacy categories with direct and child references; failure rollback and migration version not recorded.

### 3. Read-only bounded complete analysis
- Add a domain service to resolve month/custom dates to server-local inclusive calendar selection and a half-open epoch interval. Query eligible live rows by transaction date only; capture deterministic sorted IDs and relevant before-state fields.
- Enforce approved feature cap before starting. Batch provider work sequentially with visible per-run progress. An accepted run completes every batch; a provider/normalization failure or stale run fails whole analysis and cannot yield an actionable card.
- Normalize AI advice against server-owned eligible rows and catalog. Validate same transaction type/bookability for category targets; validate tag entity hierarchy, tag limits and template constraints. Return explicit coverage, interval/timezone, progress, status and safe errors.
- Persist note suggestions separately under the approved retention contract; preserve source notes exactly. Keep analysis read-only with DB byte/data invariance tests.
- Test date boundaries (month/year, timezone/DST), empty interval, inclusive end day, rows outside range, soft-deleted rows, refunds, large chunks, over-cap reject, partial Provider failure, malformed/unknown/duplicate IDs, progress run isolation, retry and no partial card.

### 4. Review card and exact snapshot
- Bind each card to completed full-run snapshot, complete coverage count, expiry/version, safe proposal IDs, deterministic fingerprint and selected action projection.
- Ratio suggestion cards must follow the resolved contract: the complete proposed template solution totals 100%; show all modules for new templates and every affected module's before/after ratio for an explicitly selected existing template. Actual interval spending is evidence only and does not set budget amounts or change the current budget. Evidence aggregation follows shared expense/refund semantics; no new gross/refund formula is authorized.
- Continue to enforce explicit user selection for updating a template and future-use-only effects; do not invoke current-cycle template application.
- Show no action before explicit approval; cancellation/expiry is read-only. Revalidate reviewed rows/catalog/template on review/apply and return a stable conflict when state differs.
- Test card projection does not serialize original notes or sensitive Provider data, and partial/failed jobs cannot produce an approvable card.

### 5. Atomic idempotent apply and conditional undo
- In one SQLite transaction, revalidate all snapshot fields and every category/tag/template invariant; create only user-approved entities; update only selected in-scope transaction category/tag associations; apply only future-template edits; append minimal audit/operation records. Do not alter amount, type, account, date, refund data, salary, budget allocations or source note.
- Use explicit idempotency key with identical replay response and mismatched replay rejection. Provider calls are strictly outside the write transaction.
- Implement conditional undo by comparing all operation-owned after-state fields first; conflict means no changes/events. Restore only classification/tag/template changes. Protect entities with references acquired after apply; do not hard-delete or overwrite unrelated work.
- Test atomic rollback at each write boundary, exact replay/mismatched key, stale transaction/category/tag/template, unrelated record isolation, immutable finance/note invariants, template-only future effects, undo success, undo conflict/no partial writes, and referenced newly-created entity protection.

### 6. API and Android integration contract
- Add authenticated routes with existing CSRF/error conventions; thin handlers delegate to service. Ensure ownership/access checks bind run, card and operation IDs to the authenticated account.
- Handoff final request/response examples, status/error matrix, progress polling/stream semantics, caps, and state transitions to Android owner before client implementation.
- In the later Android implementation change, update `clients/android/README.md` stable IDs, fields/validation, entry points, API coverage, known gaps and change log in the same change. Preserve ID history. Report source/test/device/Provider verification separately; do not claim physical verification from compilation.

### 7. Verification, review, rollout and rollback
- Narrow server test files first; then from repository root run `pnpm -r run lint`, `pnpm -r run typecheck`, `pnpm -r run test`.
- Run migration fixture/upgrade tests and verify migration failure rollback. Run deterministic Provider mocks only; a real Provider call is separately authorized and is not part of default verification.
- Android work separately runs its documented Gradle checks and updates the README; device acceptance is a distinct gate.
- Reviewer checks endpoints/contracts, privacy, transaction atomicity, category/tag compatibility, financial invariants, conditional undo, migration rollback and documentation drift. Do not deploy/migrate production as part of implementation verification without explicit authorization.

## Risky areas and rollback points

- Tag schema/backfill and legacy name-array dual writes; keep old representation readable until old clients are proven compatible.
- Category parent/bookability compatibility; do not automatically add a child to any actively used bookable category without a validated preservation policy.
- Large-range provider requests, cost, timeouts and partial result exposure; cap must be evidence-backed and failures must fail closed.
- Template updates have future-use-only semantics; avoid the existing current-cycle apply path.
- Audit/undo entity lifecycle and concurrent edits; rollback entire transaction on mismatch.
- Migration rollback is code rollback to additive schema, not a destructive down migration. Preserve legacy fields/data so earlier application code can continue reading them.
