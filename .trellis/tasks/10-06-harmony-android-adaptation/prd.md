# 适配鸿蒙和安卓两端

## Goal

为记账应用（jizhang）提供鸿蒙与安卓两端纯原生重写：鸿蒙 ArkTS/ArkUI 原生（兼容 HarmonyOS 4 / 5 / 6），安卓 Kotlin 纯原生。两端与现有 Web PWA 功能全量对齐，不做 MVP 裁剪，复用现有后端与账本口径，不分叉业务规则。

用户价值：在主力手机（安卓、鸿蒙）上有可安装、可上架、可长期维护的 App 形态，而不只是浏览器"添加到主屏幕"。

## Background（已确认事实）

- 现有形态：Vue 3 + Vite PWA（`packages/web`）+ Fastify 后端（`packages/server`）+ SQLite，同源托管前端；原生产域名 `https://jz.yansuu1.com` 目前已重新解析、暂不可用，后续用户会提供新域名（2026-10-06 确认）。因此双端不得写死服务端地址。
- 业务规则唯一实现：`packages/shared`（信封预算、退款口径、周期归属、TZ 等），web/server 均调用它，视图禁止手写聚合（README 口径与日历）。
- API 形态：`packages/web/src/api/client.ts` 为类型化 fetch 封装；所有 mutating 请求带 `X-Requested-With: fetch`（服务端 CSRF 第二层）；session cookie `SameSite=Lax`，`credentials: 'same-origin'`，同源无 CORS；非 2xx 统一为 `ApiError{status,code,message}`；断网写操作抛 `OfflineError`（在线优先，离线可看不可记）。
- 路由/API：服务端 `packages/server/src/routes/` 下有 auth/transactions/budget/recurring/stats/trash/portability/items/assistant 等；PWA Service Worker 明确**不缓存 `/api/`**（正确性 + 隐私，见 `vite.config.ts` 注释）。
- 已有移动基线：iPhone PWA（添加到主屏幕、离线提示条）、`09-11-mobile-ux`、PWA 校验脚本（`check-pwa/check-mobile/check-motion/check-color`）。
- 用户已定决策：
  - 鸿蒙：要鸿蒙原生，需要兼容鸿蒙 4 / 5 / 6 三个版本。
  - 安卓：Kotlin 原生/混合。
- 技术背景（待在 design 中落实）：HarmonyOS 4 仍兼容 Android APK；HarmonyOS 5/6（NEXT）仅运行鸿蒙原生 Hap（ArkTS + ArkUI，API 12+），与 Android 不互通。因此"兼容 4/5/6"天然对应两种包形态：Android APK（含 Kotlin）覆盖 4，Harmony 原生 Hap 覆盖 5/6。

## Requirements（已收敛部分 + 待定）

- R1 两端形态（已定）：Android 端 Kotlin 纯原生重写；鸿蒙端 ArkTS/ArkUI 纯原生重写。Android APK 覆盖安卓主流版本 + 鸿蒙 4（兼容 Android）；Harmony 原生 Hap 覆盖 HarmonyOS 5/6（NEXT）。即：4 走 APK，5/6 走 Hap。
- R2 功能范围（已定）：不做 MVP 裁剪，与 Web 全量对齐 —— 账单（收入/支出/退款/转账/标签/多账户/按月筛选）、预算（工资录入+分配模板+已用/剩余+预警+结余池+历史回看）、周期账单（到期→待确认）、统计（分类环形图/月度柱状图/结余趋势）、回收站、数据（CSV 导入导出、微信/支付宝导入、整库备份）、AI 助理（含对话中预览导入行）、物品资产（含照片与自动抠图）、外观（深浅色+三套主色）、离线语义（在线优先，离线可看壳不可写）。
- R3 后端复用（已定）：复用现有 Fastify API 与 session 鉴权，不另起协议；双端登录页支持填写/记忆服务端地址（默认空，首启必填；记住上次地址），网络层统一处理 baseURL、session cookie、CSRF 头（`X-Requested-With: fetch`）、401 过期回登录页。待新域名确定后仅改默认地址配置，不改代码。
- R4 业务口径不分叉（已定）：金额聚合、退款、周期归属、时区等继续以 `packages/shared` 语义为准；原生端禁止手写第二套口径。展示层只做服务端已算好数字的呈现；凡需端侧计算的字段必须列出与 `packages/shared` 的映射表并给出对齐测试。
- R5 端能力（已定）：相机/相册（物品照片、抠图）、文件选择（微信/支付宝 xlsx/GBK CSV 导入）、深浅色/主题（三态 system/light/dark + 三套主色钛蓝/森林绿/极简黑白）、图标与启动屏按 Web 对齐实现。导入链路已定：端侧只做文件选择+读字节+调现有服务端接口（`POST /import/platform-bills`，dry-run 预览→勾选→覆盖分类→确认导入），解析/GBK 解码/去重全在服务端，不在端侧重做。推送：首版不做系统推送，沿用应用内"待确认"（与 README 已知限制一致，后续如需推送另立任务）。
- R6 离线语义（已定）：与 Web 一致 —— 在线优先，离线可看壳、写操作明确报错不静默。
- R7 分发与签名（已定，按推荐）：首版以侧载直装验证为主（APK 直装 + Hap 直装），预留华为应用市场上架位；Google Play 暂不需要（单用户自建定位）。包名/ bundleName 统一为 `com.yansuu1.jizhang`（待用户确认归属后可改一次）；签名由用户本地生成保管，不入库；版本号与仓库 `package.json` 同源（versionName 0.1.0 起，versionCode 自增），可重复打 release 包。NEXT Hap 编译目标 API 12 起（覆盖 5/6），在 design 中锁定 IDE/SDK 基线。
- R8 质量门：两端在目标系统版本实机/模拟器可跑通；`lint/typecheck` 通过；关键链路（登录→记一笔→预算已用变化）可演示。

## Out of Scope（候选）

- 不重写服务端协议；不做多用户/同步冲突解决（超出单用户定位，如需另议）。
- 暂不含 iOS 原生（已有 PWA 路线）。
- 抠图推理服务仍走现有可选私有服务，不在端侧重做模型。

## Acceptance Criteria（草案）

- [ ] AC1 Android 包在主流安卓版本 + 鸿蒙 4 设备可安装，登录后完成记账主链路。
- [ ] AC2 鸿蒙原生包在 HarmonyOS 5/6（NEXT）设备/模拟器可安装，登录后完成记账主链路。
- [ ] AC3 两端金额/预算口径与 Web 一致（同一账号同一周期数字对得上）。
- [ ] AC4 首版功能清单（R2 全量）逐项可演示，无静默失败。
- [ ] AC5 分发物（APK/Hap）签名与版本号规则明确，可重复打 release 包；包名/bundleName、`versionName/versionCode` 与仓库版本同源。

## Open Questions（按优先级）

1. （已决）首版功能范围：全量对齐，不做 MVP 裁剪。
2. （已决）复用形态：纯原生重写 UI + 直调 API（双端重写，无混合套壳）。
3. （已决）后端连接：服务端地址可配置（登录页可填+记忆），默认地址待新域名确定后填入；当前老域名已重解析不可用，不作为默认写死。
4. （已决）导入链路：端侧只做文件选择+读字节，解析/去重/预览全走服务端现有接口。
5. （已决，按推荐）推送与后台：首版不做系统推送，沿用应用内"待确认"（README 既有架构决策；推送如需另立任务）。
6. （已决，按推荐）分发：首版侧载直装为主，预留华为应用市场位；Google Play 暂不需要；包名/bundleName 拟 `com.yansuu1.jizhang`；签名用户本地保管；版本号与仓库同源。
