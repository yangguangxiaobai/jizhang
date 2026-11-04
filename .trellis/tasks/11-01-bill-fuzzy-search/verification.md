# 账单模糊搜索验证记录

## 本地验证（2026-11-01）

- 服务端：lead 最终复跑 `pnpm --filter @jizhang/server test`，49 文件 / 1047 测试通过；`pnpm --filter @jizhang/server build` 通过。覆盖字面文本/金额及 NUL、历史分类账户、跨页快照与统计、同数替换、退款变化、10000/10001 条和 16 MiB 边界。
- 服务端修改文件定向 lint 通过。全量 lint 失败于已有未跟踪 `packages/server/test/financial-goals.test.ts:1177` 未使用变量 rev；全量 typecheck 失败于已有未跟踪 `packages/server/test/salary-operation-replay-regression.test.ts:233` TS2532；这些文件非本任务修改，未擅改。
- Android 最终 `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug '-Pkotlin.incremental=false' --rerun-tasks` 通过；lead 独立读取 XML 核对 63 suites、580 tests、0 failure/error/skipped。lint 0 errors / 43 warnings；Debug APK 22,112,428 字节，SHA-256 `E29593BE7FE956F25C142514CA1854EEA3CBD19251EB7924A34CEC66D76B7C4A`。
- 初次聚焦 Android 测试链接旧 Kotlin ABI 报 4 个 NoSuchMethodError；禁止增量并强制重编译后的完整门禁通过。源码连线/JVM 测试不是设备触摸测试。
- 独立跨端静态复核：未发现剩余阻断项；月搜索摘要核对后才发布，变化/400 清空；旧后端缺标记拒绝；全历史不请求月摘要。
- 本机内存数据库合成测量（非生产/非硬实时）：10000 条全部匹配约 57–61ms/页；100000 条预检拒绝约 42–44ms；真实磁盘、匹配复杂度、退款及账本规模可改变结果。

## 范围与未完成验证

- 没有生产部署，没有安装新 APK，没有进行真机交互；生产仍需部署配套服务端后才能使用新版 APK 搜索。
- 未对生产账本执行读取或写入；未更改数据库 schema。
- 保留原有未提交及未跟踪工作区内容。服务端完整 lint/typecheck 上述两个既有错误仍待后续独立处理。
