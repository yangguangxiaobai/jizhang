# 核心记账与财务规划精简任务

日期：2026-10-29；实施进度复核：2026-10-30。状态：implementation in progress；1个总任务＋5个子任务。C1本地实现/测试已完成（设备待验），C2正在实施；C3–C5尚未完成。

- [用户主 Markdown：全部精简内容、目标、任务和46项验收](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)
- [总需求 PRD](prd.md)
- [技术设计与跨任务接口](design.md)
- [执行顺序与门禁](implement.md)
- [完整验收矩阵](acceptance.md)
- [规划工件自检记录](planning-review.md)

## 子任务

| 子任务 | 目标 | 依赖 |
|---|---|---|
| [C1 核心导航与快捷记账](../10-29-core-simplify-entry-recording/prd.md) | 核心入口、折叠表单、默认账户、更多工具 | 无 |
| [C2 本月计划与工资](../10-29-core-simplify-monthly-plan/prd.md) | 一份默认计划、工资去重、用途和高级详情 | C1 |
| [C3 统计与月末复盘](../10-29-core-simplify-statistics/prd.md) | 准确金额/范围、分类账单查看 | C1、C2 |
| [C4 手动存钱与投资](../10-29-core-simplify-saving-investment/prd.md) | 起始值、存取/本金记录、目标缺口、实际完成 | C2、C3 |
| [C5 平台导入与按需AI](../10-29-core-simplify-import-ai/prd.md) | 统一新工作区、人工可用、旧卡片兼容 | C1；集成在C4后 |

每个子任务均有 prd.md、design.md、implement.md、implement.jsonl、check.jsonl 和 task.json。父任务负责整合，不代替子任务的产品实现或独立验收。

## 本轮规划工件检查

在仓库根目录运行：

~~~powershell
python .trellis/tasks/10-29-core-finance-simplification/validate_plan.py
~~~

此命令只读检查任务、需求/验收映射、上下文及文档链接，不运行应用功能测试。实施前审阅主计划中的推荐取舍；全部46项产品验收最初为未执行。
