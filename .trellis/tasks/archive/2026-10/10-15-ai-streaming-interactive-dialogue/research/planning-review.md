# Parallel Pi-native planning/design review

Agents: planner (technical investigation), frontend (UX proposal), both read-only. No implementation. Ardot MCP unavailable, no canvas/node creation claimed.

## Evidence
- Provider complete() buffers entire response; timeout cleared after headers before body read, size check after allocation. Streaming needs bounded reads and full-body deadlines.
- Assistant prompt omits already computed context.today. Current orchestrator has <=3 provider/tool steps.
- Existing request dedup tracks user request ID, not durable generation/replay; message kinds constrained by SQL CHECK.
- Android uses shared cookie/CSRF ApiClient and request generations; preserve A->B->A, import workspace and confirmation guards.
- Previous task archived administratively with honest acceptance gaps; all prior mixed uncommitted code preserved.

## Recommended design, awaiting approval
1. Chat-compatible actual streaming first (New API target), Responses/custom retain clearly labeled full-response compatibility. Unsupported streaming never simulated.
2. Add generation create/status/events/cancel routes; authenticated bounded SSE, durable SQLite generation/events, payload hash dedup and ownership/revision fences. No external queue. Event reconnect does not start provider work; restart marks unfinished interrupted, no auto retry.
3. Only closed, bounded prose segments from allowlisted JSON paths stream. Final full envelope validation required before any actionable card/clarification. No raw JSON, reasoning trace, tool args or credentials. Schema validation is not factual validation.
4. Server owns choice IDs/answer values; proposed one bounded single-select question (2–6 options) plus free text. Forged, stale, superseded or wrong-conversation choices rejected. Choice click continues chat, NEVER confirms ledger.
5. Visual states: connecting/receiving/awaiting input/pending confirmation/answer ended/failed/interrupted. Generated != booked. Explicit Stop cancels generation; transport loss can reconnect to bounded ongoing work (policy awaits approval).
6. Backend and Android work parallel after shared protocol fixture freeze; integration owner controls contract/doc changes.

## Reconciliation of agent proposals
Backend durable identity/replay recommendation takes precedence over frontend illustrative client payloadText/Long generationId. Use opaque server IDs and seq; server loads answer. Back navigation must not silently cancel work. UI must not promise no side effects solely because a stream disconnected. Avoid invented token/time/balance/progress values and internal security jargon.

## Open product decisions
Meaning of clear signal: visible lifecycle/end/next-action vs haptic/sound. MVP provider fallback, single-select and disconnect behavior recommendations need user review. Ardot design access or approved alternative remains pending.
