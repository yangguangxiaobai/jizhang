# Backend eligibility follow-up review

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Scope: server/shared import eligibility only; read-only Android contract comparison.
Status: completed for the scoped server fix; parent/frontend handoff remains for Android hard-block parity.

## Finding and resolution

The review validator previously treated `ledgerStatusOf(ignoreReason) === 'blocked'` as a selection prohibition. That conflated the identity algorithm's semantic status fact (used for strong-order financial equivalence) with product eligibility. As a result, positive parser rows marked by `状态非成功` / `状态:*` were rejected even though the approved behavior is that parser rule reasons are informational unless another explicit hard blocker applies.

Batch eligibility is now enforced by the selected-row validation boundary: amount must be positive, the row must not already exist, and `conflictKind` must not be `weak_collision` or `ledger_collision`. `fact_conflict` remains selectable only under the existing explicit 0-or-1 decision rules. Unknown/malformed request values, missing or invalid categories, parser/file failures, and the normal financial validation continue to reject as before. `ledgerStatusOf` remains in strong identity semantics and was not changed. No parser, provider, refund classification, legacy import, or wire schema behavior was changed.

- Batch `summary.importable` and `filter=importable` are checked against the same positive/non-existing/non-weak-or-ledger-collision predicate. Rule-ignored totals remain a separate informational summary field. `summary_json` is a stored snapshot refreshed on source/identity mutations, so the HTTP regression verifies the importable filter directly and the shared SQL predicate via the live row data; it does not assert summary refresh after an unsupported direct DB mutation.

## Tests

Added actual HTTP review regression coverage for a positive status-rule-ignored stored row being explicitly selected and summarized using its parser-derived financial type; added negative coverage for nonpositive, already-existing, weak-collision and ledger-collision selections. Existing tests cover fact-conflict choice requirements and identity status semantics.

The test fixture mutates only the isolated in-memory test DB row to label a normal positive row with a parser status reason, keeping review request flow and assignments representative without inventing a new financial interpretation.

## Remaining cross-layer findings for parent

1. Android `AssistantBatchModels.kt` currently computes `isHardBlocked` from amount and `ledger_collision` only. It omits `weak_collision`, while the frozen policy forbids selecting any weak-collision member. `isEligible` also needs equivalent alignment. Parent should route this small Android fix to its owner; no Android file was changed here.
2. Protocol v1 explicitly says selected rule-ignored rows remain selectable, while an older `design.md` §10 item 3 groups “不 eligible selected 一律拒” with the collision decisions without defining eligibility. Treating that broad phrase as a new `ignored/status` lock would contradict the explicit protocol rule and the approved task direction; this patch does not create such a restriction. Parent may clarify the older checklist in their own protocol/artifact ownership.
3. Android approval review records that category reuse is encoded with wire `resolution: "create"` plus `reuseCategoryId`, whereas an older contract-proposal walkthrough labels the UI path “create | reuseCategoryId”. The actual server route and current Android serializer agree on `resolution: "create"` + `reuseCategoryId`; wire contract was not changed. Parent should record the resolved wording in parent-owned documentation.

## Changed implementation paths

- `packages/server/src/services/import-batch-service.ts`
- `packages/server/test/import-batch-confirm.test.ts`
- `.trellis/tasks/10-17-ai-bill-import-improvements/research/backend-eligibility-review.md`

No Android, spec, README, frozen protocol, provider/device/deploy/config/dependency, staging or commit changes were made.
