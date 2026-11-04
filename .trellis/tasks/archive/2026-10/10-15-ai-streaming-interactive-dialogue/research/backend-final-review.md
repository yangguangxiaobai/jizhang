# Backend final source review — AI streaming generation v1

Status: COMPLETE
Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Round scope (narrowed): read-only source review of
- `packages/server/src/services/assistant-generation-runner.ts`
- `packages/server/src/services/assistant-generation-service.ts`
- `packages/server/src/services/ai-provider-service.ts`
- `packages/server/src/routes/assistant.ts`

Focus: finalization transaction / cancel ownership / post-await fence / nested-provider deadline.
Explicitly out of scope this round: full quality commands (parallel test-runner owns them),
deploy, install, provider network calls, model/dependency changes, staging/commit.

Baseline: `research/check.jsonl` (specs + protocol-v1), `prd.md`, `design.md`, `implement.md`,
`research/protocol-v1.md`, `research/backend-handoff.md`.

Findings: pending.

---

## Method / evidence base

Read the current on-disk sources (files are present; the earlier aborted dispatch did write
them — `assistant-generation-runner.ts`, `assistant-generation-service.ts` and
`assistant-stream-*.ts` exist and are uncommitted):

- `src/services/assistant-generation-runner.ts` (889 lines)
- `src/services/assistant-generation-service.ts` (1254 lines)
- `src/services/ai-provider-service.ts` (787 lines)
- `src/routes/assistant.ts` (527 lines)
- supporting reads: `assistant-conversation-service.ts` (write lock, `appendMessage`,
  `createPendingAction`, `archive`), `assistant-tool-registry.ts` (`read`/`prepare` wiring),
  `ai-organization-service.ts` (`preview`/`explain`), `assistant-stream-types.ts`,
  `assistant-types.ts` (`normalizeAssistantProviderTurn`).
- existing tests: `test/assistant-stream-routes.test.ts`,
  `test/assistant-generation-persistence.test.ts`,
  `test/assistant-stream.test.ts` (read only; **not executed in this round**).
- frozen contract: `.trellis/spec/backend/assistant-streaming.md` §3 ("…nested provider
  tools get generation abort/deadline") and `research/protocol-v1.md` §"Runtime/persistence"
  ("…each provider at configured timeout…").

---

## F1 — BLOCKING (spec divergence, medium impact): nested-provider abort/deadline is not
## applied to an async write-tool `prepare`

`finishWriteTurn` runs an unbounded, un-cancellable await with the **unscoped** shared tool
context:

- `assistant-generation-runner.ts:842` — `const prepared = await this.registry.prepare(this.toolContext, toolName, args);`
  — `this.toolContext` is built once in the constructor from the default provider
  (`assistant-generation-runner.ts:235-243`), and there is **no** `AbortController`,
  **no** `setTimeout(deadline)`, **no** `setUpstreamCanceller`, and **no** deadline check
  after the await (the next line, `:843`, only re-checks liveness/archived).
- Contrast the read path, which does scope exactly this:
  `runStreamedStep:568-576` (`canceller` registered before the request) and
  `readTool:735-760` (`remaining = deadline - now()`, `setTimeout(controller.abort, remaining)`,
  `setUpstreamCanceller(generationId, …)`, `AbortSignal.any([...])`, `timeoutMs: Math.min(…, remaining)`).
- The one async, provider-backed prepare is real and reachable from this path:
  `assistant-tool-registry.ts:351` registers `organization.apply` as `access: 'write'` with
  `prepare: async (context, args) => { const preview = await context.services.organization.preview(); … }`
  (`assistant-tool-registry.ts:846-847`), and `AiOrganizationService.preview()` awaits
  `explain()` which calls `this.provider.complete(...)` with **no options**
  (`ai-organization-service.ts:914-917` and `:852`).

Consequences (reproducible):

1. **Stop does not abort the nested provider call.** `POST /generations/:id/cancel`
   (`assistant.ts:335-336`) persists `cancelled` first, then `await runner.cancel(...)`.
   `AssistantGenerationRunner.cancel` (`:278-287`) → `abortUpstream(generationId)`, but the
   only canceller registered at that moment is gone (nothing was registered for the
   write-prepare await), so the HTTP response is withheld until the nested provider call
   finishes on its own (`AiProviderService.callScope` timer, default 20 s / max 60 s).
   Same for `DELETE /conversations/:id`: `cancelForArchive` → `await runner.cancelConversation`
   (`assistant.ts:522-523`) blocks on the same await.
2. **The 180 s generation deadline is not enforced across that await.** The loop checks
   `this.now() >= deadline` only at step entry (`:368`) and after the provider turn (`:451`),
   never around `finishWriteTurn`. A tool-prepare that outlives the deadline still reaches
   `persistTurn` and commits a `completed` + `pending-confirmation` card.
3. Directly contradicts the frozen spec sentence the coordinator asked me to check:
   `.trellis/spec/backend/assistant-streaming.md:18` "nested provider tools get generation
   abort/deadline"; `research/protocol-v1.md:32` "each provider at configured timeout".

Repro (deterministic, no real network): in `test/assistant-stream-routes.test.ts` style, push
a streamed turn whose envelope carries
`{ toolCall: { name: 'organization.apply', arguments: { actionIds: [] } } }` and let the
second mock provider call (the nested one) be gated; issue `POST …/cancel` and assert the
response returns in < 1 s. Today it does not (contrast the existing read-tool test at
`test/assistant-stream-routes.test.ts:1139-1164`, which passes only because `monthly.evaluate`
goes through the scoped read path). Secondary assertion: with the deadline shortened, the
generation must not end `completed`.

Minimal fix direction (no refactor required): move the `remaining`/controller/scoped-provider
construction out of `readTool` into a helper and use the same scoped `AssistantToolContext`
in `finishWriteTurn` (i.e. build `scoped` the way `:755-760` does, and register the canceller
around `registry.prepare`). Alternative if the parent prefers to keep write-prepare
un-scoped by design: amend the spec line so "nested provider tools get abort/deadline" is
explicitly limited to read tools. Either way the current state (spec says one thing, code
does another) must not ship as-is.

## F2 — NON-BLOCKING (correctness, low-medium): buffered provider messages can be cut
## mid-surrogate-pair by a UTF-16 `String.slice`

The service already has the code-point-safe helper (`boundedDisplayText`,
`assistant-generation-service.ts:334-338`, "never inside a surrogate pair") but the runner
uses raw `String.slice`:

- `assistant-generation-runner.ts:728` (`readTool`), `:782` (`finishTextTurn`),
  `:847` (`finishWriteTurn`): `turn.message.slice(0, MAX_DISPLAY_CHARS_PER_TURN)`.

For the **streamed** path this is harmless: `AssistantMessageJsonTokenizer` bounds the decoded
message to `MAX_PROVIDER_MESSAGE_CHARS` UTF-16 units (`assistant-stream-tokenizer.ts:151`), so
a message reaching the runner is already ≤ 4000 units and the slice is the identity. For the
**buffered** path (`responses`/`custom`, `runLoop:432-436` → `normalizeAssistantProviderTurn`)
the provider string is arbitrary and `assistant-types.ts:526` slices it
(`.trim().slice(0, 4_000)`) with the same cut risk; the result is then persisted
(`persistTurn` → `message` event → `assistant_messages.content_json`).

Repro: buffered mode, envelope `{"message": "a".repeat(3999) + "😀", "toolCall": null,
"clarification": null}`. The persisted final text ends with a lone high surrogate. No crash
(JSON escapes it), but the final `message` event and the durable row carry a mangled glyph —
exactly the class of defect the spec calls out for deltas
(`.trellis/spec/backend/assistant-streaming.md:18` events contract) and that
`boundedDisplayText` was written to prevent. Tests only cover the delta path
(`test/assistant-stream-routes.test.ts:916-955`), so this is uncovered.

Minimal fix: use `takeUtf16Units` (already in the runner, `:151-160`) or export/reuse
`boundedDisplayText` for the three `turn.message` truncations, and make
`normalizeAssistantProviderTurn`'s 4000-unit bound surrogate-safe.

## F3 — VERIFIED CLEAN (no defect found) in the four focus areas

Recorded so the parent knows what was actually checked, not assumed:

1. **Finalization transaction** — single write path, atomic and fenced.
   `persistTurn` (`assistant-generation-service.ts:811-931`) wraps messages + pending action +
   awaiting-choice link + validated partial + terminal in one `db.transaction` under the
   re-entrant `ConversationWriteLock` (`assistant-conversation-service.ts:209-220`), returns
   `false` for an already-terminal row (`:817`), and `publish` runs only after commit
   (`:927-930`) so a rolled-back unit cannot emit a frame. `finalize()`
   (`:792-794`) delegates here, so there is one path. The "lost UPDATE" branch
   (`:900-912`, `status.changes === 0`) appends a terminal frame consistent with the current
   row instead of leaving a client without one. The self-declared invariant
   ("`parsePlannedTurn` re-reads the plan at the trust boundary") holds: the runner calls it
   with a plain object (`:813`), not structured-cloned.
2. **Cancel ownership** — correct order, correct scope, no cross-conversation effect.
   Route persists the ownership-checked/idempotent terminal status *before* aborting
   (`assistant.ts:335-336` with the explanatory comment at `:330-334`);
   `AssistantGenerationService.cancel` (`:950-961`) is idempotent and never rewrites a
   terminal row; `runner.cancel` (`:278-287`) + `abortUpstream` (`:1098-1102`) only touch the
   requested generation id, and the "no run registered" branch still aborts a stranded reader.
   Directly asserted by `test/assistant-stream-routes.test.ts:1068-1096` and
   `test/assistant-generation-persistence.test.ts:220-229`. (The F1 gap is the *unregistered*
   canceller during a write-prepare await, not an ownership bug.)
3. **Post-await fences** — present on every await except the one in F1.
   After the provider turn: `:445` (cancelled/live) and `:453` (live + not archived).
   After the read tool: `:763-764` returns `{dropped:true}`.
   After the write-tool prepare: `:843`. Inside the stream loop: `:635` and `:652`
   (flush timer). Enforced structurally by `persistTurn`'s terminal check (`:817`) and
   `isArchived` (`:307-314`). Archival is ordered fence → abort → drain → hide
   (`assistant.ts:516-526`), and `cancelForArchive` (`:963-975`) commits the terminal row
   first, so a late `persistTurn` is refused rather than racing; `recoverUnfinished()`
   (`:977-990`) is called before the routes are usable (`assistant.ts:266`) and is asserted
   not to call the provider (`test/assistant-stream-routes.test.ts:874-914`).
4. **Provider deadline / cleanup (stream + buffered primitive)** — sound.
   `AiProviderStream` arms one whole-body timer in the constructor (`ai-provider-service.ts:403-406`),
   clears it in `release()` (`:644-650`), races every `read()` against the abort promise
   (`:471`), enforces `[DONE]` + `finish_reason === 'stop'` + a complete envelope before
   success (`:624-642`), and rejects an unexpected `tool_calls`/reasoning field instead of
   dropping it (`:596-604`). `AiProviderService.complete` keeps its deadline armed through
   the body read and cleans up controller/reader in `finally` (`:698-735`); `openStream`
   requires `text/event-stream`, never falls back, and returns `null` for non-canonical paths
   (`:738-778`, `supportsAssistantStream:300-303`). The runner re-clamps the body deadline to
   `min(handle, 2×providerTimeoutMs, 180 s)` (`:703-712`) and aborts/disposes in `finally`
   (`:687-693`). Minor comment drift only: the doc-comment at `:702-706` describes the
   ceiling as `2 × providerTimeoutMs`, but the effective body budget is
   `openStream`'s `providerTimeoutMs − headerTime` (`:763`), i.e. always ≤ 1×. Harmless
   (tighter), worth a one-line comment fix.
5. Also checked and clean: `parseCreateGenerationRequest` strict unknown-field rejection
   (`:396-450`); replay-before-stale ordering (`:548-562` and
   `test/assistant-stream-routes.test.ts:665+`); replay-bounds reservation so a terminal can
   always be written (`appendEventWithin:1184-1198`); SSE pump de-dup, heartbeat, backpressure
   and single-registration socket listeners (`assistant.ts:63-151`); the
   `hasActive`/`legacyTurns` mutual-exclusion close-out (`assistant.ts:243-256`, `:294-301`,
   `:401-421`, and `test/assistant-stream-routes.test.ts:1123-1136`); and that a write-tool
   turn prepares a card without booking (`runner:850-884`,
   `test/assistant-stream-routes.test.ts:690-722`).
   No authentication bypass, CSRF gap, cross-conversation read/write, ledger write during
   generation/choice, replay/gap hole, or fake-streaming path was found.
   The legacy attachment path (`AssistantOrchestrator.handleMessage`,
   `assistant-orchestrator.ts:152-157`) does pass `tool`, `kind: progress`, `content.text` for
   user messages).

---

## Test gaps observed (assertions to add — test-runner/reviewer should own execution)

1. **No test covers a write tool whose `prepare` awaits a provider** (F1). The only async
   write prepare is `organization.apply` (`assistant-tool-registry.ts:846`) and no test
   exercises it through the generation runner; the nested-provider cancellation test covers
   only the read tool (`test/assistant-stream-routes.test.ts:1139-1164`).
2. **No deadline assertion at all** for a generation (grep for `deadline` in
   `test/assistant-stream*.test.ts` finds only a local wait loop at `:800`). The "stop
   while a write-prepare is gated" and "provider outlives the deadline → `failed`" cases are
   unasserted.
3. **No buffered-mode surrogate-boundary test** (F2). `test/assistant-stream-routes.test.ts:916-955`
   covers deltas only; the equivalent for the final `turn.message` (streamed *and* buffered)
   is missing, as is an assertion that no persisted `content.text` ends in a lone surrogate.
4. `test/assistant-generation-persistence.test.ts:169-216` exercises `persistTurn` with a
   pending action directly, but no test drives the same unit through `finishWriteTurn` with a
   **non-empty** `partial`, i.e. the "provisional bubble id is reused by the tool-card" claim
   (`runner:846`) is only covered for the text/read paths
   (`test/assistant-stream-routes.test.ts:1034-1066`).

---

## Scope discipline

- Product code was **not** modified this round; only this file was written.
- I did not run `npm run lint` / `npx vitest` / `tsc` / `npm run build` (owned by the parallel
  test-runner), did not call a real provider, did not deploy/install, did not stage/commit,
  and did not touch the test-runner's or documentation agent's files.
- No Trellis task was created for this review (the parent owns
  `10-15-ai-streaming-interactive-dialogue`; only `research/backend-final-review.md` was added).

## Verdict

One blocking spec divergence (F1: nested-provider abort/deadline missing on the async
write-tool `prepare` path, `runner:842`, spec line `assistant-streaming.md:18`), one
non-blocking correctness defect (F2: `String.slice` on `turn.message` can split a surrogate
pair for buffered providers), and no defect in the four areas' core invariants
(transactional finalization, cancel ownership, post-await fences on the covered paths,
provider/transport deadlines). Fixes are local; neither requires a redesign.
