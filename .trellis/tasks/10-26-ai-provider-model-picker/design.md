# Design

## Smallest boundary

Current ProviderSettings offers only a text field and static popular chips; server has no model listing endpoint. Add one protected explicit POST /api/v1/ai/models (no destination payload) using persisted config. Response: {items:[{id:string}]}. No persistence or model execution. Keep UI selection as ordinary draft state. Existing save/test semantics remain.

## Backend

AiConfigService gains an explicit saved-config lookup for listing that allows disabled configurations; existing getStoredOrThrow remains enabled-only. Validate the saved destination again, since disabled saves skip current URL validation. AiProviderService owns listing transport, reusing existing authHeader/callScope (no generic transport refactor). Known terminal /chat/completions or /responses path (optional trailing slash) becomes /models on the same origin, preserving prefix and existing query, excluding credentials/fragments/templates. Custom mode/unknown path rejects with AI_CONFIG_INVALID and manual guidance. Production requires HTTPS at config lookup. GET upstream with saved auth/non-secret headers, redirect:error, configured deadline, at most 2MiB, no retries. Normalize OpenAI {data:[{id}]} only, up to 2000 raw entries, id trimmed nonempty <=200 chars with no control characters, deduplicate preserving order; reject malformed or over-cap rather than truncate. Empty is a valid list. Error bodies never included. No capability filtering/claims.

## Android

AssistantRepository fetchProviderModels uses POST and bounded timeout covering configured 60s upstream. Typed strict DTO decoding and pure filtering helper; searchable AlertDialog/LazyColumn with current selection indicated, tap fills draft.model then closes. Retain model input and chips. Fetch runs only explicitly, after connection fields/credential changes are saved; an unsaved model-only change need not block listing. Capture saved connection identity and service URL, invalidate list on connection edits, don't accept stale destination/session results. Use in-memory state, cancellation propagation, no new key storage. New model select requires Save to activate. Empty/error retains draft and offers manual fallback. Disabled initial saved configuration may fetch models to avoid requiring a model before discovering one.

## Files

Server config/provider service and routes; new server tests. Android ProviderSettings, helper/DTO, AssistantRepository, tests and README. AI provider spec updated. Task artifacts and artifacts release packaging only beyond these. No database migration, upstream credential changes, existing accounting or organization changes.

## Approved layout follow-up

Follow research/provider-settings-layout-audit.md and provider-layout-implementation.md. Connection controls move together, model presets move inside an always-openable selector, advanced protocol fields stay folded and complete, footer remains outside scroll. Keep network/state owners and payloads; pure helper projections expose saved status and dirty state separately, and test evidence cannot certify an edited/saved-new connection. Only Android layout/tests/docs change; no server rebuild/deployment is required for this follow-up.

## Rollout

Backend before APK; old APK continues unchanged. New APK on old backend receives safe missing-endpoint feedback with manual fallback. New source package contains current server/shared working tree, not only this task. No deployment execution. Schema stays 18.
