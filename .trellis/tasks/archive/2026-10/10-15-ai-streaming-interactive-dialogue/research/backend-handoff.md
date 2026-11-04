# Backend handoff — AI streaming generation v1

Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Normative contract: `research/protocol-v1.md` (+ `research/protocol-fixtures-v1.json`)
Owner: backend agent (`packages/server/src`, `packages/server/test`, migrations).
Scope rules: no deploy, no device, no credential reads, no commit, no nested agents.

## Checkpoint log (newest last)

### 2026-10-15 · Phase A complete — bounded transport + parser

Implemented and verified:

- `src/services/assistant-stream-types.ts` — versioned v1 constants (`MAX_REPLAY_EVENTS`,
  `MAX_REPLAY_BYTES`, provider/stream/queue/heartbeat bounds, option/question/text caps),
  snapshot/event/input DTO types, stable error codes and `AssistantStreamError`
  (`ASSISTANT_GENERATION_INVALID | ASSISTANT_REQUEST_CONFLICT | ASSISTANT_GENERATION_ACTIVE |
  ASSISTANT_CHOICE_STALE | ASSISTANT_REPLAY_UNAVAILABLE | ASSISTANT_STREAM_BOUNDS |
  ASSISTANT_GENERATION_NOT_FOUND`). Safe message text only — never provider bodies.
- `src/services/assistant-stream-tokenizer.ts` — bounded incremental JSON tokenizer for the
  provider envelope. Decodes the unique top-level `message` string; handles `\" \\ \/ \b \f \n \r \t`
  and `\uXXXX` with surrogate pairing; no regex extraction; rejects duplicate keys, depth > 32,
  non-canonical numbers, lone surrogates, unfinished escapes, truncation and decoded-message
  overflow. Only complete decoded characters are queued for emission.
- `src/services/ai-provider-service.ts`
  - `AiProviderStream`: real SSE framing (CRLF, comments/heartbeats, multi-line `data:`),
    `TextDecoder(fatal)` so a UTF-8 character is never split, `choices[0].delta.content` only,
    strict `finish_reason === 'stop'` + `[DONE]` requirement, total/line/event byte bounds,
    whole-body deadline via `Promise.race` (stall aborts and cleans up), `cancel()` aborts the
    upstream fetch and releases the reader, rethrows parser failures out of `next()`.
  - `openStream()` returns `null` for `responses`/`custom` (explicit buffered path) and requires
    a server `text/event-stream` status; `stream: true` is only added for Chat-completions.
  - `complete()` deadline now spans the body read (`finally` clears it) instead of being cleared
    after headers.
- `test/assistant-stream.test.ts` — 21 passing tests: incremental delivery *before* upstream
  completion, escapes/surrogates/duplicate keys/depth/size bounds, strict finish, tool_calls
  rejection, truncation, single-byte-per-chunk UTF-8, oversize, cancel and stall-abort.

Evidence (run in `packages/server`):
```
npx vitest run test/assistant-stream.test.ts     # 21 passed
npx tsc -p tsconfig.test.json --noEmit           # clean
```

Not yet done (Phase B): migration 011, generation service/routes, clarification, recovery,
`today` capture, archival/shutdown fences, route-level tests. Details below.

### 2026-10-15 · Phase B complete — durable generations, routes, clarification

Implemented and verified (all additive; legacy endpoints unchanged):

- `src/db/migrations/011-assistant-generations.ts` + `migrate.ts` entry:
  `assistant_generations` (request hash, status/delivery/outcome CHECKs, `last_seq`,
  `message_ids_json`, `partials_json`, source/question/answer fencing columns, `today`) and
  `assistant_generation_events` (seq PK per generation). Partial unique index enforces at most
  one live generation per conversation; unique (conversation, client_request_id) makes replay
  and conflict detection structural.
- `src/services/assistant-generation-service.ts`: strict request parsing (unknown fields
  rejected, `clientRequestId` 1–120, text 1–2000, `input` discriminated union), canonical
  request hash → 200 replay / 409 `ASSISTANT_REQUEST_CONFLICT`, 409 `ASSISTANT_GENERATION_ACTIVE`,
  server-owned message ids and clarification option ids, monotonic seq persisted before publish
  with 2048-event / 2 MiB replay bounds, atomic finalization, explicit cancel (idempotent),
  archival fence, boot recovery, bounded subscriber queues (128 events / 256 KiB) and a
  `waitForEvent` used for heartbeats.
- `src/services/assistant-generation-runner.ts`: streaming vs explicitly buffered provider
  selection, ≤3 steps / 180 s deadline, coalesced `text-delta` writes (complete characters,
  32-char or 50 ms debounce, ≤4000 chars per turn / 12000 per conversation), partial snapshot
  kept in sync, validated `message` event before the terminal frame, clarification with
  2–6 server-id options, write-tool turns produce a pending card and never book, shutdown
  aborts readers and closes subscribers. Every provider/tool await is followed by a
  live-generation + archived-conversation fence; a prepared write card is persisted in one
  synchronous block.
- `src/routes/assistant.ts`: `POST/GET /generations`, `GET /generations/:id`,
  `GET /generations/:id/events` (SSE with replay, seq de-dup, heartbeat comments, backpressure)
  and `POST /generations/:id/cancel`. Replay/validation happens before the response head, so a
  missing replay is `409 ASSISTANT_REPLAY_UNAVAILABLE`. Archival closes live generations and
  aborts their runners; `onClose` shuts the runner down. Legacy `/messages` shares the
  active-turn exclusion and returns `409 ASSISTANT_GENERATION_ACTIVE`.
- `src/services/assistant-types.ts`: additive `generationId` + `clarification` on text messages,
  strict persisted-clarification reader, and `clarification` support in the provider turn
  (rejected when combined with a `toolCall`).
- `src/services/ai-provider-service.ts`: the stream reader honours the configured
  `responsePath` (mapping `message` → `delta`), `complete()` keeps its deadline armed through the
  body read.

Tests (all passing): `test/assistant-stream.test.ts` (23), `test/assistant-stream-routes.test.ts`
(20: auth/CSRF, unknown fields, replay/conflict, active-generation exclusion from both entry
points, ordered events, replay-gap, latest-without-model-work, malformed stream, content-type,
buffered modes, cancel idempotence + unchanged ledger, single-select/free-text/forged/wrong/
cross-conversation/stale options, supersede-by-text, write card without booking, toolCall+
clarification rejection, archival fence, boot recovery without provider calls),
`test/assistant-contracts.test.ts` (+4 clarification contract tests), `test/db.test.ts`
(unchanged list semantics + migration 011 applies).

Evidence (run in `packages/server`):
```
npm run lint        # clean (--max-warnings 0)
npx tsc -p tsconfig.test.json --noEmit   # clean
npx vitest run     # 23 files / 546 tests passed
npm run build      # tsc -p tsconfig.json clean
```

### Known gaps / follow-ups for the parent

1. **SSE integration over a real socket** is not covered: route tests exercise
the replay contract and lifecycle through `app.inject`, not a live streaming socket. A
manual/e2e check is still outstanding.
2. `ASSISTANT_REPLAY_UNAVAILABLE` is currently raised for any `afterSeq > lastSeq`. The "no
more than 2048 events / 2 MiB replay" retention bound means replay is never pruned in the
MVP, so a stricter rule was not needed; revisit if a retention policy is approved.
3. **Frontend contract delta**: generation create/responses/events are new routes; the Android
track must consume `{created,generation}` (202/200), snapshot fields (`partialMessages`,
`messages`, `userMessage`, `outcome`) and the four event types. No legacy route changed shape.
4. `delivery` is chosen from the saved provider mode at create time; a mode switch between
create and the run cannot change it mid-generation (by design — no silent fallback).
5. The streamed envelope is parsed once from the concatenated deltas, so a provider that
reports a clarification in a later delta than the first one still works; deltas after
`[DONE]` fail the generation (`ASSISTANT_STREAM_BOUNDS`).

## Design decisions recorded for the parent/reviewer

1. **Buffer vs emit** — the provider transport streams complete decoded characters; the
   generation service (Phase B) will coalesce them (chunk-boundary batching, ≤4000 chars/turn)
   into `text-delta` events. The transport does not write DB rows.
2. **`provider raw response` shape** — the envelope remains `{message, toolCall, clarification?}`;
   `clarification` is added additively by the Phase B prompt/schema so existing
   `normalizeAssistantProviderTurn` behaviour is preserved for legacy paths.
3. **No silent fallback** — `openStream() === null` means buffered delivery (`delivery:'buffered'`);
   a Chat stream error is terminal (`failed`), never retried and never converted into a fake
   incremental reply.
4. **Body deadline** — request timeout covers time-to-headers; the stream body gets
   `min(2 × configuredTimeoutMs, 180s)` so a dribbling provider cannot hold a generation open
   forever without changing the saved timeout value.
