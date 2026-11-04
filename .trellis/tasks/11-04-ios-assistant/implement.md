# Implementation and verification plan

## Gate

- [x] Inspect repository, earlier iPhone work, Android AI screens and APIs.
- [x] Persist requirements, design and execution order.
- [x] Obtain final scope approval: native iOS, functional AI chat/config, read-only other domains.
- [ ] Activate task and load trellis-before-dev before product edits.

No implementation is claimed while the gate is open. Planning is single-agent. Any later delegation must follow applicable project context/dispatch rules.

## Ordered implementation

1. Create clients/ios Xcode project, runnable shared scheme, SwiftUI app, assets and test target.
2. Implement typed transport/DTOs/errors, protected session, ownership, login/restore/logout/server switching.
3. Build five-tab shell, native details and shared loading/error/empty/date/amount components.
4. Build conversation list/create/select/archive, full-width rows, search/groups and drafts.
5. Implement generation/SSE decoding, reconciliation, cancellation, choices and keyboard/scroll-aware chat. Render action previews without unsupported execution.
6. Implement compact config, secret/hidden-field preservation, guided bootstrap/discovery, model picker/manual input and explicit saved-config test.
7. Implement server-backed read-only Home/Bills/Plan/My and domain subpages. Do not add mutations to fill display gaps.
8. Update feature inventory, README files and relevant native-client specs.
9. Run meaningful checks/review; separate Windows source checks from Mac build/device results.

## Regression coverage

- Auth headers, bodyless POST, cookie scope/expiry, server switching and 401.
- Realistic DTO fixtures: integer cents, timestamps, optional/redacted fields, safe errors.
- A → B → A with stale reads, failed archive and selection recovery.
- SSE chunk framing/Unicode, sequence gaps, final replacement, buffered mode, reconnect and Stop.
- Stable IDs and duplicate-send/clarification prevention.
- Config bootstrap, blank secret, hidden settings, endpoint normalization, failed/empty discovery, stale results and operation exclusivity.
- Read-only screens and previews cannot silently confirm accounting writes.

Use fake transport and isolated fixtures. Assert observable behavior, not source strings or mirrored implementation. No production or live inference for automated validation.

## Native verification

Planned commands from clients/ios on a Mac:
~~~sh
xcodebuild -list -project Jizhang.xcodeproj
xcodebuild -project Jizhang.xcodeproj -scheme Jizhang -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcrun simctl list devices available
xcodebuild -project Jizhang.xcodeproj -scheme Jizhang -destination 'platform=iOS Simulator,id=<available-device-UUID>' test
~~~

Use an actual available device UUID. These commands have not run. If no Mac is available, report native compilation/device acceptance pending; do not invent an IPA or treat static checks as compilation.

If a backend change becomes necessary, record expanded scope and update Android inventory/specs. Run relevant shared/server build, tests, lint/typecheck with pinned pnpm. No API change is presently planned.

## Manual acceptance and delivery

Cover small/large screens, long titles, Dynamic Type/dark mode, back/tab/keyboard, reading while streaming, slow/failing lists, create/archive, initial configuration and key preservation, custom settings, model fallback, server/session change and reconnect without duplicate inference.

Check other domains' navigation, server totals and honest empty/error/unavailable states. Record executed commands/results, actual device/OS versions, changed files and deferred checks. Keep secrets/signing material out of Git. No production deployment or release distribution.


## Approved GitHub and device execution

1. Prepare a personal build fork and feature branch using current gh authentication.
2. Add macOS workflow: generate/validate project, run simulator tests, build unsigned iphoneos Release, package IPA and upload checksums/log artifacts.
3. Push reviewed source, wait for CI, fix real compilation/test failures and rerun until green.
4. Download the IPA and verify its hash locally.
5. Load into the already-running Sideloadly. Inspect device availability and install when available; user handles any Apple authentication or iPhone trust/developer-mode prompts. Record actual installation result; absence of a device is not success.
