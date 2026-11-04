# AI 助理配置页面 Ardot 重构与 New API 极简 MVP

## Goal
彻底解决当前 Android 端 AI 助理配置页面“卡片层级繁多、参数零散冗余、手机端操作繁琐、体验简陋”的问题。
基于 Ardot 设计系统重构为面向移动端单手操作友好的极简 MVP：
提供“一键预设 / 极简模式”，专门优化对自建 **New API / One API** 及标准 OpenAI 兼容中转站的支持（只需填 Base URL、API Key、Model），收拢折叠高级冷门配置，并在保存前提供即时连通性校验与状态反馈。

## Scope
- **Android UI (`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt`)**:
  - 全面应用 Ardot 移动端设计规范（卡片圆角、视觉节奏、主次分明的操作按钮、呼吸态与输入反馈）。
  - **极简 MVP 首屏（Default / Simple Mode）**：
    1. **服务总开关**：清晰的状态切换卡片。
    2. **中转/服务商预设（Quick Preset）**：提供 `New API / 自建中转 (OpenAI兼容)`、`标准 OpenAI`、`自定义 (Custom)` 快捷单选/Segment。
    3. **核心三要素（New API 极简填写）**：
       - **服务地址 (Base URL)**：支持用户直接粘贴 `https://api.example.com`（自动规范化补齐 `/v1/chat/completions`，减少手机敲长路径的痛苦）。
       - **API 密钥 (API Key)**：安全遮罩输入、粘贴按钮、状态指示（已配置/未配置/留空保持）。
       - **模型名称 (Model)**：快捷输入/常用推荐标签（如 `gpt-4o-mini`, `deepseek-chat`, `claude-3-5-sonnet` 等点按直达，兼顾自由手填）。
    4. **直观连通性测试与保存操作**：
       - “测试连接”与“保存配置”按钮布局优化，操作状态（测试中、连通成功/耗时、错误详情）清晰在原地卡片展示，不遮挡、不突兀。
  - **高级设置折叠抽屉（Advanced Drawer / Collapsible）**：
    - 将原有自定义 Header JSON、高级 Body Template、自定义 Response Path、超时时间 (3000-60000ms)、自定义认证头等下沉为“高级选项”。平常收起，不干扰 99% 的普通用户。
- **Android 功能审计规范保持 (`clients/android/README.md`)**:
  - 维护 A038–A062 等既有端到端合约（安全内存留存密钥、hasSecret 展示、clearSecret 弹窗确认、互斥锁、错误处理），不破坏后端现有的 Fastify `/api/v1/ai/config` 协议与加解密逻辑。
- **后端协议兼容性 (`packages/server/src/services/ai-config-service.ts`)**:
  - 确保对 New API / One API 发送的标准 `/v1/chat/completions` 请求 100% 稳定兼容。

## Acceptance Criteria
- [ ] AC1: 页面采用 Ardot 规范布局，消灭原先杂乱分散的多重嵌套卡片，首屏聚焦于 New API 极简配置。
- [ ] AC2: 支持直接输入 New API 根地址（如 `https://api.my-domain.com`），客户端智能补全为标准 endpoint，免去手机端手动拼接路径。
- [ ] AC3: 常用模型提供快速填入 Tag，同时支持自由手填。
- [ ] AC4: 密钥安全展示，保留原有的修改/留空保持/清除确认机制，且界面符合移动端单手操作体验。
- [ ] AC5: 连通性测试体验升级：反馈更即时，明确显示测试状态和错误诊断。
- [ ] AC6: 高级选项（Header JSON、Body Template 等）默认折叠，不破坏已有高级用户配置。
- [ ] AC7: 单元测试全覆盖，构建及 Lint 通过，华为真机安装验证流畅顺手。

## Approved follow-up: assistant conversation correctness (2026-10-15)
User approved verifying a new conversation after configuration repair and fixing observed conversation defects.
- New live message may prepare a synthetic transaction draft only; never confirm/book a transaction. Preserve saved credentials/model.
- Failure must not imply successful execution; errors render once with safe actionable messages based on stable codes.
- Terminal progress must not crowd historical chat; running progress remains visible and unknown states must not imply success. Legacy complete only means processing ended.
- Transaction summary and operation-detail dates must be human-readable; integer-cent amounts retain correct units. Preserve tool cards, confirmation/idempotency guards, drafts and request isolation.
- Add focused server/Android tests, update affected inventory/spec, distinguish local checks from device evidence. Deployment/server recreation is not included without explicit approval.
