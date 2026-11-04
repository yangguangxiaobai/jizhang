# Backend fix handoff — F1 (nested write-prepare abort/deadline) + F2 (surrogate-safe truncation)

Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Owner: Pi native backend implementation subagent (no nested agents).
Input review: `research/backend-final-review.md` (F1 blocking, F2 non-blocking).
Frozen contract: `research/protocol-v1.md`, `.trellis/spec/backend/assistant-streaming.md`.
Scope: `packages/server` streaming sources + tests; this file. No protocol change.

Status: COMPLETE

## Scope boundary
- Changing: `src/services/assistant-generation-runner.ts` (scoped write-prepare
  context + abort/deadline + post-await fences), `src/services/assistant-types.ts`
  (surrogate-safe 4000-unit bound), + `test/assistant-stream-routes.test.ts`.
- Not changing: public routes/payloads/events/snapshot, migration, Android, docs, spec,
  provider service transport, model/credential/timeout configuration.
- Not doing: install, real provider calls, deploy, APK, device, ledger booking, stage/commit.

## Findings confirmed on disk (before fix)
1. F1 confirmed: `finishWriteTurn` awaited `this.registry.prepare(this.toolContext, …)`
   with the shared, un-scoped context (built once in the constructor), no
   `AbortController`, no deadline timer, no `setUpstreamCanceller`, and no post-await
   deadline check. `organization.apply`'s `prepare` awaits
   `context.services.organization.preview()` → `explain()` → `provider.complete()`.
   Stop/archive therefore waited for the nested provider round trip and a slow prepare
   could persist a `completed` card after the 180 s deadline.
2. F2 confirmed: `readTool`/`finishTextTurn`/`finishWriteTurn` used
   `turn.message.slice(0, 4000)` (UTF-16 units) and
   `normalizeAssistantProviderTurn` used `.trim().slice(0, 4_000)`; a buffered provider
   message ending on a surrogate pair could be cut in half and persisted.

## Progress log
- [x] Confirmed both findings against current sources.
- [x] F1 fix + 2 tests.
- [x] F2 fix + 2 tests.
- [x] lint / typecheck / full test / build with saved logs.

## Fix log (append as each lands)

### F1 — nested write-tool `prepare` now runs in a scoped, cancellable, deadline-bounded context

`assistant-generation-runner.ts`
- Extracted `openToolScope(generationId, deadline)` from `readTool`: builds one per-call
  `AssistantToolContext` whose provider composes the caller signal with a private
  `AbortController`, freezes `remainingMs = max(1, deadline - now())`, arms a deadline timer,
  registers itself via `generations.setUpstreamCanceller`, and exposes `aborted` +
  `dispose()`. `readTool` now uses it (no behaviour change: same signal composition, same
  timer/cleanup, same post-await fence).
- `finishWriteTurn` now takes `deadline` and awaits
  `Promise.race([registry.prepare(scope.context, …), scope.aborted])` inside
  `try { … } finally { scope.dispose() }`. Post-await fences: liveness/archived, then
  `now() >= deadline → failDeadline` before any card/pending action is persisted.
- Call site passes `deadline`. Public routes/DTOs/events unchanged.

Tests (`test/assistant-stream-routes.test.ts`, new `describe`):
- "stops while organization.apply waits for its nested provider" — seeds a ready
  `category-merge` plan, streams a turn with `organization.apply`, gates the second provider
  request; asserts `POST …/cancel` returns 200 in < 1 s, status `cancelled`, no late card,
  no pending action, ledger count unchanged.
- "fails the generation when a nested provider prepare outlives the deadline" — after the
  nested request is in flight, `currentNow` jumps past the 180 s deadline before the gate
  resolves; asserts terminal `failed`, `outcome: null`, no card, no pending action.
- The test file's wall clock became injectable (`currentNow`) so the deadline can be crossed
  without real waiting; the boot-recovery test keeps `DATE_MS`-style constants (`NOW`).
- Both fail against the pre-fix code (verified by temporarily restoring the un-scoped
  `registry.prepare(this.toolContext, …)`): the cancel test times out at 5 s and the deadline
  test reports `completed` instead of `failed`.

### F2 — surrogate-safe truncation for buffered provider text

`assistant-types.ts`
- Added `MAX_PROVIDER_MESSAGE_UNITS` + `boundedProviderMessage()`; `normalizeAssistantProviderTurn`
  now trims and bounds with it instead of `.slice(0, 4_000)`, so the 4000-unit bound never
  cuts a surrogate pair.
- Root cause of the remaining path: `normalizeAssistantJson` (used by `jsonObject` at the top
  of `normalizeAssistantProviderTurn`) bounded strings at `MAX_STRING_LENGTH` and re-expanded
  the already-truncated, half-surrogate message while copying JSON members. That copy now uses
  the same `boundedProviderMessage`, so any bounded assistant string — provider message, tool
  preview/card text — stays surrogate-safe. `MAX_STRING_LENGTH` is still a plain unit budget;
  characters are dropped, never split.

Tests:
- `test/assistant-contracts.test.ts`: unit test — `3999 ASCII + 😀` yields exactly 3999 units
  with no trailing high surrogate; a message that fits keeps its emoji intact.
- `test/assistant-stream-routes.test.ts` (`describe('buffered provider Unicode boundary')`):
  responses-mode buffered turn `'字'.repeat(3999) + '😀'` → terminal `completed`, persisted
  `content.text` has 3999 units, contains no surrogate code units at all, and the durable row
  matches the snapshot.

### Non-goal recorded
`assistant-stream-tokenizer.ts` rejects an **empty JSON array** value (`[]`) — the `comma`
state always expects a value next, so `{"a":[]}` fails the envelope. That is why the nested
provider call in the tests is reached by selecting the ready action id rather than sending
`actionIds: []`. Pre-existing and out of the fixed scope (not part of F1/F2); flagged here for
follow-up so it is not mistaken for a regression.

## Quality gate
Run from `packages/server`; logs in `artifacts/` (repo root).

| Command | Log | Exit |
|---|---|---|
| `npm run lint` | `artifacts/server-stream-fixed-lint-20261016-125503.log` | 0 |
| `npm run typecheck` | `artifacts/server-stream-fixed-typecheck-20261016-125503.log` | 0 |
| `npm test` | `artifacts/server-stream-fixed-test-20261016-125503.log` | 0 — 24 files / 571 tests passed |
| `npm run build` | `artifacts/server-stream-fixed-build-20261016-125503.log` | 0 |

Not run (out of scope): deploy, real provider calls, APK/device, ledger booking,
staging/commit, Android/docs/spec edits, dependency installs.

## Files touched
- `packages/server/src/services/assistant-generation-runner.ts`
- `packages/server/src/services/assistant-types.ts`
- `packages/server/test/assistant-stream-routes.test.ts`
- `packages/server/test/assistant-contracts.test.ts`
- `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/research/backend-fix-review.md` (this file)

## Status: COMPLETE
