# Provider Reliability Review

Status: **COMPLETE — read-only file/source review; the two observed failures remain FAILED**
Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Scope: read-only decision review of the two real streaming failures (timeout + envelope), against frozen `research/protocol-v1.md`
Owner: yansuu1

Constraints in force this round: no product/test/config change, no provider call, no device/deploy/restart, no secret/model/timeout dependency, no stage/commit, no nested sub-agent, no repo-wide audit. Raw provider payload is not stored anywhere; **provider root cause is not asserted**.

Process note: this file was first created with `Status: RUNNING` and no findings, then the same file was completed with the conclusions below. No other file was written.

## In-flight checklist
- [x] Read task artifacts (prd, protocol-v1, aba-provider-failure, final-acceptance-summary)
- [x] Read `ai-provider-service.ts` `callScope`/`openStream` and runner `toStreamError`/`finalizeFailed`
- [x] Re-run the existing local-only timeout probe artifact (no network, no DB)
- [x] Q1 timeout budget scope
- [x] Q2 contract conformance of the two failures
- [x] Q3 limited acceptance soundness
- [x] Q4 error observation without raw payload/credentials
- [x] Findings written (see below)

---

## 0. Evidence base (what was actually read/re-run this round)

| Item | Path | Nature |
|---|---|---|
| Frozen contract | `research/protocol-v1.md` | normative |
| Prior failure diagnosis | `research/aba-provider-failure.md` | file/metadata read-only |
| Acceptance summary | `research/final-acceptance-summary.md` | file read-only |
| Transport + parser | `packages/server/src/services/ai-provider-service.ts` | source read-only |
| Tokenizer | `packages/server/src/services/assistant-stream-tokenizer.ts` | source read-only |
| Error mapping | `packages/server/src/services/assistant-stream-types.ts` | source read-only |
| Runner / budget | `packages/server/src/services/assistant-generation-runner.ts` | source read-only |
| Timeout budget probe | `artifacts/provider-reliability-review/local-timeout-budget-probe.ts` (re-executed; temporary wrapper copy deleted) | local, stubbed fetch, no network |
| Failure metadata | `artifacts/aba-provider-failure/aba-generation-metadata.json`, `artifacts/phone-verifier-lifecycle/conversation-aba-retest/12-server-evidence.json` + `device-timestamps.json` | read-only, lengths/offsets/status only |

No live provider call, no DB write, no container, no phone. The two observed failures remain **FAILED**.

---

## Q1 — Is the existing timeout really applied as "saved 20 s over the complete body"?

### Verdict: **YES — one single 20 s budget covers headers + full body; it is not re-armed per chunk and not multiplied per step.**

Evidence, exact locations:

1. **Config default is a single saved value**: `packages/server/src/services/ai-config-service.ts:19` `const DEFAULT_TIMEOUT_MS = 20_000;` (used at `:55`, `:192`). This is the only "20 s" in play; there is no separate body/timeout constant.
2. **One deadline is armed per provider call**: `ai-provider-service.ts:659` `function callScope(config, options)` → `:662-663`
   `const timeout = setTimeout(() => controller.abort(new AiProviderTimeoutError()), Math.max(1, Math.min(config.timeoutMs, options.timeoutMs ?? config.timeoutMs)));`
   One `AbortController` (`:660-661`) and one `setTimeout`; cleared only in `dispose()` (`:676-680`). There is no per-read or per-chunk timer.
3. **The remaining budget is handed to the body phase, not re-issued**: `ai-provider-service.ts:749` `const scope = callScope(config, options);` starts the clock *before* `fetch` (`:752`), then `:763`
   `streamTotalTimeoutMs: Math.max(1, Math.min(config.timeoutMs, options.timeoutMs ?? config.timeoutMs) - (Date.now() - started))`
   i.e. `configuredTotal − elapsedToHeaders`. So headers latency is *subtracted*, not added.
4. **The body timer is that same remaining budget**: `ai-provider-service.ts:403-406` in the `AiProviderStream` constructor arms a second timer with `options.streamTotalTimeoutMs`, aborts the reader (`:404`) and rejects the in-flight `read()` via the `aborted` promise raced in `pull()` (`:470-471`), which surfaces as `AiProviderTimeoutError` (`:474-476`).
5. **The runner cannot widen it**: `assistant-generation-runner.ts:704-712` `streamDeadlineMs()`
   `const configured = Math.min(providerTimeoutMs * 2, MAX_GENERATION_DEADLINE_MS);` then `return Math.max(1, Math.min(fromHandle, configured));`
   With `providerTimeoutMs` = saved 20 s (`:409`, `:409` is `Math.max(1_000, Math.min(stored.timeoutMs, remaining))`) and the protocol's 180 s generation cap (`assistant-stream-types.ts:20` `MAX_GENERATION_DEADLINE_MS = 180_000`), `configured` = min(40 000, 180 000) = **40 000 ms**; but `fromHandle` is already the provider's remainder (≤ 20 s), so the effective body ceiling is **≤ saved timeout**. The `*2` is a floor-free upper clamp that the transport's own value always undercuts.
6. **Local re-execution** (`local-timeout-budget-probe.ts`, stubbed fetch, no network) confirms the budget is end-to-end and not cumulative:

| case | configured | reported to body phase | measured total to timeout |
|---|---|---|---|
| headers immediate, body stalls | 800 ms | 786 ms | 809 ms |
| headers immediate, body never yields | 800 ms | 800 ms | 802 ms |
| headers delayed 300 ms, body stalls | 800 ms | 490 ms | 806 ms |
| headers immediate, configured 400 ms | 800→400 ms | 400 ms | 403 ms |

   All four land at ≈ the configured value measured **from before `fetch`**, and row 3 proves the header delay is deducted. No multiplication across `MAX_GENERATION_STEPS = 3` (`assistant-stream-types.ts:19`) — the only reason 3 steps do not give 3×20 s per-step bodies is the shared 180 s generation deadline at `assistant-generation-runner.ts:356` `const deadline = checkout + MAX_GENERATION_DEADLINE_MS;` (`:409` feeds `remaining` into the min).

**Determined.** The 20 s is a whole-call budget implemented exactly as `protocol-v1.md` §Provider requires: *"Keep timeout active across body reading, cleanup controller/readers/timers on every completion/error/cancel."* **Nothing here is broken, and no timeout change is warranted or proposed.**

**Observation (not a defect, not a change request):** the failure at `+20.002 s` after send is therefore the *expected* shape of a provider whose first byte did not arrive inside the saved budget — the timer fired at the configured value, which independently corroborates that the 20 s is real and whole-body.

---

## Q2 — Do the two failures conform to the frozen contract, or does the contract require 100 % external success?

### Verdict: **Both failures CONFORM to the frozen contract. The contract does not require 100 % external provider success, and it explicitly forbids the mechanisms that would be needed to hide them.**

### (a) `ASSISTANT_STREAM_BOUNDS / INVALID_ENVELOPE` at 219 chars

- Protocol §Provider: *"strict finish_reason stop + [DONE], no raw reasoning/tool args"*, *"incomplete final envelope fails with no card"*, *"Chat stream failure never auto-fallback/retry."*
- Runtime enforces exactly this at multiple gates, all mapping to the same safe code:
  - `ai-provider-service.ts:557-559` — `[DONE]` without a prior `stop` finish reason → `INVALID_ENVELOPE`
  - `:564-569` — event payload that is not JSON → `INVALID_ENVELOPE`
  - `:570-576` — non-object payload, `error` field, or unusable `choices` → `INVALID_ENVELOPE`
  - `:608-613` — decoded `content` pushed into the tokenizer (`:610`); a `TokenizerFailure` propagates
  - `assistant-stream-tokenizer.ts:130-140` `guard()` → `INVALID_ENVELOPE`; `:118-126` `finish()` rejects truncation/unfinished state
  - `assistant-generation-runner.ts:675-681` — authoritative re-parse of `stream.envelope` after the loop → `INVALID_ENVELOPE`; this is precisely *"final envelope required before choice/tool card"*
- **219 chars vs the 4000 limit**: `assistant-stream-tokenizer.ts:149-152` `appendDecoded()` throws the *distinct* `OVERSIZE_MESSAGE`; the recorded message was `INVALID_ENVELOPE` (`aba-provider-failure.md` §2 items 1-2, corroborated by `aba-tokenizer-probe-output.json`: truncated shape → `INVALID_ENVELOPE`, 4001-char complete shape → `OVERSIZE_MESSAGE`). So the length branch was never entered. **Determined.**
- Failure with `outcome=null` and empty `messageIds` is the contract's own definition of a non-result: *"partial text provisional until matching message event"* and *"completed NEVER means ledger booked"* — a failed turn carries no message and never books. Ledger counts in `aba-generation-metadata.json` (`transactions=59`) confirm zero financial effect. **Determined.**

### (b) `ASSISTANT_STREAM_BOUNDS / AI 响应超时` at +20.002 s

- Metadata (`conversation-aba-retest/12-server-evidence.json`): `last_seq=3` = state, state, terminal; **zero text-delta, zero message**; the gap `updated_at − created_at = 1792165879273 − 1792165859271 = 20 002 ms` matches the saved 20 s budget from Q1.
- Mapping chain: `AiProviderTimeoutError` (`ai-types.ts:308`) → `toStreamError` `assistant-stream-types.ts:212`, `:217-218` `case 'AI_PROVIDER_TIMEOUT'` → `'AI 响应超时，本次生成已中断。'` → persisted by `assistant-generation-runner.ts:325-334 finalizeFailed` (`:326 const mapped = toStreamError(error); :329-333 generations.finalize(... status:'failed', outcome:null ...)`).
- This is a **terminal, in-contract failure**, not a swallowed one: the generation is not left `running`, no partial is promoted, no card is created, and the client is told the turn ended. Protocol §Events: *"Client interrupted connection != server failed"* — here the server is the one that correctly terminalized.
- **Determined:** both failures are *contract-conformant failure reporting*, not contract violations.

### (c) Does the contract demand 100 % external success?

No. The contract's reliability requirements are all about *bounded, honest, non-fabricated* behaviour:
- *"Chat stream failure never auto-fallback/retry"*, *"not fake streaming"*, *"unsupported provider streaming must be explicit"* (prd R1/constraints; protocol §Provider).
- *"no silent retry/fallback"*, *"fail explicitly at bound"* (protocol §Runtime/persistence).
- *"do not mutate saved timeout/model/secret"* (protocol §Runtime/persistence) — an instruction that directly **forbids** the "extend timeout" or "switch model" remedies.
- The acceptance bar is `protocol-v1.md` §Ownership and validation: *"Tests require actual delayed mock upstream incremental delivery before finish, parser corruption/deadline/abort, auth/replay/dedup/choice/cancel/archival/restart and unchanged-ledger assertions"* — i.e. **the parser-corruption and deadline paths are required to be *tested*, meaning they are allowed to *occur***. A contract that mandates testing the failure path cannot simultaneously mandate zero failure-path occurrences.
- `prd.md` R1 says the model output must be real and incremental, never simulated — which is only achievable if a genuinely unparseable/slow upstream surfaces as a failure.

**Therefore:** an upstream mix of "one timeout, one malformed envelope" over a small real-device sample is **not** by itself an acceptance breach of the frozen contract. It is an **external reliability observation** that the contract deliberately keeps visible.

---

## Q3 — Is limited acceptance sound now, with external reliability declared not-passed?

### Verdict: **YES — limited acceptance is the contract-consistent position, provided the scoped pass and the external-reliability non-pass are stated as separate rows and the two failed generations are never re-labelled.**

What may be accepted now (each already has its own bounded evidence, per `final-acceptance-summary.md` §2 and its cited artifacts, not re-derived here):
- server code/build/test green, Android build/test green and installed-APK byte equality;
- real device chained-choice advance, Stop-before-first-token, multi-frame incremental text with single-bubble de-dup and zero late card, ABA conversation isolation (B clean, A re-aligns the same generation, generation delta of 1), and unchanged ledger counts.

What must **not** be marked accepted:
- The two failed generations `3da7ef99…` (`INVALID_ENVELOPE`, 219 chars) and `21dba779…` (`AI 响应超时`, +20.002 s) stay **FAILED**. `aba-provider-failure.md` §5 already fixes this prohibition; nothing this round changes it.
- The observable flakes actually *demonstrated* (single-frame scroll pill, `finalizeFailed` leaving `partials_json` behind) stay open. The second one is a **real behaviour/code-comment divergence, not a guess**: `assistant-generation-runner.ts:499-500` comments that the unfinished provisional bubble *"is dropped by the same write that stores the terminal frame"*, while `aba-generation-metadata.json` shows `partials_count=1, partial0_text_len=219, partial0_validated=0` retained on a `failed` row. Recording it is observation, not modification — and per the frozen contract only **completed** generations may carry messages, so a stale provisional on a failed snapshot is a *presentation/cleanup* question, not a data-integrity one. **No code change is proposed here.**

**The wording that is sound:** "Limited functional acceptance PASS for the enumerated device scenarios; external provider reliability NOT PASSED (2 real failures, sample-bounded); overall task PARTIAL / NOT ACCEPTED." That is exactly `final-acceptance-summary.md`'s headline; this review agrees with it and adds that **the failures are not contract violations**, so they block *reliability sign-off*, not *contract conformance*.

**What would be unsound:** converting the two failures into PASS via retry/fallback, or claiming end-to-end reliability from the buffered/legacy paths, or claiming device acceptance from fixtures/builds (the last two are already prohibited by `prd.md` §Approved MVP / acceptance).

---

## Q4 — How should these errors be classified/observed without raw payload or credentials?

### Design constraint

`protocol-v1.md` §Provider and §Events already make the *streamed* content binding: *"no raw reasoning/tool args"*, *"only safe decoded text visible until full-envelope validation"*, *"No raw JSON/tool argument/secret/thinking trace streaming into UI or DB."* The contract binds the *stream*, but the safest reading for diagnostics is to apply the same rule to persistence, so the recommended observable does **not** need the raw body at all.

### Recommended classification (metadata only — no payload, no secret)

Emit one structured, bounded record per terminal stream failure, keyed by what the code already knows at throw time:

| Field | Derivation (already available, no raw text) | Example |
|---|---|---|
| `generationId`, `step` | runner state | `3da7ef99…`, `step 0` |
| `stage` | where the throw originated: tokenizer-incremental (`ai-provider-service.ts:608-613`) vs authoritative re-parse (`assistant-generation-runner.ts:675-681`) vs transport framing/JSON (`ai-provider-service.ts:470-476`, `:504`, `:557-576`) | `envelope_final` |
| `envelopeBytes` | `Buffer.byteLength(stream.envelope,'utf8')` — length only | `219`-derived byte count |
| `decodedChars` | tokenizer's accumulated length (distinct from bytes) | `219` |
| `failureOffset` | byte offset of the first offending token **relative to the envelope**, produced by the parser's error position — an integer, never a substring | `412` |
| `elapsedToFailureMs` | `now − generation.created_at` and, separately, `now − firstDeltaAt` (already derivable from `assistant_generations`/`assistant_generations_events`; the ABA row shows this exact split: 5.66 s TTFT vs 668 ms delta span) | `20002` |
| `hadAnyDelta` / `hadAnyValidatedMessage` | booleans already known | `false/false` |
| `providerStatusCode`, `contentType` | already validated at `ai-provider-service.ts:756` | `200`, `text/event-stream` |
| `mappedCode` / `mappedMessage` | exactly what `toStreamError` (`assistant-stream-types.ts:212-231`) already produces | `ASSISTANT_STREAM_BOUNDS` |

**Prohibited without exception:** `envelopeText` / `stream.envelope` contents, prompts, `delta.content`, `config.headers`, `authHeader` output, `secret`, model name, base URL with credentials, tokenizer decoded text, `today`/user input. Note that `secret` is already isolated (`ai-config-service.getSecretOrThrow`) and `headers` already come from stored config; the diagnostic must never widen those boundaries.

### Minimal classifier that is *possible* from metadata alone

Even without new fields, the existing signals already separate the two roots if both the code and the message are recorded together — which they are in `assistant_generations.error_code`/`error_message`:

- `ASSISTANT_STREAM_BOUNDS` + `AI 响应超时，本次生成已中断。` ⇒ timeout/latency class (`assistant-stream-types.ts:217-218`).
- `ASSISTANT_STREAM_BOUNDS` + `AI 返回内容无法识别，本次生成未产生结果。` ⇒ envelope-not-recognisable class (double-sourced: tokenizer `:24/:131/:137` and runner `:680`; `AI_RESPONSE_INVALID` maps to the same wording at `assistant-stream-types.ts:225-226` — this shared wording is the real ambiguity).
- `ASSISTANT_STREAM_BOUNDS` + `AI 回复超出长度上限…` ⇒ length class (`assistant-stream-tokenizer.ts:25/:152`).
- `ASSISTANT_STREAM_BOUNDS` + `AI 返回内容格式异常…` / `AI 回复被上游提前终止…` / `AI 返回了不支持的流式字段…` ⇒ framing / upstream-termination / unsupported-field classes (`ai-provider-service.ts:504`, `:585`, `:601`).

So the **only** structural observability gap worth recording is: *the `INVALID_ENVELOPE` wording is emitted from at least two distinct stages (incremental tokenizer vs post-loop authoritative re-parse)*, so the current `error_message` cannot tell an operator which stage rejected the bytes. `aba-provider-failure.md` §3 already identified this and §6.1 proposed a stable sub-reason. That remains the right shape of fix; it is **diagnostics only**, and it is *not* a licence to loosen parsing.

### Explicitly rejected (would conflict with the frozen contract)

- silent retry / auto-fallback of the stream (`protocol-v1.md` §Provider, §Events);
- relaxing the strict JSON/tokenizer checks or accepting the last good partial as a valid answer (breaker of *"only safe decoded text … until full-envelope validation"*);
- raising/extending the saved timeout or the 180 s generation deadline (*"do not mutate saved timeout/model/secret"*; `MAX_GENERATION_DEADLINE_MS` is enforced at `assistant-generation-runner.ts:356`, `:505`);
- model/provider/credential changes to improve success rate;
- treating a client disconnect as a server failure or vice versa (§Events).

---

## Decision answers (compact)

1. **Timeout**: **Determined — yes.** One saved 20 s budget covers headers + entire body; headers latency is *subtracted* (`ai-provider-service.ts:763`), no per-chunk re-arm, no per-step multiplication, clamped under 40 s / 180 s by `streamDeadlineMs()` (`assistant-generation-runner.ts:704-712`), confirmed by local re-run. The +20.002 s ABA failure is the expected firing of that budget. No change needed or requested.
2. **Contract**: **Determined — both failures conform.** `INVALID_ENVELOPE` at 219 chars (≪ 4000, so not `OVERSIZE_MESSAGE`) is the contract-mandated strict-envelope rejection; the timeout maps through `toStreamError` to a bounded terminal `failed` with `outcome=null` and zero ledger effect. The frozen contract requires failure paths to be tested and forbids retry/fallback/timeout/model mutation, so it does not require 100 % external provider success.
3. **Acceptance**: **Sound, if stated per-scope.** Limited functional acceptance PASS over the enumerated device scenarios may stand, in parallel with "external provider reliability NOT PASSED (2 real failures)", overall PARTIAL / NOT ACCEPTED. The two failed generations remain FAILED.
4. **Error observation**: **Metadata-only classification is achievable** (stage, envelope bytes, decoded chars, relative failure offset, elapsed-to-failure, had-delta flags, provider status/content-type, existing mapped code+message). One real gap: `INVALID_ENVELOPE` is thrown from ≥2 stages and shares wording with `AI_RESPONSE_INVALID`, so a stable sub-reason/stage tag (not payload capture) is the correct, contract-compatible improvement.
5. **`final-acceptance-summary.md` "解析器容错缺陷" wording**: **Correctly challenged — insufficient evidence as phrased, but the summary's underlying classification is defensible because it is not one uniform claim.** §3 item 1 lists the timeout and the `INVALID_ENVELOPE` together as *"上游 LLM Provider 稳定性与格式解析容错缺陷"* and then asserts *"缺乏对上游瞬态格式抖动的容错或降级机制"* — that assertion is **not supported by the evidence**: a single malformed envelope with no stored raw payload cannot distinguish (i) a genuine provider malformation from (ii) a correct-but-strict rejection of a provider that does not emit the frozen schema at all (in which case the contract *requires* failure, not tolerance). Attributing it to "parser fragility / transient format jitter" therefore over-reaches; the defensible wording is "envelope not recognisable under the frozen strict parser — root cause indeterminate without payload or a new provider call". §1's row wording *"Envelope 解析失败导致 2 次真实回答生成失败"* is factual and fine; §3's *"缺乏容错或降级机制"* is an implication that the contract actually forbids.
6. **Unknown (honest)**: the actual malformation shape of `3da7ef99…`, and whether the upstream provider's real failure rate is materially above zero. Both require either raw storage — which the contract's safety boundary and this round's constraints exclude — or new provider calls, which are not authorised.

## Next step (no code, no retry, no fallback)

Record the two failures as **contract-conformant, reliability-blocking observations** in task documents, keep the limited-acceptance scoping, and — only under separate approval — add staged, payload-free failure diagnostics (stage + integers) as described in Q4. Any behavioural change to retry/fallback/timeout/strictness requires a contract revision, not a code patch.
