# Tokenizer empty-array defect — reproduction, fix and regression

Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Owner: Pi native backend subagent (no nested agents).
Scope: `packages/server/src/services/assistant-stream-tokenizer.ts`,
`packages/server/test/assistant-stream.test.ts`, this file.
Frozen contract: `research/protocol-v1.md` §Provider,
`.trellis/spec/backend/assistant-streaming.md`.

Status: COMPLETE

## 1. Reproduction (step 1 — do not trust the prior-turn inference)

Executed a throwaway harness against the current tokenizer:
`packages/server/.tmp-repro/repro.ts` via `npx tsx .tmp-repro/repro.ts`
(run from `packages/server`, scratch dir removed afterwards).

Observed on the **pre-fix** source:

| Input (extra envelope members beyond `message`) | Expected | Observed |
|---|---|---|
| `{"message":"hi","a":[]}` | accept | **REJECT** |
| `{"message":"hi","a":{}}` | accept | accept |
| `{"message":"hi","a":[[],[[]],[1,2]]}` | accept | **REJECT** |
| `{"message":"hi","a":{"b":{},"c":{"d":[]}}}` | accept | **REJECT** |
| `{"message":[]}` | reject (message must be a string) | **REJECT** |
| `{"message":"hi","toolCall":[]}` | accept | **REJECT** |
| `{"message":"hi","a":[1],"b":2}` | accept | accept |
| `{"message":"中文😀","a":[{"b":"😀"}]}` (chunked) | accept | accept |
| `{"message":"①","a":[]}` (chunked) | accept | **REJECT** |

So the reported symptom is **real and reproduced**: any JSON **array** whose first
element position sees `]` fails, i.e. every empty array, and by extension every
container that nests one.

A second defect surfaced during the same pass, in the opposite direction:

| Input | Expected | Observed (pre-fix) |
|---|---|---|
| `{"message":"hi","a":1,}` | reject (trailing comma) | **ACCEPT** |
| `{"message":"hi","a":[1,]}` | reject | reject |
| `{"message":"hi"}` | accept | accept |

So the object `}` transition from the `key` state accepted a trailing comma that
the array branch already rejected — inconsistent, and the task explicitly says
trailing commas must not be accepted.

Correctly-rejected cases (pre-fix, must stay rejected): `[,1]`, `[1,,2]`, `[]` followed
by `,`, missing colon, unclosed bracket, trailing junk.

## 2. Root cause

`scanStructural` had no way to represent "the innermost container has not yet
received a value". `value` handled only value *starts*, so `]` fell through to
`throw`; the `key` state accepted `}` unconditionally, which is indistinguishable
from a comma-terminated member list.

Note this is exactly the path `assistant-tool-registry.ts` uses: `organization.apply`
exposes `actionIds` as `{type:'array'}` and `json({ actionIds })` can serialize
`[]`. A provider envelope carrying `"toolCall":{"name":"organization.apply",
"arguments":{"actionIds":[]}}` was therefore unparseable — the whole generation
failed instead of producing the tool card. That is why the earlier F1/F2 route tests
reach the nested provider by selecting a ready action id rather than sending
`actionIds: []`.

## 3. Fix

`assistant-stream-tokenizer.ts`:
- `Frame` now carries `sawValue: boolean` for both object and array frames.
- `markValue()` sets it on the innermost frame; `completeValue()` calls it (so any
  completed value marks its container) and then moves to `comma`/`trailing`.
- New `closeEmptyContainer()` pops a container that received no value, marks the
  **parent** instead (the empty container *is* a value for the parent), and moves the
  state — this is what distinguishes `[]` from `[],`.
- New `closeContainer()` for the normal `comma`-state close.
- `scanStructural`:
  - `value` state now accepts `]` only when the current frame is an array with
    `sawValue === false` (empty array). `]` after a comma (`[1,]`) or a stray `]`
    still throws.
  - `key` state now accepts `}` only when the current object frame has
    `sawValue === false` (empty object); otherwise it is a trailing comma and throws.
- No public API, DTO, event, bound, route or provider-transport change. Depth,
  duplicate-key, escape, surrogate, size and strictness behaviour are untouched.

## 4. Regression tests (`test/assistant-stream.test.ts`)

9 new cases in a dedicated `describe('tokenizer empty containers and trailing commas')`
block:

- accepts `[]`, `{}`, nested empty/non-empty arrays and objects while decoding the
  message value.
- accepts `[]` and `{}` **split across arbitrary chunk boundaries** (empty container
  where `[` and `]` land in different chunks).
- keeps the surrogate-pair guarantee with an empty array in the same envelope:
  `{"message":"😀中文","toolCall":{"name":"organization.apply","arguments":{"actionIds":[]}}}`
  pushed character-by-character decodes exactly `😀中文`; the escaped form
  `"\uD83D\uDE00..."` decodes the same.
- rejects trailing commas in arrays **and** objects, bare leading comma, double comma,
  `[]` followed by a comma, and an empty-container-then-junk tail.
- rejects an empty *object member list* reached only by comma (`{"a":1,}`) while still
  accepting genuine `{}`.

All new cases fail against the pre-fix tokenizer (verified by reverting the single
file) and pass after the fix.

## 5. Quality gate

Run from `packages/server`; logs under `artifacts/` (repo root).

| Command | Log | Exit | Result |
|---|---|---|---|
| `npm run lint` | `artifacts/server-tokenizer-fix-lint-20261016-131148.log` | 0 | no warnings |
| `npm run typecheck` | `artifacts/server-tokenizer-fix-typecheck-20261016-131148.log` | 0 | clean |
| `npm test` | `artifacts/server-tokenizer-fix-test-20261016-131148.log` | 0 | 24 files / **580 tests passed** (pre-fix 571 → +9 new) |
| `npm run build` | `artifacts/server-tokenizer-fix-build-20261016-131148.log` | 0 | clean |

### Differential harness (time-boxed)
Generated **2,596,744** raw strings (all strings over `{}[],:"1a ` up to length 7, plus 200k
seeded random length-8..39 strings over a broader alphabet), and compared
tokenizer accept/reject against `JSON.parse` + object-with-string-`message`:

```
checked=2596744 mismatches=0
```

No over-rejection and no over-acceptance among structurally reachable inputs. The only
intentional divergence from a plain JSON parser is the documented contract strictness:
duplicate keys, depth > 32, lone surrogates, and control characters inside strings are
rejected even though they are (or can be) parseable JSON.

Not run (out of scope): deploy, real provider calls, APK/device, ledger booking,
staging/commit, Android/docs/spec edits, dependency installs.

## 6. Files touched
- `packages/server/src/services/assistant-stream-tokenizer.ts`
- `packages/server/test/assistant-stream.test.ts`
- `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/research/tokenizer-final-review.md` (this file)

## Status: COMPLETE
