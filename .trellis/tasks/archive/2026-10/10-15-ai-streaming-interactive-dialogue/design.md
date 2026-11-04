# Approved technical and UX design

## Boundaries
True provider -> backend -> Android streaming; structured clarification choices; explicit answer lifecycle. All financial operations still require existing separate pending-card confirmation. Backend/Android parallel after reviewed contract freeze.

## Proposed contracts
- Add versioned generation creation/status/SSE events/explicit cancel routes, retaining legacy full-response endpoints/history. Auth/CSRF shared; GET subscription never creates model work.
- Server-owned generation IDs, monotonic seq and bounded durable replay. Request ID plus payload hash dedup; conflicting payload rejected. One active generation per conversation; finalization fenced by revision/cancellation/archival.
- Stream complete decoded characters from unique top-level message JSON string using bounded incremental tokenizer (not regex); final full-envelope validation before any tool/choice. Protocol v1 in research/protocol-v1.md controls exact fields. No raw JSON/tool/reasoning/credential exposure.
- Clarification as additive normalized content in existing text message kind. Proposed single-select 2–6 options; server stores answers/references. Atomic ownership/expiry/double-click handling; free text alternative. Choice is conversation input, never confirm endpoint.
- Incremental UTF8/SSE parsing, bounded line/event/total sizes, body-lifetime deadlines, abort/reader cleanup, heartbeat/backpressure and safe post-header errors. Explicit stop cancels; disconnect/reconnect policy awaits approval. Restart marks unfinished interrupted without automatic regeneration.
- Recommend Chat-compatible streaming MVP for New API; Responses/custom retain clearly marked full-response paths. Fallback behavior awaits scope review.
- Add captured authoritative server today to assistant context and fixed-clock tests. Streaming alone is not evidence that long-context20s timeout is fixed.

## Proposed mobile design
One growing reply with compact footer, not one status card per chunk. Footer distinguishes connecting, receiving, waiting for selection, pending financial confirmation, answer finished, failed/interrupted. Choice buttons >=48dp; selection locks double taps and adds user continuation; optional free text remains. Pending ledger card never merged with option group.

Use existing Ardot-derived visual tokens (390dp, warm background, titanium blue), reduced motion, IME safe area and reading-preserving scroll. Late events gated by server/session/conversation/generation/subscription identity and seq. Ardot MCP now verified. Editable frames32:11,32:75,32:123,32:172,32:214 created and screenshots reviewed; see research/ardot-design.md. Older unavailable report is superseded.

## Compatibility and rollout
Document SSE exception to current JSON-only response guidance. Additive migration must preserve old message kinds/history and be rehearsed before approval to deploy. Preserve legacy provider configurations and import200-preview/100-selection/hash/staleness/idempotence contracts. No broad WIP commit or DB restore over live new writes.

## Approval
User approved final MVP and actual Ardot design with “开始”. Visual signal only, Chat real stream/other modes explicitly buffered, single-select+free text, disconnect preserves bounded generation and explicit Stop cancels. Protocol v1 is the implementation source of truth.

## Protocol refinement for review
Planner proposes incremental safe top-level message-string decoding instead of closed prose segments; see research/protocol-draft.md. Adopted as implementation detail of the approved real-streaming MVP; full envelope remains mandatory for actionable content. Actual Ardot delivered; visual-only intent approved.
