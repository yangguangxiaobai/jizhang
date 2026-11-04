# Technical design

## Boundaries and flow
1. Shared parser owns immutable file facts, source status/direction, explicit refund evidence and hard validation. Distinguish refunded expense from refund-income movement; status cannot manufacture a second movement.
2. Server prepares deterministic read-only preview. A dedicated bounded analysis integration reuses saved provider configuration, encryption and HTTP error handling; submits only preview facts needed for review and active bookable category IDs. Treat file text as untrusted data, never instructions/tools. Separate feature prompt/schema from monthly aggregates.
3. Validate structured analysis keyed by known row IDs: inclusion recommendation, bounded reason, valid type-compatible category ID. Reject invented/duplicate IDs or malformed output. No financial fact overrides, no tool execution from analysis. Analyse up to the displayed 200-row bound in bounded batches; disclose truncation. Failure/partial failure must not be advertised as completed analysis; preserve source preview, show failure, support explicit retry.
4. Persist the validated recommendations with the pending preview, using current conversation/action storage contracts; do not persist raw provider payloads or secrets. Android starts eligible selection from AI recommendation (capped at 100) rather than keyword defaults and lets users override. Keep existing request-generation isolation.
5. Review edits use per-row existing category IDs and notes (empty string is an explicit clearing value). Additive assistant-specific fields must be validated across route, orchestrator, registry, service and repository; preserve legacy category-name input for the independent data-management flow. No implicit assistant category creation/restoration; preserve existing platform account behaviour.
6. Confirmation reparses the matching original file and revalidates hard eligibility, duplicates, active category/type/leaf constraints and edited values. It never calls the model again. Fingerprint covers authoritative source facts, explicit selection and reviewed category/note/refund values; recommendations are not random inputs to repeated fingerprint generation. Confirm writes reviewed rows in one transaction using existing action lifecycle/idempotence guards.

## Refund semantics
Original refunded purchase remains original expense. Actual refund row is income with explicit isRefund independent of classification. Missing refund movement stays missing; indicate when refunded status lacks separately represented refund evidence. Keep failure/closed-state exclusions and stable source identities. Ambiguous direction must not be converted into fabricated income. File fixtures must validate real header/status variations before parser changes.

## UI
Retain full-screen workspace and second review. Display source details/note, AI recommendation/reason, status and concrete hard blockers distinctly. Category editor uses type-filtered current categories, no free-text creation. Add note editor and preserve separate source vs reviewed value. Review summary presents selected income/expense, category/note edits and refund labels; empty selection cannot confirm. Preserve 200 preview/100 selection and unknown-result refresh protections.

## Compatibility and rollback
Changes are additive where possible; assistant strict-ID mode is opt-in at the service boundary so legacy name-based platform import remains compatible. Determine whether a schema migration is needed only after checking existing pending-action JSON shapes (prefer current versioned JSON storage). Revert task-owned changes only; workspace already has extensive unrelated edits. No production deployment or database mutation during validation.

## Risks
WeChat exports may contain refunded purchase rows without independent refund movements. Provider custom templates need feature facts/schema support without weakening secret boundaries. Existing bounded preview note truncation must not silently truncate untouched persisted notes. Model latency/output limits require bounded batching and clear errors. Real AI/device evidence is separate from mocked integration tests.
