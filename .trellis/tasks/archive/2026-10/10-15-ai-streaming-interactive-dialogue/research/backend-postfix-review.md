# Backend post-fix independent review (F1/F2 + tokenizer)

Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Owner: Pi native backend review subagent (no nested agents).
Scope: independent, read-only verification of the F1/F2 fixes
(`research/backend-fix-review.md`) and the tokenizer empty-container/trailing-comma fix
(`research/tokenizer-final-review.md`) against the on-disk sources.
Inputs read: `check.jsonl`, `prd.md`, `design.md`, `implement.md`,
`research/protocol-v1.md`, `research/backend-fix-review.md`,
`research/tokenizer-final-review.md`, `research/backend-final-review.md`,
`.trellis/spec/backend/assistant-streaming.md`.
Code read: `packages/server/src/services/assistant-generation-runner.ts`,
`assistant-types.ts`, `assistant-stream-tokenizer.ts`,
`assistant-tool-registry.ts` (note handling), `ai-provider-service.ts` (abort/timeout
plumbing), `ai-organization-service.ts` (nested provider call site), plus the new
regression tests.
Only writable artifact: this file. No product/test edits, no deploy/install, no
staging/commit, no provider/device accounting, no model/dependency changes.

Status: RUNNING → COMPLETE (see Verdict; created RUNNING first, then filled with findings).

---

## 1. Method (what was actually executed, not inferred)

- Read the three focus sources and the surrounding call sites in full.
- Read the new regression tests and confirmed they correspond to the fix log claims.
- **Independently ran** the three assistant test files (they were reported green by the
  fix authors; I re-ran them myself):
  - `npx vitest run test/assistant-stream.test.ts test/assistant-contracts.test.ts`
    → 2 files, **45 passed** (32 + 13).
  - `npx vitest run test/assistant-stream-routes.test.ts`
    → 1 file, **34 passed** (includes the two new nested-write-prepare tests).
- **Independent probe** of the nested-provider abort path with a throwaway harness
  (`tsx`, deleted afterwards; no repo file left behind):
  a `fetch` that never settles, `new AiProviderService(stuckFetch)`, then
  `complete(stored, null, context, { signal })` and `signal.abort()`.
  Observed: `rejected:AiProviderTimeoutError in 1 ms`; the same call **without** a signal
  stayed pending past 1500 ms. This confirms the scoped provider's signal composition
  plus `AiProviderService.callScope`'s abort race really cuts a nested request on Stop.
- **Independent tokenizer harness** (my own cases, not the committed test; file removed):
  accepts `{"a":[]}`, `{"a":{}}`, `{"a":[[],[[]],[1,2]]}`,
  `{"a":{"b":{},"c":{"d":[]}}}`, `{"a":[],"b":1}`,
  `{"toolCall":{"name":"organization.apply","arguments":{"actionIds":[]}}}`,
  `{"a":{} }`, `{"a": [] ,"b":2}`, `{"a":[[],{}],"toolCall":null,"clarification":null}`;
  rejects `{"a":1,}`, `{"a":[1,]}`, `{"a":[],}`, `{"a":[,1]}`, `{"a":[1,,2]}`,
  `{"a":{}} extra`, `{"message":[],"a":1}`, `{"a":1 "b":2}`, duplicate `message`,
  `{"a":[[]`, `{"a":{`. Each run whole-buffer **and** split at 1/2/3/100 chars.
  Result: **failures=0**.
- **Not re-run** (per instruction / owned elsewhere): full `npm test` (580), `lint`,
  `typecheck`, `build`, Android 87. The `artifacts/server-tokenizer-fix-*-20261016-131148.log`
  files were read and are consistent with the reported 24 files / 580 tests, lint clean,
  build clean.

---

## 2. F1 — nested write-tool `prepare` abort/deadline → RESOLVED

### Code verified
`assistant-generation-runner.ts`:
- `finishWriteTurn` (≈L865–932) now takes `deadline`, builds a per-call context via
  `openToolScope(generationId, deadline)`, and awaits
  `Promise.race([registry.prepare(scope.context, …), scope.aborted])` inside
  `try { … } finally { scope.dispose() }`.
- Post-await fences run **before** any persistence:
  `if (!isLive(...) || isArchived(...)) return;` then
  `if (this.now() >= deadline) return this.failDeadline(...);` then the atomic
  `persistTurn` (pending action + tool-card + `completed`/`pending-confirmation`) — which is
  synchronous (better-sqlite3), so nothing can interleave between the fence and the commit.
- `openToolScope` (≈L760–805) composes the caller signal with a private controller
  (`AbortSignal.any`), freezes `remainingMs = max(1, deadline - now())`, caps the nested
  provider `timeoutMs` at that remaining budget, arms a deadline timer, and registers itself
  through `generations.setUpstreamCanceller`; `dispose()` clears the timer, removes the
  listener, aborts the controller and clears the canceller.
- `readTool` (≈L720–746) uses the same helper and keeps its post-await fence.
- `cancel`/`cancelConversation`/`shutdown` set `run.cancelled`, call
  `generations.abortUpstream(generationId)` and await the loop promise; `abortUpstream`
  invokes the currently-registered canceller (the scope's `controller.abort()`).
- `direct complete() (no signal)` → `STILL_PENDING_after_1500ms`; the scoped (signal-carrying)
  call → `rejected:AiProviderTimeoutError in 1 ms`. So the nested `organization.apply →
  organization.preview → explain → provider.complete()` call — which passes **no** options of
  its own (`ai-organization-service.ts:852`) — is still cut when the scope's signal aborts,
  via `AiProviderService.callScope`'s `Promise.race` around the fetch/body read.

### Tests verified
- "stops while organization.apply waits for its nested provider": asserts
  `POST …/cancel` returns 200 in < 1 s, status `cancelled`, no late card, no pending action,
  ledger count unchanged. **Passes on current code.**
- "fails the generation when a nested provider prepare outlives the deadline": jumps
  `currentNow` past 180 s while the nested request is gated, asserts terminal `failed`,
  `outcome: null`, no card, no pending action. **Passes on current code.**
- The wall clock is injectable (`currentNow`) and the boot-recovery test keeps a stable `NOW`
  constant, so the two new tests do not destabilise the existing recovery test.

### Residual (non-blocking, explicitly listed — not a pass claim)
- **Timer-range nit.** `openToolScope` calls `setTimeout(…, remainingMs)` with
  `remainingMs = max(1, deadline - now())` and no clamp to Node's max timer delay
  (`2 147 483 647` ms ≈ 24.8 days); above that, `setTimeout` fires almost immediately and
  the scope's `aborted` promise would reject early. With the current
  `MAX_GENERATION_DEADLINE_MS = 180_000` this can never trigger, so it is a defensive
  hardening item, not a defect in this task. If a future change raises the deadline
  unbounded, `const remainingMs = Math.min(max(1, deadline - now()), 2 ** 31 - 1)` should be
  added.
- The `aborted` promise only rejects on controller abort (the timer); it has no
  time-based rejection of its own, so a transport that ignores the abort signal *and* whose
  fetch never settles would still hold the scope await. In production the nested request is a
  real `fetch` to a URL with `redirect: 'error'` and a JSON body, which settles quickly, and
  the independent probe shows the abort path works for settling transports; recording it only
  so it is not mistaken for an unexamined gap.

---

## 3. F2 — surrogate-safe truncation → RESOLVED

### Code verified
`assistant-types.ts`:
- `boundedProviderMessage(text, maxUnits)` (≈L536) backs off one unit when the last kept
  unit is a high surrogate (`0xD800–0xDBFF`), so a pair is dropped whole, never split.
- `normalizeAssistantProviderTurn` bounds the trimmed provider message with
  `boundedProviderMessage(…, MAX_PROVIDER_MESSAGE_UNITS)` (≈L552) instead of `.slice(0, 4_000)`.
- `normalizeAssistantJson`'s string branch (L315) uses the same helper for every bounded
  assistant string, so tool preview/card text can no longer carry a half surrogate either.
  `MAX_STRING_LENGTH` remains a plain unit budget; characters are dropped, never split.

### Tests verified
- `test/assistant-contracts.test.ts` "bounds a buffered provider message without cutting a
  surrogate pair": `'a'.repeat(3999) + 😀` → length exactly 3999, no trailing high surrogate;
  a message that fits keeps the emoji (`length === 102`). **Passes.**
- `test/assistant-stream-routes.test.ts` `buffered provider Unicode boundary`: responses-mode
  buffered turn `'字'.repeat(3999) + '😀'` → terminal `completed`, persisted `content.text`
  length 3999 with **no surrogate code units at all**, durable row equals the snapshot.
  **Passes.**

### Unicode boundary — full sweep of the touched surface
| Path | Bound | Split-safe? | Evidence |
|---|---|---|---|
| streamed deltas | per-turn 4000 UTF-16 units, total 12000 | yes — `takeUtf16Units` backs off before a lead surrogate; tokenizer `emitUnit` already guarantees complete pairs | code + emoji budget test (offsets contiguous, `expectedOffset === answer.length`) |
| tokenizer decoded message | `MAX_PROVIDER_MESSAGE_CHARS` 4000 | yes — `pendingHigh` pairs before `appendDecoded`; lone surrogate rejected | `never splits a surrogate pair, even across chunks`, `rejects a lone surrogate` |
| buffered provider message | 4000 units | yes — `boundedProviderMessage` | both tests above |
| bounded assistant JSON strings (cards/previews) | 4000 units | yes — same helper at L315 | code read |
| transfer.create / salary.create / transaction.update `note` | 200 units | **no** — raw `record['note'].slice(0, 200)` (registry L568, L625, L652) | see §4 residual |
| import preview note / counterparty / ignoreReason / duplicateOfNote | 160/120/80 units | **no** — raw `String.slice` (registry ≈L309–321) | see §4 residual |

No unresolved Unicode-boundary defect on the message/delta/tokenizer surface that F2
targeted.

---

## 4. `notes` exact-string retention — clarified, no such field; `note` behavior checked

There is **no literal `notes` field** anywhere in this streaming backend: `grep` finds
`notes` only in `task.json` (Trellis metadata) and in spec prose about *not* sending notes to
the provider. `research/protocol-v1.md` defines no `notes` member, and the runner/registry
never reference it. The domain field is `note` (singular) plus `noteOverrides` for imports.
So the review question is interpreted and answered as "is the retained note/string preserved
exactly (no lossy re-encoding) and bounded safely".

Verified:
- **Provider message**: trimmed, then bounded at 4000 units; content inside that bound is
  preserved exactly (same units, same order), and the bound never splits a pair.
- **`transaction.create` note**: `trim().slice(0, 200)` (registry L255) — surrounding
  whitespace dropped, content preserved; no mutation of retained characters.
- **`transaction.update` / `transfer.create` / `salary.create` note**: `slice(0, 200)`
  without trim (L568, L625, L652) — content preserved.
- **`noteOverrides`** (import): each value is carried verbatim up to 200 units
  (registry L292–294); the importer preserves explicit empty-string clearing, per the
  existing import contract.
- **Streamed text→message handoff**: a validated turn reuses the provisional bubble's
  `messageId`, and the tool-card path persists the same id, so no duplicate/parallel copy of
  the string is created.

Residual (non-blocking, explicitly **out of F2 scope**, listed so it is not read as a pass):
- The 200-unit note truncations and the 160/120/80-unit import-preview projections still use
  raw `String.slice`, so a note whose 200th (or 160th/120th/80th) UTF-16 unit is a high
  surrogate would persist a lone surrogate through the *write* path. This is a pre-existing
  pattern, was not introduced by F1/F2, and was not in the fixed scope (F2 covered
  `turn.message`). Recommendation for a future task: route these through a shared
  surrogate-safe truncation helper (e.g. reuse/export `takeUtf16Units` /
  `boundedProviderMessage`), and add a write-path regression. Severity: low (requires a
  crafted astral character at exactly the cut offset; no crash, the JSON escapes it, the
  client renders `�`).

---

## 5. JSON empty containers / trailing comma → RESOLVED

### Code verified (`assistant-stream-tokenizer.ts`)
- `Frame` carries `sawValue` for both object and array frames.
- `value` state accepts `]` **only** when the current frame is an array with
  `sawValue === false`; `key` state accepts `}` **only** for an object with
  `sawValue === false`. Both call `closeEmptyContainer()`, which pops the container, marks the
  **parent** (`markValue()`), and moves to `comma`/`trailing` — the empty container counts as
  a value of its parent, which is what makes `{"a":[]}` accepted and `{"a":[],}` rejected.
- `comma`-state `}`/`]` still go through `closeContainer()`; `rejectEmptyArrayElement()`
  still rejects `[,`/`[1,,2]`; `trailing` still rejects any non-whitespace tail; `finish()`
  still requires an empty frame stack, `state === 'trailing'`, `sawMessageKey`, and
  `messageWasString`.
- No public API, DTO, event, bound, route or provider-transport change.

### Evidence
- My independent harness: **failures=0** across the accept/reject set (whole-buffer and
  4 chunk sizes, including 1 char at a time), covering chunk-split empty containers
  (`[` and `]` landing in different chunks), nested empties, `{"a":[],"b":1}`, and the exact
  `organization.apply`/`actionIds:[]` envelope that previously failed the whole generation.
- Committed suite `test/assistant-stream.test.ts` → **32 passed**, including
  `accepts an empty array for the organization.apply actionIds argument`,
  `keeps the surrogate guarantee while an empty array is present`,
  `still rejects a trailing comma in an array and in an object`,
  `rejects empty array element positions produced by commas`.
- `tokenizer-final-review.md`'s differential oracle (2 596 744 inputs vs `JSON.parse`,
  zero mismatches) is consistent with the state machine I read; I did not re-run it.

### Observation (non-blocking, comment-wording only)
`closeEmptyContainer`'s doc-comment says "the empty-container transition below does *not*
mark a value" and that this "keeps `[],` illegal", but the code *does* call `markValue()`
(correct — the empty container is a value of its parent). The `[],` rejection actually comes
from the `comma` state's own branch (a `,` is not `}`/`]`), not from the absence of a mark.
Behaviour is correct; only the comment's wording inverts the mechanism. Cosmetic fix later.

---

## 6. Regression tests — present and green

| Suite | Result (this round, re-run) |
|---|---|
| `test/assistant-stream.test.ts` (tokenizer empty containers/trailing commas) | 32 passed |
| `test/assistant-contracts.test.ts` (surrogate boundary + clarification contracts) | 13 passed |
| `test/assistant-stream-routes.test.ts` (F1 cancel/deadline, buffered Unicode, lifecycle, choice, archival, dedup, legacy exclusion) | 34 passed |

The nested-write-prepare tests live in a dedicated
`describe('nested provider cancellation and deadline for a write-tool prepare')` block and
the buffered surrogate test in `describe('buffered provider Unicode boundary')`; both match
the fix log. The fix authors' claim that each fails against pre-fix code was not re-verified
by me (reverting the source is a product edit, out of this review's write scope); I verified
they pass on the current code and that the code contains the mechanism they assert.

---

## 7. Gate / scope statement

- Did not re-run the full 580-test gate, lint, typecheck, build, or the Android 87 tests —
  per instruction and because a parallel owner already ran them; I read
  `artifacts/server-tokenizer-fix-*.log` (580 passed / 24 files, lint clean, tsc clean).
- What I *did* execute: the three assistant suites (79 tests), the nested-abort probe, and
  the independent tokenizer harness. All green/failures=0.
- Did not edit product or test files; no install, deploy, provider/device accounting,
  staging or commit; no dependency or model/credential changes; no history re-doing.

---

## 8. Verdict

**COMPLETE — F1, F2 and the tokenizer empty-container/trailing-comma defects are all
resolved on disk and independently confirmed** by code reading, targeted execution, an
independent abort probe and an independent tokenizer harness.

Explicitly unresolved / not passed (all non-blocking, none a regression of this task):

1. `openToolScope` does not clamp its deadline timer to Node's max delay (unreachable while
   the 180 s deadline stands) — hardening item.
2. Note/preview string truncations in `assistant-tool-registry.ts` (200/160/120/80 units)
   are not surrogate-safe; out of F2's fixed scope, pre-existing, low severity; recommend a
   follow-up shared truncation helper + write-path regression.
3. `closeEmptyContainer`'s comment wording inverts the mechanism it describes; behaviour
   correct.
4. F1's pre-fix failure demonstration (test failing before the fix) was not re-verified
   because reverting source is outside this review's write scope.
5. Full 580-test gate / Android 87 / lint / typecheck / build were not re-run this round;
   their artifact logs were read, not regenerated.
