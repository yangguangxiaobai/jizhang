# C4 手动存钱与投资进度简版实施与验证状态

## 实施范围 (F08/F09)

1. **shared / server 规则与接口闭环**：
   - `packages/shared/src/manual-goal-progress.ts`：纯数学与整段非负历史重放规则，应急金缺口与有条件月数估算；
   - `packages/server/src/db/migrations/020-manual-goal-progress.ts`：新增 4 张专用数据表（`manual_goal_state`, `manual_goal_openings`, `manual_goal_entries`, `manual_goal_operations`）；
   - `packages/server/src/services/financial-goals-service.ts`：支持起始值确认/更正、存取记录新增/修改/软删除、原子历史非负校验与全局修订号 CAS；
   - 修复并验证了 DELETE/PATCH 软删除后的重放幂等支持，以及在起始日期前的历史区间内输出 `not-started` 和 `balanceCents = null`。
   - `cli-db.ts` 备份恢复与完整性检查验证：`VACUUM INTO` 备份及 `restoreBackup` 对 C4 新增表全量保留。

2. **Android 客户端接入**：
   - `FinancialGoalModels.kt`：严格强类型 DTO，拒绝浮点数和静默默认值，区分 `manual-confirmed` 手动来源与 `not-started` 状态；
   - `FinancialGoalRepository.kt`：接入全部 `/api/v1/financial-goals/*` 路由并处理 404 不可用降级状态；
   - `ManualGoalProgressWorkspace.kt`：应急金卡片、投资本金卡片、存取明细列表及起始值/存取/编辑/删除弹窗，整段非负提示与操作重放；
   - `MonthlyPlanWorkspace.kt`：在“本月分配参考”和“明细工具”中无缝接入手动存钱与投资进度。

## 自动化测试与质量门禁证据

- **Shared 单元测试**：`pnpm --filter @jizhang/shared test` 通过（12 files / 385 tests 全绿）。
- **Server 测试与构建**：`pnpm --filter @jizhang/server test` 通过（46 files / 1023 tests 全绿，含 `test/financial-goals.test.ts` 29 项）。`lint`、`typecheck`、`build` 干净通过。
- **Android JVM 测试与 Lint**：`./gradlew.bat :app:testDebugUnitTest :app:lintDebug` 干净通过，51 套测试套件全部通过（新增 `FinancialGoalModelsTest` 与 `ManualGoalProgressStateTest`），lint 0 errors。
- **功能目录维护**：`clients/android/README.md` 补全 B03.13、§11.0 API 条目与 100 个 main Kotlin 文件目录。

## 待实机验证事项

- 应急金/投资起始值键盘录入、存取弹窗与删除确认在不同屏幕密度下的视觉与触摸交互。
- 弱网与离线断网情况下的重放与错误提示。
- 不作生产环境发布或真机安装假定。
