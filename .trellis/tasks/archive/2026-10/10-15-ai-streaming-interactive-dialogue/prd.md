# AI streaming and interactive dialogue

## Goal
Make Android AI conversations responsive and understandable: real incremental model output, tappable clarification choices instead of repeated manual typing, and clear signals about processing/answer completion and next steps.

## User consent
User explicitly requested archiving the prior task, creating this task, sub-agent planning/design and frontend/backend completion with parallel work where useful. User subsequently approved the final visual MVP/parallel implementation summary with “开始”. Implementation approved; deploy/install remains separate.

## Confirmed requirements
- R1: Real streaming from the configured provider through authenticated backend to Android, not simulated typewriter output after a full response.
- R2: AI-proposed clarification choices appear as tappable cards/options continuing the owning conversation; free text remains available.
- R3: Approved visual-only signal: distinguish connecting, receiving, awaiting choice, pending ledger confirmation, answered, failed/interrupted; never imply automatic booking. Sound/vibration out of scope.
- R4: Preserve auth/secret boundaries, stable pending action/digest/staleness/idempotency and explicit financial confirmation. Option click is not ledger confirmation.
- R5: Actual editable Ardot design before implementation. Connection now verified; 5 design frames created/reviewed, see research/ardot-design.md. Do not label design evidence as runtime acceptance.
- R6: Pi native subagent for planning/design/implementation/review; backend/frontend may proceed in parallel after stable contract approval.

## Carry-forward facts
Previous task archived administratively at `.trellis/tasks/archive/2026-10/10-15-ai-provider-settings-mvp`. Server follow-up image deployed; APK installed with byte equality. Local old code remains uncommitted/mixed with unrelated WIP. Device ordinary hello succeeded; a today-based draft asked today's date because assistant prompt does not pass known server today. Earlier20s timeout unproven fixed. These are not completed draft-flow acceptance.

## Constraints / provisional scope
- Existing provider modes, legacy endpoints/history compatible; unsupported provider streaming must be explicit, no fake streaming.
- No raw JSON/tool argument/secret/thinking trace streaming into UI or DB. Authoritative final validation before any pending card or action.
- Only user-approved deployment/install; no real test booking.
- No new infrastructure/queue unless research proves necessary.

## 2026-10-15 design update
User requested actual Ardot connection and sub-agent implementation. Native frontend agent connected via MCP and built/revised5 editable screens on existing page20:1 (AI14–AI18). Native planner refined protocol proposal in research/protocol-draft.md. Product implementation remains gated by unresolved signal intent and final review.

## Approved MVP / acceptance
- NewAPI Chat-compatible true streaming; Responses/custom keep explicitly labeled buffered replies, no silent retry/fake typing for unsupported Chat streams. Attachments retain old nonstreaming path.
- One question with 2–6 single-select options plus free text. Server-owned IDs/answers; selection locks/deduplicates and continues owning conversation.
- Disconnect/back closes subscription only; explicit Stop cancels. Reconnect reads same generation, restart marks interrupted without rerun.
- First text must reach Android before controlled upstream completion; final envelope required before choice/tool card. Server-local today captured per generation.
- Auth/CSRF, payload dedup, replay/gaps/cancel/archival/ownership races and Android A->B->A/old GET tests; existing import hash/100-limit/idempotent confirmation regressions. Ledger unchanged during generation/choice.
- No new infrastructure or model/credential/default-timeout changes. No device/deploy acceptance claimed from fixtures/builds.
