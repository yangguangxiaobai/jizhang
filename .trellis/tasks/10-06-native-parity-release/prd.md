# 双端口径对齐与发版闭环

父任务：`10-06-harmony-android-adaptation`。依赖：Android 子任务与鸿蒙子任务均完成首轮可演示构建后，本任务才能执行对齐验证（顺序写在这里，不由目录树隐含）。

## Goal

证明双端与 Web 口径一致，并固化可重复的 release 发版流程。

## Requirements

- P1 口径对齐矩阵：同一账号、同一周期，对比 Web / Android / Harmony 三端 —— 首页总额、预算模块已用/剩余/结余池、统计三图、账户余额 total。允许的唯一差异：小数展示舍入（分→元格式化），且需注明。
- P2 对齐测试方法：以服务端 e2e 种子账本为准（`packages/server/test` 既有装置），在三端截图/记录数字，逐项打勾；凡端侧计算字段必须有 `packages/shared` 映射行。
- P3 发版规则：包名/bundleName、签名保管方式（用户本地，不入库）、versionName（与仓库版本同源）/versionCode（自增）/Hap versionCode 规则、release 构建命令、产物命名与存放位置。
- P4 文档更新：README/DEPLOY 追加双端发版章节（在用户给出新域名后一并更新域名引用）。

## Acceptance Criteria

- [ ] AC-P1 对齐矩阵全部通过（或列出已知差异+原因）。
- [ ] AC-P2 APK 与 Hap 均可重复打出 release 包（clean 后重打一致）。
- [ ] AC-P3 发版文档已更新，他人可按文档复现。
