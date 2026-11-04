# Native iOS design proposal

## Change boundary

Add clients/ios using existing authentication, assistant and provider APIs. No financial logic moves to Swift and no backend change is currently required. Android serves as behavior evidence; adding iOS does not fix Android.

Proposed paths:
- clients/ios/Jizhang.xcodeproj: app/test targets and shared scheme.
- clients/ios/Jizhang/App: login, session and navigation.
- clients/ios/Jizhang/Core: transport, credentials, DTOs, formatting and request identity.
- clients/ios/Jizhang/Features/Assistant: list, chat state, streaming and messages.
- clients/ios/Jizhang/Features/Settings: compact config/model picker.
- clients/ios/Jizhang/Features/Home, Bills, Plan and My: read-only presentation.
- clients/ios/JizhangTests and iOS/client/root documentation plus relevant native-client specs.

## Architecture

Use SwiftUI/system frameworks and iOS 17-compatible APIs with a checked-in Xcode project. Separate Foundation models/transport/state from views. No external UI/AI SDK is required.

App state owns server and session identity. Requests carry server/session epoch plus feature identity. Loading, empty, unavailable and failed are different states; errors must not create zero balances. Decode money as Int64 cents and timestamps as epoch milliseconds. Financial totals/windows come from the server.

Proposed tabs are Home / Bills / Plan / Assistant / My. Native navigation stacks own details. Read-only views contain no fake save/delete controls. Tools without read data show their purpose and delivery availability accurately.

## Transport/session

Use URLSession with the existing jizhang_session cookie, preserving domain/path/expiry/Secure rules. Protect persistence with Keychain scoped to server. Mutations including login carry X-Requested-With: fetch. Bodyless POST must not advertise an empty JSON document.

Restore through successful /auth/me, invalidate on 401, and clear feature/session state when changing server. Never send old credentials to another origin. Release uses HTTPS without a blanket ATS exception; credentialed redirects cannot cross origin. Redact secrets from errors/logs.

Contract evidence: .trellis/spec/backend/native-delivery.md:15; clients/android/app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt:40; packages/server/src/routes/auth.ts:52.

## Conversation list

GET /assistant/conversations returns IDs, titles and timestamps, sorted by updated time. Use those fields; no per-row message fetch or fabricated last-message preview.

Full-width rows show two title lines, time and selected state. Add title search and Today/Yesterday/Earlier groups. Create selects only a returned server ID. Archive has confirmation and pending/error feedback; retain row until success.

Source defect: AssistantTab.kt:1872 constrains ConversationChoice inside full-screen history at :1068. iOS avoids the constraint; Android remains unchanged.

## Conversation lifecycle

Follow .trellis/spec/backend/assistant-streaming.md:
1. Create a generation with stable client request ID for an unchanged draft.
2. Validate SSE version, conversation/generation identity and sequence.
3. Apply UTF-16 text offsets with surrogate boundaries; stable IDs replace provisional messages.
4. On disconnect/gap, reconcile snapshot/replay of the same generation, never auto-POST another prompt.
5. Leaving cancels subscription only; Stop explicitly cancels server generation.
6. Keep drafts/generations per conversation; reject late results after server/session changes.

Display readable text, safe errors, clarification choices and action/result previews. Historical action status is authoritative. Pending accounting actions remain previews this delivery; a finished reply is not a ledger write. Unsupported import/organization workflows have clear availability feedback.

Auto-follow on opening or while at bottom; otherwise offer jump-to-latest. Use native keyboard/safe-area handling and selectable readable text rather than raw JSON.

## Compact provider flow

Primary form: service address, secure API key and model (search/picker/manual entry). Advanced holds protocol, auth, timeout, optional name, custom headers/template/path and enabled-state management.

Read config before allowing save. Preserve unspecified fields, including redacted non-custom bodyTemplate. Blank secret keeps the stored key; clearing is explicit. Normalize supported endpoints without corrupting custom paths or query strings.

Reuse GET/PUT /ai/config, bodyless POST /ai/models and explicit POST /ai/test. Only the server contacts the provider or decrypts saved keys.

Initial connection without model offers “保存连接并选择模型”: explicitly save disabled connection, fetch metadata, open picker; selection followed by “保存并启用” completes setup. User does not need to discover disable/enable toggles. Manual model input supports direct save. Selection alone neither saves nor invokes inference.

Existing configurations require explicit connection save before discovery, without silently disabling an active provider. Preserve advanced/custom settings; custom mode retains manual entry and truthful discovery availability.

Save/discovery/test are mutually exclusive. Connection/key edits invalidate model results; failure keeps model/draft. Saved/enabled/tested are separate states. Test invokes the saved config only on explicit action, never on opening or ordinary save.

## Other domains

Inspect each current backend DTO and Android repository mapping before implementing read screens. Use server-owned plan/budget/stats totals, and handle paging/filter completeness honestly. Unsupported routes differ from empty data. Fixtures are only for previews/tests, never passed off as live account data. No preview calls an accounting confirmation endpoint.

## Validation and compatibility

No schema migration or backend contract change is planned. New client is additive. Update support documentation without claiming full Android parity.

Windows checks cannot prove SwiftUI compilation. Mac checks must cover unsigned simulator build, unit tests, small/large screens, Dynamic Type, keyboard, long chat, A/B switching, reconnect and config errors. Record actual Xcode/OS versions when executed. Signing, distribution and production changes are deferred.

Primary references checked:
- https://developer.apple.com/swiftui/
- https://developer.apple.com/xcode/system-requirements
- .trellis/spec/frontend/index.md and quality-guidelines.md
- .trellis/spec/backend/ai-provider.md, assistant-streaming.md and native-delivery.md

Apple's Xcode table requires macOS. iOS 17 is a proposed deployment baseline, not proof of an installed SDK or build.



## Approved delivery update (2026-11-04)

Build and test on GitHub macOS Actions in a personal fork under the authenticated account. Package the unsigned iphoneos Release app as Payload/Jizhang.app in Jizhang-unsigned.ipa, record SHA-256, and upload as a build artifact. Download locally and hand to the existing Sideloadly for signing/installing on the user device. Do not upload Apple credentials. Workflow permissions are contents:read and no production backend deploy occurs. Use a feature branch; do not alter upstream main. Native compilation and tests are required before reporting the IPA ready.
