# AI Provider Model Listing and Selection

## Authorization

The user requested model fetching and selection in Android AI configuration, accepted the proposed saved-provider/search/manual-fallback approach, and explicitly said 开始 on 2026-10-26. This authorizes task creation and implementation after persisting/reviewing this plan, not production deployment or paid inference calls.

## Requirements

- Explicitly fetch available models using the server's saved provider destination and encrypted credential. Never return the credential to Android or call the upstream from Android.
- Android shows a searchable selectable list; selection changes the draft model only. Saving is still explicit. Keep arbitrary manual model input and existing presets.
- Fetch failure/empty or unsupported list never clears or automatically replaces the selected model. No automatic inference/test request.
- Clearly require saving provider connection edits before fetching; support initial setup with AI disabled and a saved address/credential and blank model.
- Bound transport and model-list size, reject redirects, redact upstream error bodies and secrets, preserve authentication/CSRF and production HTTPS policies.
- Update maintained Android stable inventory and API/spec documentation. Deliver APK, backend source package/checksum and deployment guidance without deploying.

## Acceptance

- Chat-completions and Responses standard endpoint paths map to the same provider's models endpoint, preserving path prefixes (not an unrelated origin). Unsupported custom/ambiguous endpoints are explicit and manual input remains usable.
- Model ids validated, deduplicated, bounded; only minimal ids returned. Empty lists and network/auth/timeout/schema failures have truthful safe feedback.
- No ledger or configuration changes during listing; model selection not saved until user confirms Save.
- Busy operations exclude save/test/fetch overlap; edited connection or changed service cannot accept stale model results. Search and list remain bounded and accessible.
- Automated backend auth/CSRF/transport/normalization tests and Android DTO/search/state tests pass; lint/typechecks/build pass. Device/provider live verification distinguished from mocks.

## Approved Android layout follow-up (2026-10-26)

User selected direct implementation and APK build after frontend-subagent audit. Reorganize into saved-status summary, connection settings with mode/auth, independent model section, folded advanced fields, and fixed save/test footer. Preserve all existing functionality and explicit save/inference semantics. Distinguish saved enable state from draft and actual test result. Popular presets stay available inside the picker, never misrepresented as fetched supported models. IME/small-screen layout and field-local errors must remain usable; no backend or live configuration edits. Evidence and device verification remain separate.

## Exclusions

No new schema, arbitrary upstream URL request payload, automatic model probing/capability claims, paging beyond the declared cap, paid upstream inference, credentials changes, production deployment, commits or unrelated dirty-tree cleanup.
