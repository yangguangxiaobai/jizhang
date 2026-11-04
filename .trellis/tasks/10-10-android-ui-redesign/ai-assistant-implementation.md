# AI assistant implementation addendum — 2026-10-13

Latest delegated scope overrides prior planning-only/six-tab text. Ardot page20:1 is design evidence, not runtime acceptance.

## Boundary
Current chat embeds sessions and up to 200 editable import rows; import lacks the registry 100-ID safeguard and request ordering. Keep Repository/API and all existing actions; move selection to a fullscreen local workspace. No backend/toolchain/deployment/git operations, no new provider or persistence contracts. Volatile drafts and attachment bytes remain in the parent AssistantTab across secondary screens, not saved state. Existing dirty files are copied to ignored `.tmp-ai-ui-baseline/` before editing.

Files: AssistantTab owns conversations, action/files and asynchronous installation; feature/assistant helpers own bounded row selection/request identity and fullscreen import/category UI; MainShell only receives secondary-screen visibility/provider-entry callbacks; Android README maintains affected stable IDs; focused unit tests cover bounds/filter/date/request ordering.

## TODO
- [x] Read curated context and current audit/design; snapshot affected dirty files.
- [x] Implement independent sessions, compact chat cards, fullscreen import/category and navigation callback.
- [x] Enforce preview<=200/explicit IDs<=100/zero disabled, reconcile by action ID, normalize category text; keep duplicates/hash and terminal locks.
- [x] Guard same-ID late requests and picker completion; keep unknown outcome feedback and refresh without automatic retry.
- [x] Update function catalogue and focused helper tests.
- [x] Run testDebugUnitTest, lintDebug, assembleDebug, assembleRelease; report actual signing and pending device evidence.

## Acceptance boundary
Local build/tests do not demonstrate AI service, production writes, screen reader, font200%, IME, HarmonyOS or device motion acceptance. Do not simulate progress or silently import undisplayed rows. null/omitted IDs keep normal non-import tool semantics; imports always use explicit nonempty bounded visible IDs.

Implementation/check results and pending device acceptance: [ai-assistant-implementation-status.md](ai-assistant-implementation-status.md).
