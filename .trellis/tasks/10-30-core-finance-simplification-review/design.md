# 实施审查方法

## Baseline and boundaries

审查合同为原计划和 `.trellis/tasks/10-29-core-finance-simplification/acceptance.md`。读取当前源码，包括未跟踪文件；原子任务中的实施状态和旧测试记录只作线索。

本任务进行证据收集和审查，产品代码修复不包含在本次检查范围。任务状态保留 planning；不通过 `task.py start` 进入产品实施。

## Review responsibilities

- Android 核心审查：C1、C2 的 UI/仓库/工资重放及作用域。
- 统计审查：C3 从 shared 窗口到 API、明细和 Android 状态。
- 导入审查：C5 从入口到人工/AI路径、批次核对和确认。
- 主会话：C2 服务端金额和冻结周期、C4 全链路、检查命令、独立核实与最终报告。

各审查者只读产品源码，由主会话统一运行构建和测试，避免 Gradle/shared dist 的并发写入。

## Evidence and contracts

沿 Storage → Service → API → UI 及反向写入追踪，重点检查整数分、普通毛收支、确认用途净额、手动本金、幂等、CAS、历史冻结和请求作用域。

每项结论使用稳定验收 ID。缺陷须有可触发行为和源码位置；设备、IME、SAF、无障碍、弱网操作的结论仅在有设备证据时记为已验证。

## Verification

使用项目现有检查命令及隔离合成账本。新测试结果写入 evidence；报告对失败、未覆盖和不成立的候选进行区分。

## Repair planning handoff

追加交付 [2026-10-30修复规划](../../../docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md)，保留以上审查方法和既有证据。

- 按14项有依赖的修复任务覆盖 R01–R20，包含工资/网络、手动目标与摘要、平台导入、历史窗口及最终证据四组责任。
- 新工资修复真实 HTTP operationId；旧无键未决工资保留人工核对，不自动补键重发，后台兼容保留。
- 手动目标与分析/文件替换分别恢复原请求；认证副作用在网络代次边界处理，取消不等于未提交。
- 预测仅使用可用当前冻结方案；月计划/复盘消费同窗口手动实际值，按账户筛选时说明目标独立范围。
- 统一人工导入，保留原哈希/revision/token/原子合同；共享宿主文件顺序修改。
- 原 review/checks/api-probes 是历史缺陷证据，修复后的绿色回归和设备结果另存，不能覆盖旧结果。

这些是规划接口与验证约束，本轮没有产品实施；当前任务仍保持 planning。

完整规划超过32 KiB自动注入上限，implement/check上下文改用 [repair-handoff.md](repair-handoff.md)；该索引保留全部问题映射并要求模型按任务读取完整规划，避免Trellis截断后半段步骤。
