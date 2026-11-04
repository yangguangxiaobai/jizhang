# Live stream diagnosis — real-device rejection (task 10-15)

Status: **COMPLETE — file-backed diagnosis, read-only production inspection**
Author: backend investigation agent (parallel to the Android track)
Window inspected (device test): `2026-10-16T06:38:49Z` … `2026-10-16T06:44:49Z`
Generated: `2026-10-16T07:0xZ`
Scope: read-only. **No deployment, restart, model/secret/timeout change, no `/confirm`, no financial write, no new generation created.**

## 1. Authorization envelope actually exercised

| Allowed | Used |
|---|---|
| Read-only SSH with existing key `~/.ssh/jizhang_deploy` (`ubuntu@jz.yansuu1.xyz`) | yes |
| `sudo -n` read / `docker inspect` / `docker exec` (read-only) | yes |
| Read-only SQLite (`{ readonly: true, fileMustExist: true }`) | yes, `better-sqlite3` inside the running image |
| Write only `research/live-stream-diagnosis.md` + `artifacts/live-stream-diagnosis-*` | yes |

Prohibited and **not** done: deploy, restart, rebuild, config edit, model/secret/default-timeout change, DB restore, ledger write, `git stage`/`commit`, nested sub-agents, provider calls, `confirm`/financial endpoints.
Privacy: no session id, no cookie, no credential/secret value, no raw provider payload, no private financial rows and no full-DB dump were emitted. Only lengths, offsets, counts, digests and redacted 8-char id prefixes.

### Artifacts produced (machine evidence)
- `artifacts/live-stream-diagnosis-schema.json` — live table/column/migration probe
- `artifacts/live-stream-diagnosis-readonly.json` — generation/event/message metadata for the two test conversations (text never printed)
- `artifacts/live-stream-diagnosis-ledger-compare.json` — live-vs-deployed manifest comparison (hashes/counts only)
- `artifacts/live-stream-diagnosis-deploy-{before,after}-manifest.json`, `…-deploy-verification.json`, `…-deploy-{before,after}-env.json` — copies of the server's recorded deployment manifests
- `artifacts/live-stream-diagnosis-probe-schema.mjs`, `…-probe-readonly.mjs`, `…-ledger-compare.mjs` — the read-only probes (re-runnable)

## 2. The two test conversations (IDs redacted to 8-char prefixes)

| Conversation | First marker message | Generations | Window (UTC) |
|---|---|---|---|
| `db4b1b34` | `UI TEST: please list 3 budgeting tips` | 3 | 06:38:49.045 → 06:40:17.011 |
| `07e609d8` | 500-word essay prompt | 3 | 06:42:50.952 → 06:44:29.684 |

Marker strings used for identification: `budgeting`, `This is only a test`. No other conversation created generations in this window (only two conversations appear in `assistant_generations`).

### 2.1 `db4b1b34` — the screens 03/04/05 flow (also 06–13)

| Gen (prefix) | input | status | delivery | outcome | createdAt → updatedAt | events (seq spans) | first/last delta vs terminal | Δchars |
|---|---|---|---|---|---|---|---|---|
| `f82dd60e` | text 37 | completed | stream | answer | 06:38:49.045 → 06:38:54.498 | state×2 (1,2), text-delta×10 (3–12), message (13), terminal (14) | first **−1094 ms**, last **−340 ms** | 197 |
| `f37bc0a1` | text 116 | completed | stream | awaiting-choice (2 opt) | 06:39:37.199 → 06:39:43.251 | state×2, text-delta×3 (3=off 0/34ch, 4=off 34/35ch, 5=off 69/1ch), message (6), terminal (7) | first **−610 ms**, last **−558 ms** | 70 |
| `863a936c` | **choice** | completed | stream | awaiting-choice (4 opt) | 06:40:00.349 → 06:40:17.011 | state×2, text-delta×2 (3=off 0/34ch, 4=off 34/20ch), message (5), terminal (6) | first **−796 ms**, last **−744 ms** | 54 |

`f82dd60e` offset continuity: `0, 6, 32, 52, 67, 94, 110, 116, 157, 196 → 197` with delta lengths `6, 26, 20, 15, 27, 16, 6, 41, 39, 1`. **No gap, no overlap, no after-terminal delta.** The 10 deltas span `06:38:53.404 → 06:38:54.158` (754 ms) and the first delta lands **4.36 s after creation**.

Screenshot mapping (`artifacts/device-streaming-evidence/*.png` file mtimes, UTC):

| Screen | capture time | generation-relative | content |
|---|---|---|---|
| `screen-03` | 06:38:48.93 | ~0 s (at send) | user bubble, badge `● 实时流式响应`, no assistant text |
| `screen-04` | 06:38:51.41 | **+2.4 s** | still no assistant text |
| `screen-05` | 06:38:55.89 | **+7.0 s** | full answer + `✓ 回答已结束 · 本轮未执行记账` |

The first assistant delta existed on the server at **+4.36 s** and was already complete at **+5.45 s**. Both "no body" screenshots were taken **before** the first delta; the "complete" screenshot was taken after the terminal. The observable "screen03/04 empty → screen05 full" is a **sampling artifact of a short answer with a ~4.4 s time-to-first-token**, not evidence that deltas were lost.

### 2.2 `07e609d8` — the long-answer flow (screens 17/18)

| Gen | input | status | outcome / error | createdAt → updatedAt | events | first/last delta vs terminal | Δchars |
|---|---|---|---|---|---|---|---|
| `4b0b2c99` | text 92 | completed | answer | 06:42:50.952 → 06:43:06.104 | state×2, text-delta×118, message, terminal (122) | first **−10701 ms**, last **−436 ms** | 3228 |
| `ed63eb1c` | text 45 | **failed** | `ASSISTANT_STREAM_BOUNDS` | 06:43:38.779 → 06:43:54.510 | state×2, text-delta×143, terminal (146), **no message** | first **−12370 ms**, last **−82 ms** | 3989 |
| `106f37ee` | text 60 | completed | answer | 06:44:16.849 → 06:44:29.684 | state×2, text-delta×109, message, terminal (113) | first **−10017 ms**, last **−175 ms** | 3048 |

`screen-17` (06:42:51.31) is `4b0b2c99` at **+0.36 s** — again before the first delta (+4.45 s). Same sampling artifact.

**Additional real defect found in this flow:** `ed63eb1c` failed with `ASSISTANT_STREAM_BOUNDS` while 3989 display chars had already streamed. The tokenizer ceiling `MAX_PROVIDER_MESSAGE_CHARS = 4000` (`packages/server/src/services/assistant-stream-tokenizer.ts` `appendDecoded`, line 149–153) rejects an over-long provider message even though the per-turn display budget is also 4000 (`MAX_DISPLAY_CHARS_PER_TURN`, `assistant-generation-runner.ts` line 423–425). A >4000-char answer therefore terminates the whole generation as `failed` instead of being visibly truncated, and `finalizeFailed` (runner line 325–332) does not clear the provisional snapshot. Not the reported symptom, but it is a genuine bounds/UX interaction and is recorded here rather than changed.

## 3. Root cause of `ASSISTANT_CHOICE_STALE` on free text — **confirmed server bug**

### 3.1 What the device did
`screen-13` shows the notice `发送结果尚未核对：该追问已被回答。。请先刷新本对话，避免重复发送。` **while the user is typing** `This is only a test, do not book any expense` (the account question is still displayed). That literal double-`。` is produced by the Android notice template `"发送结果尚未核对：${e.message}。请先刷新本对话，避免重复发送。"` (`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`) applied to the server message `该追问已被回答。`. So the client did send a `choice-text` request whose `sourceGenerationId` was `863a936c` and the server answered **409 `ASSISTANT_CHOICE_STALE` /「该追问已被回答。」**.

### 3.2 The failing state in the database
`863a936c` is the generation that **presents the 4-option account question** (`outcome = awaiting-choice`, 4 options). Its row however already carries the source's answer fields:

```
863a936c: outcome=awaiting-choice, sourceGenerationId=f37bc0a1,
          answered_option_id=e09ad998  (non-null)
          answered_at=1792132800349    (non-null, == its own createdAt exactly)
          question_json set, messageIds=1
```

`answered_at == createdAt` to the millisecond is the signature of the INSERT copying the source's answer into the new row.

### 3.3 The code path
`packages/server/src/services/assistant-generation-service.ts`, `create()`:

- INSERT column list + binds (lines **601–626**):
  ```
  source_generation_id, question_id, question_json, answered_option_id, answered_at
  ...
  source.sourceGenerationId, source.questionId, source.questionJson, source.optionId, source.answeredAt
  ```
  `source.optionId`/`source.answeredAt` are produced by `resolveInput()` for the **source** question (lines 688, 698). They are stored into the **new generation's own** `answered_option_id`/`answered_at`, which are the columns that mean "*this* generation's question has been answered".
- Choice consumption guard (lines **664–667**), executed when this generation is later used as a source:
  ```ts
  if (source.answered_at !== null) {
    throw new AssistantStreamError('ASSISTANT_CHOICE_STALE', '该追问已被回答。');
  }
  ```
  Because `863a936c.answered_at` was pre-populated at insert time, **its own question can never be answered** — every `choice` *and* `choice-text` with `sourceGenerationId=863a936c` is rejected with 「该追问已被回答。」.

Consequences:
- The free-text attempt in the device test returned `ASSISTANT_CHOICE_STALE` (matches the observed notice).
- Clicking one of the four account options would fail identically — the account question is **permanently stuck**, not merely "stale after supersede".
- The supersede UPDATE (lines 578–590) only touches rows with `answered_at IS NULL`, so this generation is not even marked/invalidated by a later plain-text message.
- Provenance survives in `input_json` (`{type:'choice',sourceGenerationId,questionId,optionId}`), so dropping the copy does not lose information.

`f37bc0a1` (the Dining question) was consumed correctly because its `answered_at` was still NULL: `answered_at = 1792132800349` equals the creating time of `863a936c`. The first hop works; **every second hop is broken**.

### 3.4 Why no test caught it
`packages/server/test/assistant-stream-routes.test.ts` covers a *single* choice hop (`accepts a single-select answer …`, `accepts a free-text answer …`) and plain-text supersede, but **no chained question** (answer a question → the new generation itself asks a new question → answer that one). The repository has no test asserting `answered_option_id`/`answered_at` is NULL on a newly created generation, and migration 011's only CHECK is `(status='completed') = (outcome IS NOT NULL)`, so the inconsistent state is schema-legal.

### 3.5 Suggested fix (NOT applied — diagnosis only)
Minimal, backward-compatible: in `create()` bind `null, null` for the new generation's `answered_option_id`/`answered_at` at lines 621–622, keeping `source_generation_id`/`question_id`/`question_json` (and `input_json`) for provenance. Do not touch the source-consumption UPDATE (571–574) or the guard (666).

Regression to add in `packages/server/test/assistant-stream-routes.test.ts`:
1. queue two consecutive SSE turns that each return a `clarification`;
2. send `text` → wait `awaiting-choice` (gen A);
3. send `choice` on gen A → wait `awaiting-choice` (gen B);
4. assert `GET …/generations/:B` has `outcome=awaiting-choice`;
5. send `choice` on gen B → expect `202`, and send `choice-text` on gen B (fresh conversation) → expect `202`;
6. assert a replay of an already-consumed question still returns `409 ASSISTANT_CHOICE_STALE`.

## 4. Streaming reality check — deltas vs terminal on the real provider

Answer to "does the real provider produce multiple deltas before terminal, and what is the time gap?" — **yes**.

- `f82dd60e`: 10 deltas, first −1094 ms, last −340 ms, span 754 ms.
- `4b0b2c99`: 118 deltas, first −10701 ms, last −436 ms, span 10 265 ms.
- `ed63eb1c`: 143 deltas, first −12370 ms, last −82 ms, span 12 288 ms.
- `106f37ee`: 109 deltas, first −10017 ms, last −175 ms, span 9842 ms.
- Choice generations: 2–3 deltas over 52 ms (short answers), all before terminal.

Interpretation:
- **Not a server batch issue.** Every delta is a separate `assistant_generation_events` row with its own `created_at`; 100+ rows are spread across seconds, not written in one tick. The `message` + `terminal` frames land 1–436 ms after the last delta.
- **Not a proxy-buffering issue (as far as the server side can be shown).** Host Caddyfile is a bare `jz.yansuu1.xyz { reverse_proxy 127.0.0.1:8081 }`, with no `encode`, no `flush_interval`, and no buffering directive; responses carry `X-Accel-Buffering: no`; the API writes with the Fastify raw socket and awaits backpressure (`packages/server/src/routes/assistant.ts` `write()`), and the event stream is HTTP/2 (`via: 1.1 Caddy`, `alt-svc h3`). Nothing in the served headers or the persistence timeline indicates coalescing at Caddy or the API.
- **Not an upstream field-order issue on the observed turns.** The incremental tokenizer decoded the top-level `message` string into complete characters; offsets are contiguous and the authoritative envelope validated afterwards (all sampled generations carry a `message` frame except the one that legitimately failed the bounds check).
- **Short answers can look like "no streaming"**: the coalescer (`COALESCE_CHARS = 32`, `COALESCE_MS = 50`, runner lines 88–90) emits a first fragment on a 50 ms debounce, so a 197-char answer yields 10 chunks over 754 ms; a viewer who samples twice inside the ~4.4 s provider TTFT sees an empty bubble both times. This is a **UX/latency fact, not a lost-data fact** — the finite-screen conclusion must not be promoted to a network truth.

Client-side corroboration: every completed generation shows `partialCount = 0` and a single validated `message`, and the Android reducer would have flagged `requiresReconcile` on any seq gap/offset mismatch and re-fetched the snapshot (`AssistantStreamReducer.reduceEvent`); no such state is visible in the screenshots.

## 5. Deployed artifact ↔ source consistency

Withheld until now and verified read-only:

| Check | Result |
|---|---|
| Repo `packages/server/src/**` vs server build-extracted bundle at `/opt/jizhang-upload/build-20261016T061009Z/jizhang-api-source` (12 stream-critical files) | **all SHA-256 equal** |
| Local `packages/server/dist/**` vs inside-image `packages/server/dist/**` (`assistant-generation-service.js`, `assistant-stream-tokenizer.js`, `routes/assistant.js`, `app.js`) | **all SHA-256 equal** |
| Live image id | `sha256:ea4e3691…21bc`, `StartedAt 2026-10-16T06:19:02.601484456Z`, healthy, `RestartCount 0` |
| Live migration list | 1–11 (`assistant-generations` present) |
| Live tables | 22 |

So the running server is exactly the reviewed source; the `ASSISTANT_CHOICE_STALE` behaviour observed on the device is the current code, not a stale image.

## 6. Deploy-script env comparison — key names, not value equality (confirmed)

`artifacts/deploy-streaming-20261016T061009Z-switch.sh` compares only:
```python
keynames = [k for k in env if any(t in k for t in ('AI','KEY','SECRET','TOKEN','PASSWORD','OPENAI','PROVIDER'))]
assert before['secretKeyNames'] == keynames
assert before['nodeOptions'] == env.get('NODE_OPTIONS')
```
i.e. **secret key names + `NODE_OPTIONS` only — not secret values.**

Compensating evidence I independently gathered (no value ever printed):
- protected config files were hashed at prepare time into `config-hashes.json`, and the switch aborts unless every unchanged file still matches byte-for-byte;
- current server hashes still match exactly:
  `.env 534811764f432d2f287807a020a3617720ba71c710ee272404e9ab42b015e738`,
  `runtime.override.yml 87f942e73a5afa08528aa0b218eac9175f4f9d8fcdd902c48cd73098b0a0f98f`,
  `manage.sh 954520b1a8da003eb881ee1643673c7ff840e6fbc06a31469aa89c7066c93838`;
- live container secret key names = `JIZHANG_AI_ENCRYPTION_KEY`, `JIZHANG_PASSWORD_HASH`; `NODE_OPTIONS=--max-old-space-size=160` — identical before/after.

Conclusion: the *value*-level guarantee is provided by `.env` byte-hash equality, not by the script itself. The key-name-only assert is a real (low) audit weakness; it is acceptable here only because the stronger hash equality covers it.

## 7. Correction: the "20 vs 21 tables" contradiction

`research/deployment-acceptance-review.md` claims the live pre-manifest had **21** tables and calls the `.db` backup's 20 a "nuance". **That is wrong.** The authoritative recorded artifact is unambiguous:

- `before-manifest.json` → `tables = 20` (migrations 1–10)
- `after-manifest.json` → `tables = 22` (migrations 1–11)
- `verification.json` → `tablesBefore: 20`, `tablesAfter: 22`, `addedTables: [assistant_generation_events, assistant_generations]`, `changedTables: [schema_migrations]`
- the bundled offline backup `.db` → 20 tables, migrations 1–10, integrity `ok`
- the live DB now → 22 tables

`deploy-status.md`'s "20 tables / 21 tables" 20 is correct; the review's 21 must be treated as a transcription error. There is **no** table-count drift, and I have not edited the other agent's report — this diagnosis supersedes it for the record.

## 8. Ledger invariant during the device test (hash equality only)

`artifacts/live-stream-diagnosis-ledger-compare.json` compares the current live manifest against the recorded before/after manifests.

- integrity: `before=ok`, `after=ok`, `live=ok`
- table counts: 20 → 22 → 22; added exactly `assistant_generation_events`, `assistant_generations`
- live vs `after`: changed tables = `assistant_conversations`, `assistant_generation_events`, `assistant_generations`, `assistant_messages` (all assistant-owned; expected chat activity)
- **ledger/business tables changed vs `after`: none** (`ledgerChangedVsAfter = []`)
- business table hashes/counts are byte-identical, e.g. `accounts` 4/4/4, `transactions` 59/59/59, `transfers` 2/2/2, `refund_links` 16/16/16, `budget_allocations` 1, `budget_templates` 1, `categories` 13, `salary_records` 1, `settings` 2, `users` 1, `asset_items` 0, `assistant_pending_actions` 10/10/10

Therefore the test window wrote **no ledger change and no new pending financial action** — screen-20's "ledger unchanged" claim is supported at table-hash level. (Rows/counts only; no financial detail inspected or emitted.)

## 9. Answer to the parent's specific questions

1. **Actual generation IDs for the UI flows (prefixes):**
   - tips flow `db4b1b34`: `f82dd60e` (answer), `f37bc0a1` (Dining/Entertainment question), `863a936c` (account question).
   - free-text attempt: **no generation was created** — it was rejected at `POST /generations` with `ASSISTANT_CHOICE_STALE` against source `863a936c`.
   - long-answer flow `07e609d8`: `4b0b2c99` (answer), `ed63eb1c` (failed bounds), `106f37ee` (answer).
2. **Multiple deltas before terminal on the real provider?** Yes — 10, 118, 143, 109, 3, 2 deltas per generation, all before terminal; first delta 3.4–4.5 s after creation, last 0.08–0.76 s before terminal.
3. **Upstream field-order / short answer / proxy buffering / server batching?** None of these explain the report: the server persists individual deltas across seconds, the proxy is a bare passthrough, the envelope validated on every completed turn, and short answers are legitimately coalesced (32 chars / 50 ms) into 2–10 chunks.
4. **Why did free text get `ASSISTANT_CHOICE_STALE`?** The new generation's own `answered_at`/`answered_option_id` are copied from the source at INSERT (`assistant-generation-service.ts` 606–626), so the generation presenting the account question is already marked answered and the guard at 664–667 rejects both `choice` and `choice-text`.
5. **Is the screen evidence equal to a network fact?** No. Screens 03/04 are two samples inside a ~4.4 s time-to-first-token; the deltas were on the wire (and in the DB) between the two "empty" frames and the "done" frame.

## 10. Contamination control

This investigation created **no** generation, message, pending action or ledger row — every probe opened the DB in `readonly` mode, and the generation/message counts in §8 are byte-identical to the post-deployment manifest except for the Android test's own chat activity. The Android track's read-only preparation is therefore unpolluted by this agent. Re-running `artifacts/live-stream-diagnosis-probe-readonly.mjs` will show whether the Android track later produced new chat rows.

## 11. Open items handed back (not expanded into changes)

1. **Fix `answered_at`/`answered_option_id` copy on generation insert** (§3.5) + chained-choice regression — required for the account question to be answerable at all.
2. **Decide long-answer behaviour at the 4000-char ceiling** (`ed63eb1c`): truncate-and-complete vs fail (tokenizer line 149–153 / runner 423–425 / `finalizeFailed` 325–332).
3. **Finish the ledger-invariant guarantee in the deployment script**: replace/augment the key-name-only env assert with the `.env` byte hash (already recorded in `config-hashes.json`).
4. **Correct the "21 tables" note** in `research/deployment-acceptance-review.md` (§7) when that file is next edited by its owner.
