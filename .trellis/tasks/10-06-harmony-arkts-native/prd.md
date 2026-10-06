# 鸿蒙 ArkTS 纯原生重写

父任务：`10-06-harmony-android-adaptation`（需求总纲见父 PRD；本文件只写鸿蒙侧可独立验证的交付）。

## Goal

用 ArkTS/ArkUI 纯原生重写记账 App 全量功能（与 Web PWA 对齐），产出可在 HarmonyOS 5/6（NEXT）安装运行的 Hap；鸿蒙 4 由 Android APK 覆盖，不在本任务验证。

## Requirements

- H1 网络层：baseURL 可配置（登录页填写+记忆，默认空首启必填）；`@ohos.net.http` + cookie 持久化 `jizhang_session`；所有 mutating 请求带 `X-Requested-With: fetch`；无 body 的 POST 不带 JSON Content-Type；401 回登录页；离线写操作明确报错。
- H2 功能范围：与 Android 子任务 A2–A12 逐项对等（鉴权/账单/预算/周期/统计/主数据/数据导入导出/AI 助理/物品资产+抠图/外观三态三色/导航结构），同为服务端呈现、不手写口径。
- H3 端能力映射：文件选择器（Picker）取微信/支付宝账单文件读字节上传；相机/相册取物品照片；深浅色跟随系统+手动三态；图标启动屏对齐 Web。
- H4 图表：ArkUI 原生绘制分类环形/月度柱状/结余趋势（不内嵌 WebView 套壳）。

## Constraints

- 禁止手写业务口径：同 Android。
- bundleName 拟 `com.yansuu1.jizhang`（与 APK 同名，便于用户识别；上架前可按审核要求改一次）；编译目标 API 12 起（design 中锁定 IDE/SDK 基线，建议 DevEco Studio 最新稳定版 + API 14/18 验证矩阵）。
- 鸿蒙 4 走 APK，不在本 Hap 验证矩阵内。

## Acceptance Criteria

- [ ] AC-H1 Hap 在 HarmonyOS 5/6 模拟器或实机可安装启动，登录页可填服务端地址并登录成功。
- [ ] AC-H2 登录→记一笔→预算已用变化链路可演示，数字与 Web 一致。
- [ ] AC-H3 H2 全量功能逐项可演示，无静默失败（不套壳 WebView）。
- [ ] AC-H4 lint/类型检查通过，可重复打 release Hap（含签名配置说明）。
