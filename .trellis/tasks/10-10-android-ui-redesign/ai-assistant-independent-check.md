# Independent AI assistant check

## TODO
- [x] Load task/check context, implementation status and audit/design; inspect git state and compare scoped files with `.tmp-ai-ui-baseline/` (not HEAD).
- [ ] Review retained features, navigation, selection/fingerprint, attachments and async lifecycle; fix scoped defects and add regression coverage.
- [ ] Run unit tests, lint, debug/release builds and read-only adb device listing.
- [ ] Record actual results and pending device/platform acceptance.

## Change boundary
Only AssistantTab, MainShell if needed, feature/assistant helpers/tests and Android README are eligible for code/catalogue changes. No API/repository/toolchain changes, production requests, device installation, commits or agent dispatch. Request ownership/display invalidation and current-conversation recovery belong to AssistantTab and its existing request gate. The review baseline is the saved pre-delegation working tree, not HEAD; unrelated dirty changes are preserved.
