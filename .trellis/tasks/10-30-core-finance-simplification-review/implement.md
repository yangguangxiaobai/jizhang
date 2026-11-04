# 审查执行清单

- [x] 加载计划、原验收矩阵、相关子任务合同和规范。
- [x] 获得审查任务创建同意，建立审查范围。
- [x] 分配只读 Android、统计、导入审查；主会话核对月计划服务和手动目标。
- [x] 完成 C1–C5 及 G01–G06 的证据映射。
- [x] 独立确认所有准备报告的缺陷。
- [x] shared build/test：385 个测试通过。
- [x] 完成下列其余本地门禁并记录结果。
- [x] 编写 review.md，说明功能偏差、符合项、设备和文档证据缺口。

## Commands

仓库根目录：

```powershell
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/shared test
pnpm -r run lint
pnpm -r run typecheck
pnpm --filter @jizhang/server test --maxWorkers=2
pnpm --filter @jizhang/server build
```

Android：

```powershell
./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

产品修复及生产操作不在本清单中。发现问题先保留证据，不默默改写原任务的验收状态。

## 追加交付：修复规划

- [x] 以已完成审查及原已批准设计为基线，编写 `docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md`。
- [x] 按 R01–R20 组织14项修复任务，保留 C/G 验收对应关系与共享文件顺序。
- [x] 明确旧无键工资处理、原请求恢复、真实金额解析、同周期目标与人工导入边界。
- [x] 完成路径/链接/类型/依赖及覆盖自审，验证 Trellis 上下文并记录本轮文档验证。
- [x] 完成修复规划交接稿及精简模型索引，交付主文档链接；当前审查任务保持 planning，不启动产品实施。

文档验证：`python ./.trellis/scripts/task.py validate .trellis/tasks/10-30-core-finance-simplification-review`，另核对所有现有文件和明确标为新增的路径、R01–R20及T01–T14覆盖。业务测试数据仍引用前序 evidence，本轮没有业务源码修改，不重复声称新的业务门禁结果。

核验结果见 [修复规划文档核验](evidence/repair-plan-checks.md)。完整主文档超过32 KiB注入限额，已使用5,147字节的 repair-handoff.md 代替整文件自动注入；implement/check上下文再次验证通过，没有截断警告。
