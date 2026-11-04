# C5 统一平台导入与按需 AI 实施与验证状态

## 实施范围 (F10/F11)

1. **统一新平台账单导入入口**：
   - 新增 `PlatformImportHost.kt` (`PlatformImportEntryContext`, `PlatformImportSource`)；
   - 数据管理（DataTab）与 AI 助手的新平台账单导入均复用多文件批次工作区；
   - 默认纯人工核对：创建批次时 `analyse = false`，全程 0 次外部模型调用，无隐藏 AI 费用；
   - 严格文件约束：1–5 个文件，单文件 ≤ 5 MiB，合并总大小 ≤ 8 MiB，整批最多 500 行，超出即时拦截；
   - 取消文件选择或空选择不调用 API，不创建空会话或空批次；
   - 保留旧单文件卡片、本应用 CSV/转账 CSV 导入导出和备份合同。

2. **服务端核验与自动化回归**：
   - 新增 `packages/server/test/import-batch-manual-flow.test.ts`：端到端验证在无 AI / 禁用 Provider 情况下，完整的微信/支付宝多文件创建、逐行审查、两阶段 review-confirm 原子确认入账流程，验证模型调用数为 0，且账本账单数量仅增加所选行数；验证文件选择取消零副作用。

## 自动化测试与质量门禁证据

- **Server 测试与构建**：`pnpm --filter @jizhang/server test` 通过（46 files / 1025 tests 全绿，含 `test/import-batch-manual-flow.test.ts` 2 项）。`lint`、`typecheck`、`build` 干净通过。
- **Android JVM 测试与 Lint**：`./gradlew.bat :app:testDebugUnitTest :app:lintDebug` 干净通过，52 套测试套件全部通过（新增 `PlatformImportEntryStateTest`），lint 0 errors。
- **功能目录维护**：`clients/android/README.md` 更新 D014、D015，补全 101 个 main Kotlin 文件目录收录。

## 待实机验证事项

- 真实手机环境使用系统 SAF 文件选择器多选 1–5 个微信/支付宝账单、移除/替换文件交互。
- 弱网与文件上传大体积 Base64 进度。
- 不做生产环境发布或真机安装假定。
