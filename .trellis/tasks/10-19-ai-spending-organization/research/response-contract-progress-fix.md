# Response contract and observable progress follow-up — 2026-10-22

## User report

Android returned AI_RESPONSE_INVALID with no review card, and showed only a spinner while calling AI. User requests a fix and visible actual execution progress.

## Verified source root cause

The spending service used feature `organization`, whose preset system prompt hardcoded three legacy arrays (`suggestions`, `reclassifications`, `newCategories`). The spending response schema and normalizer require five arrays (`reclassifications`, `tagSuggestions`, `noteSuggestions`, `newCategories`, `templateProposals`). The old unit suite stubbed provider.complete with already-correct objects, bypassing prompt/HTTP construction. Production response bytes were NOT collected, so this is a verified source-contract bug and deterministic reproduction, not a claim to know the exact upstream response in the user's failed run.

Separate `spending-organization` prompt preserves legacy merge behavior and explicitly requires all five arrays even when empty. Do not turn omitted or wrong-shaped arrays into successful empty advice. Custom provider bodies remain operator controlled.

## Implementation boundary / contract

- Keep existing date range, 500-row cap, 25-row batches, financial invariants, review/apply/undo semantics. Do not change provider credentials/model/timeout defaults.
- POST with `{startDate,endDate,background:true,clientRequestId}` returns run identity before deferred provider work; GET reads persisted status only. Legacy requests without background remain awaited for compatibility.
- Same start key/body replays existing run; mismatched key/body rejected; another active run rejected with BUSY. No automatic model retry.
- Add migration017 only (do not edit shipped014): progress_json, nullable unique client_request_id and request_hash.
- progress: phase, total/completed/current batches, validated records, validated suggestion count (NOT applied), timestamps, bounded64 fixed user-facing event messages, fixed safe error stage/field/batch. No raw response/prompt/secret/source-note stored in progress.
- Any failure clears every partial suggestion/card/note; schema mismatch names only one known schema field. No actionable partial result.
- Abort and await jobs in Fastify preClose (not onClose after HTTP draining). Boot marks orphaned running rows interrupted; GET/restart never calls Provider.
- Android sends background:true and UUID; reads actual server phases/counts/timeline, bounded 15-minute observation with GET recovery, uncertainty retains run identity/request key rather than blindly creating another run. Lifecycle/server/current-session guards reject stale completions. No fabricated percentages/hidden model thinking.

## Validation / evidence to collect

- Real provider request builder + mocked HTTP envelope + real service normalizer regression, both preset transports; initial regression must catch old discriminator.
- Deferred Provider: return202 before response, batch1 checkpoint visible while batch2 pending, GET no provider calls, failure batch/field no partial card, exact replay/BUSY, close/no late ready, orphan startup, schema16->17 additive/idempotent upgrade, auth/CSRF routes.
- Android strict DTO/count consistency, event ordering, incomplete-ready rejection, response ownership and exact replay/progress recovery helpers used by workspace.
- Full server lint/typecheck/tests and Android test/lint/build. Real Provider, production deployment/migration, and device acceptance remain separate.

## Independent-review observations

Reviewer found shutdown-onClose would not interrupt in-flight legacy awaited POST before Fastify drained HTTP; corrected to preClose. Reviewer also identified pre-existing apply/undo issues: simultaneous category+tag on one transaction records incompatible duplicated after-projections; apply revalidates only category/tags, not full relevant row/catalog state. These are not introduced by the prompt/progress fix and remain recorded risks; do not claim all original PRD acceptance gates complete or widen silently.
