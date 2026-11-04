# Protocol proposal for review

## Scope
Chat-compatible real streaming first; Responses/custom explicitly buffered. Text and server-owned choice continuation on new routes; attachments retain existing bounded nonstream API. No model/URL/timeout configuration changes. This proposal has not been implementation-approved.

## Endpoints
Under `/api/v1/assistant/conversations/:conversationId`:
- POST `/generations`: `{version:1,clientRequestId,input:{type:'text',text}|{type:'choice',sourceGenerationId,questionId,optionId}|{type:'choice-text',sourceGenerationId,questionId,text}}`. Request ID1–120 chars reject truncation; text1–2000 chars. First202, identical replay200; payload conflict409.
- GET `/generations?limit=1`: latest accepted generation for screen/process reconciliation, no model call.
- GET `/generations/:generationId`: authoritative snapshot, no model call.
- GET `/generations/:generationId/events?afterSeq=N`: authenticated SSE bounded replay/live, no model call.
- POST `/generations/:generationId/cancel`: idempotent cancellation, cannot undo committed pending/action results.

All existing cookie/CSRF/ownership boundaries preserved. Legacy message and attachment endpoints share active-turn exclusion with generations.

## Identity and lifecycle
Opaque server IDs, positive monotonic seq per generation, request input canonical hash dedup, one active generation per conversation. Status accepted/running/completed/failed/cancelled/interrupted; outcome answer/awaiting-choice/pending-confirmation separate from financial saved status. Pending action confirmation unchanged.

Persist state/events before publish. Snapshot contains partialMessages with stable IDs, lastSeq, messageIds, status/outcome/safe error. Client rejects duplicate events, reconciles gaps through status/replay. Unknown result never automatically sends a new generation.

Transport loss closes subscription, not generation; explicit Stop requests cancel. Server work bounded by captured deadlines. Restart marks unfinished interrupted without rerun. Archival fences late finalization. Cancel vs finalize resolves atomically; completed result cannot be undone by late cancel.

## SSE
Events state, text-delta(messageId,step,offset,text), message(validated DTO), terminal(status,outcome,messageIds,error). Envelope version/generationId/seq; route scopes conversation. UTF16 offset consistent in TS/Kotlin and no split surrogate pairs. Final message replaces partial matching ID. Heartbeat comments not persisted; bounded subscriber queues/backpressure. Replay unavailable returns pre-header409 requiring snapshot, not new generation. SSE is an explicit exception to JSON-only normal API guidance.

## Provider body proposal
Recommend incremental tokenizer of existing top-level `message` JSON string rather than requiring new prose array; lower first-text latency and existing schema reuse. This changes earlier closed-segment draft and requires review. Only complete decoded characters at unique top-level message path may emit; handle split UTF8, JSON escapes, unicode surrogate pairs, nesting/duplicate keys, depth/byte/text limits. No regex field extraction. No reasoning/tool arguments streamed. Whole envelope and finish semantics validated before actionable cards; partial text remains provisional on malformed/truncated response and no card created. Model field order cannot be guaranteed; test actual incremental delivery before final JSON, not fake typing.

Provider envelope adds optional clarification `{question,options:string[]}` or null, incompatible with simultaneous toolCall. Server assigns question/option IDs and normalized values. 2–6 nonduplicate bounded labels, single-select + free text. Choice must belong to current live conversation and latest unanswered source generation; new input supersedes it, transaction consumes choice+appends user message+creates continuation. No financial confirm on option click. Do not trust client label/answer payload.

## Persistence proposal
Migration011 only if still next available: assistant_generations and assistant_generation_events (no existing migration edits). Unique conversation/request, unique live conversation partial index, seq PK, bounded JSON safe fields. Clarification JSON and answeredBy generation on source record avoid unnecessary question/options table system. Final pending/message/generation/terminal commit atomic. Recovery before accepting traffic, no external queue. Replay retention bound finalized in review.

## Date and verification
Capture authoritative server today once per generation, include explicitly in prompt across up to3 steps. Validate fixed clock/midnight. Body deadline includes reading, not headers only; existing saved timeout unchanged. Parser delayed provider fixtures prove actual output before finish; auth/dedup/cancel/replay/restart/choice/staleness tests and unchanged-ledger assertions. Android A->B->A/session/address/subscription generations/old GET/seq gates, scroll/IME/reduced-motion and existing import100/hash confirmation regressions.

## Parallel ownership
Backend: provider parser+generation lifecycle+persistence/migration+routes/tests. Android: ApiClient streaming primitive+repo+typed reducer+UI/tests using frozen fixtures. Parent integration: protocol/examples, docs/inventory and acceptance. No concurrent same-file ownership.
