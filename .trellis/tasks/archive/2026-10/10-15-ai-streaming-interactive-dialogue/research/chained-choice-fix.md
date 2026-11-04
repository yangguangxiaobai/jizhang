# Chained clarification fix (task 10-15) — server bug only

Status: **FIXED + VERIFIED locally (unit/integration). Not deployed, not device-verified.**
Scope: the single confirmed defect from `research/live-stream-diagnosis.md` §3. No other change.
Evidence: `artifacts/chained-choice-{diff.patch,diagnosis-before.log,focused-tests.log,full-test.log}`.

## 1. Defect

`packages/server/src/services/assistant-generation-service.ts`, `create()`:
the `INSERT INTO assistant_generations` bound `source.optionId` / `source.answeredAt` (the answer
that was just consumed on the **source** row) into the **new** generation's own
`answered_option_id` / `answered_at`. Those two columns mean "*this* generation's question has
been answered", and `resolveInput()` rejects any source with `answered_at !== null`
(`ASSISTANT_CHOICE_STALE` /「该追问已被回答。」).

Consequence: a generation that consumes a choice and then asks its *own* question is born
already-answered, so its question can never be answered. The first hop works; **every second
hop is permanently stuck**. This is exactly the device symptom (generation `863a936c` present the
4-option account question with `answered_at == createdAt`; both the option click and the free-text
attempt were rejected). The plain-text supersede UPDATE only touches `answered_at IS NULL` rows,
so the stuck row was not even invalidated.

## 2. Fix (minimal)

In `create()` the new row's own answer columns are now literal `NULL`:

```sql
source_generation_id, question_id, question_json, answered_option_id, answered_at, ...
VALUES (?, ?, ?, ..., ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
```

- The **consumed answer is still written to the source row** by the unchanged
  `UPDATE ... SET answered_at = ?, answered_option_id = ? WHERE id = ? AND answered_at IS NULL`.
- **Provenance is preserved** in `source_generation_id`, `question_id` / `question_json` and
  `input_json` (the client input is stored verbatim). The stale guard
  (`source.answered_at !== null`) and the supersede UPDATE are untouched.
- Dead fields removed from `resolveInput()`'s return value (`answeredAt`, and `optionId` is now
  used only by the source UPDATE) — no behavioural effect.
- Untouched by design: migrations, routes, the 4000-char bounds contract, provider/model/timeout
  configuration, legacy endpoints.

## 3. Tests added

`packages/server/test/assistant-stream-routes.test.ts` → new `describe('chained clarification choices')`
plus helpers `clarificationOf` / `answerState` / `storedInput`:

- **option path** `text → question A → choice → question B → choice`: asserts A's own question is
  unanswered before it is answered, A carries the consumed option id + timestamp afterwards, B
  stays `{answeredOptionId: null, answeredAt: null}` and `input_json` still names source A /
  question A / option A, the second answer reaches `outcome=answer` with the option label as the
  user message, and both A and B reject a replayed click with `ASSISTANT_CHOICE_STALE`.
- **free-text path** `… → choice → question B → choice-text` (the exact device scenario): the
  2000-char-bounded text becomes the user message, B records consumption with
  `answeredOptionId = null`, the identical request replays as `200 {created:false}` with the same
  generation and **no extra provider call and no extra ledger row**.
- Both tests assert `COUNT(*) FROM transactions` is unchanged across the whole flow.

## 4. Verification (exact commands)

| Command | Result |
|---|---|
| `npx vitest run test/zz-diagnosis-chained-choice.test.ts` (temporary repro, now deleted) | pre-fix: `hop2 option click = 409`, `hop2 free text = 409`; post-fix: option click `202`, free text `409` only because the option click had just consumed it |
| Temporary revert of the fix, `npx vitest run test/assistant-stream-routes.test.ts -t "chained clarification"` | 2 failed (proves the new tests catch the bug); fix restored byte-identical |
| `npx vitest run test/assistant-stream-routes.test.ts` | 36 passed |
| `npx vitest run test/assistant-generation-persistence.test.ts test/assistant-stream.test.ts test/assistant-contracts.test.ts test/assistant.test.ts` | 74 passed |
| `npm run lint` | clean, `--max-warnings 0` |
| `npm run typecheck` | clean |
| `npm test` (full suite) | 24 files / 582 tests passed, exit 0 |
| `npm run build` | clean, `BUILD_EXIT=0` |

## 5. Not run / not claimed

- **Not deployed.** No production host, container, database, migration or phone touched; no
  real provider call; no `/confirm` or any financial write. The fixed code is local only.
- **No device verification** — the account question cannot be retested until the parent decides to
  deploy (the running image is still the pre-fix build).
- `npm run build` was re-run with its exit code captured: `BUILD_EXIT=0`.
- Deployment state of running generation `863a936c` (live DB, `answered_at` set) is **not**
  repaired by this code change: its question is still stuck. A plain-text message in that
  conversation is unaffected, but the account question needs a fresh generation after deploy.
