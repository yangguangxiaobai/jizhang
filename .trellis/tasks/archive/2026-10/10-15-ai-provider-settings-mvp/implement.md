# Implementation Plan: AI Provider Settings Ardot MVP & New API Support

- [x] 1. 编写 URL 智能规范化与 New API 预设逻辑的纯 Kotlin 辅助函数及单元测试 (`ProviderSettingsHelper.kt` / `ProviderSettingsHelperTest.kt`)。
- [x] 2. 使用 Pi 原生 `subagent`（调度 `frontend` / `worker`）协助重构 `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt`：
  - 应用 Ardot 视觉系统（卡片、色彩、状态指示 Pill、操作按钮）；
  - 接入 New API / One API 极简三要素（Base URL 智能补齐、API Key 快捷操作、常用模型 Chip 选择器）；
  - 高级设置（高级请求头、响应路径、Body 模板等）下沉为默认折叠区域；
  - 增强连通性测试交互与就地反馈。
- [x] 3. 运行本地自动化验证：
  - Android 单元测试 (`./gradlew testDebugUnitTest`)；
  - Android 编译构建 (`./gradlew assembleDebug`)；
  - Android Lint 检查 (`./gradlew lintDebug`)。
- [x] 4. 安装 APK 到物理真机（华为 nova 7 Pro），进行实际 UI 与连通性验证。
- [x] 5. 同步更新 `clients/android/README.md` 功能目录与变更日志。

## Follow-up execution (user approved)
- [x] Capture baseline and run one synthetic live message, never confirm ledger write. Result: AI_PROVIDER_TIMEOUT at 20,000 ms; chat flow not accepted.
- [x] Pi native backend/frontend agents implement disjoint files with focused tests.
- [x] Independent review; fixes for date validation, nested sensitive fields and before/after references applied. Server lint/typecheck/build + 498 tests; Android 43 unit tests/lint/assembleDebug passed.
- [x] Update affected stable inventory and spec. Follow-up build NOT installed; black/inactive phone capture prevents further rendering acceptance.
- [x] User approved backend deployment and APK installation; backend deployed and verified (see deploy-status.md).
- [x] APK installed after direct USB reconnect; installed base.apk SHA256 matches build.
- [ ] Scoped commit pending given preexisting shared-file WIP. Never include unrelated WIP.

Current follow-up status: local code/tests complete; backend deployed 2026-10-15T06:40:39Z, APK installed and byte equality verified after direct USB reconnect. Do not mark the overall conversation defect resolved: live 20-second timeout remains to diagnose independently. No timeout/model changes were made.
