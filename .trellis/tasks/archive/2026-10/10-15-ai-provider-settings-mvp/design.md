# Technical Design: AI Provider Settings Ardot MVP & New API Support

## 1. 架构目标与交互演进
当前 `ProviderSettings.kt` 存在以下主要体验缺陷：
1. **卡片层级割裂**：启用开关卡、模式选择卡、字段卡、认证卡、高级卡、操作卡平铺展开，信息密度过大，手机端需要大幅反复滚动；
2. **缺乏预设与辅助**：要求用户手敲完整的 `https://.../v1/chat/completions`，在手机键盘上极易输错；
3. **视觉风格老旧**：未使用项目统一的 Ardot 规范（统一圆角、柔和表面背景、统一的 Primary/Accent 风格）。

### 设计核心点：
- **Ardot 设计语汇融合**：
  - 卡片：统一使用带有轻微边框或柔和底色的卡片（仿照 `AssistantImportWorkspace` 的精致风格）；
  - 视觉节奏：分块清晰（服务状态 → 快捷中转配置 → 连通性测试与保存 → 折叠高级参数）；
  - 触控友好：输入框附带一键清空/快捷粘贴辅助，常用模型单选标签。
- **New API 极简模式 (Quick Setup)**：
  - 自动识别或一键填入：当用户填入 `https://api.example.com` 或 `https://api.example.com/v1` 时，保存或测试时自动规范化为有效的 OpenAI 兼容 endpoint：
    - 若以 `/v1/chat/completions` 结尾，保持原样；
    - 若以 `/v1` 结尾，补齐 `/chat/completions`；
    - 否则补齐 `/v1/chat/completions`。
  - 常用模型快捷 Chip：提供例如 `gpt-4o-mini`, `gpt-4o`, `deepseek-chat`, `claude-3-5-sonnet`, `qwen-plus` 等一键填入，点击直接将文本填入模型输入框，减少键盘输入。
  - 认证方式默认为 `bearer`，隐藏无用的认证类型选项（仅在高级展开中可见）。
- **向后兼容与原有合约保护**：
  - 完全兼容 Fastify 后端 `ai-config-service.ts` 的存储结构（`mode`, `url`, `method`, `auth`, `model`, `timeoutMs`, `headers`, `bodyTemplate`, `responsePath`）；
  - 保留 A038–A062 特性：密钥仅在普通 Compose 内存中暂存；离开保存前提示；清除密钥需要安全确认弹窗；测试只针对服务端已保存配置等。

## 2. 状态模型 (State Model)
重构 `ProviderSettings` 内部状态解耦：
- `QuickPreset`：`NewApi` (推荐默认), `OpenAI`, `Custom`
- `BaseUrlState`：用户输入的快捷 Host/Base URL 与底层的真实完整 URL 智能双向映射
- `ModelPresets`：常用模型列表，点击即应用

## 3. 回滚与安全
- 纯客户端 UI 重构与前端数据映射，不改变 SQLite 表结构与服务端加解密逻辑；
- 若配置解析异常，有防御性降级与重试机制。

## Approved follow-up boundary
Smallest gaps: route catches mark failed processing complete; Android renders both error.text and error.message; raw date values bypass existing formatters; historical terminal progress consumes full cards.
Backend ownership: assistant route/type/progress contract and focused tests. Add failed progress state with safe error-code mapping, no raw provider payloads/logging or financial rule changes, no DB schema migration. Preserve legacy complete records and confirmation guards.
Android ownership: AssistantTab presentation + small pure helpers/tests and inventory. Hide terminal progress, show running/unknown as appropriate, render one safe error with refresh/settings guidance (no automatic financial retry), reuse formatDate/formatYuan for known keys in summary and operation details.
Baseline captured under ignored artifacts/ai-chat-fix-baseline before edits. Prior unrelated dirty hunks preserved. Main session owns task/spec docs and device test. No server deploy or credential extraction.
