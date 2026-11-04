# Android UI 重构规划任务

用户于 2026-10-10 先要求规划，随后明确批准开始 UI 优化并允许并行子代理。

**完整方案：[Android 全界面 UI 重构与动效规划](../../../clients/android/ui-redesign/README.md)。**

覆盖 48 个页面/功能面板：源码功能矩阵、导航、视觉组件、逐页布局/操作/状态/动效、动画十二原则、实施阶段、风险回退与验收。

| 文件 | 职责 |
|---|---|
| [prd.md](./prd.md) | 要求、范围、约束、文档验收 |
| [design.md](./design.md) | 设计入口、技术边界与决策 |
| [implement.md](./implement.md) | 后续执行顺序、文件责任、检查与回退 |
| [research/source-audit.md](./research/source-audit.md) | 源码事实、旧规范冲突、参考 |
| `implement.jsonl` / `check.jsonl` | 后续执行与检查上下文 |

任务状态为 `in_progress`。规划文档本身已完成，按 `implement.md` 渐进实施；当前批次与验证状态记录于 [delivery-status.md](./delivery-status.md)。不代表48页全部交付。原 Android 交付任务的物理设备验收仍独立保留。
