# 修复规划文档核验

日期：2026-10-30；范围为本轮文档交付，没有修改产品代码或启动实施。

产物：[完整修复规划](../../../../docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md)、[模型交接索引](../repair-handoff.md)。

## 本轮结果

| 检查 | 结果 |
|---|---|
| 完整任务结构 | T01–T14，14项，顺序唯一，各有Files/Interfaces/步骤/完成标准 |
| 审查编号映射 | R01–R20全部20项；主规划与交接索引一致 |
| 依赖与验收编号 | 无前向依赖；引用的C/G编号均存在于原矩阵 |
| 路径 | 49个现有完整路径、23个明确声明为待新增的源码/测试路径；未声明缺失路径0 |
| 相对链接 | 首轮联合核验主规划/索引/PRD/design/implement的12个链接全部可达；最终新增证据链接再读回核对 |
| 文档格式 | 主规划509行；主规划/索引UTF-8、末尾换行、无行尾空白、代码围栏配对，无TODO/TBD |
| 自动上下文 | 索引5,147字节，小于32,768字节限额；完整大文档不直接列为注入条目 |
| Trellis | implement.jsonl 6项、check.jsonl 7项，验证退出码0，无截断警告 |
| 阶段 | task.status保持planning，review_status=complete / review_result=changes-required；修复规划ready-for-handoff |

路径检查中的23个“待新增”文件仅为规划声明，本轮没有创建这些产品源码或测试文件。

## 验证方法

运行只读临时Python核验：解析主规划的任务/映射表、检查依赖与原验收ID、解析反引号中的完整路径并区分“新增”、解析相对Markdown链接、核对JSON/JSONL及注入文件大小。上述检查退出码0，结果PASS。

上下文验证命令：

```powershell
python ./.trellis/scripts/task.py validate .trellis/tasks/10-30-core-finance-simplification-review
```

人工接口自审重点：Android MonthlyPlanWindow字段为from/to，工资预览窗口为start/end；公开Composable的window context不能用internal类型；ApiRequestIdentity相关接口及导入owner状态保持internal；目标operation的JSON响应经FinancialOperationResult解码；分类创建/复用单位与服务端现有字段一致。

本轮另外用Node Intl核对规划新增的缺午夜例子：America/Asuncion在2017-10-01T03:59:59Z为本地9月30日23:59:59，04:00:00Z为10月1日01:00:00，符合首个存在时刻断言。

本轮没有重跑shared/server/Android业务测试。前序审查门禁仍见 [checks.md](checks.md)；规划列出的失败回归、修复及设备步骤均留给实际实施者执行，不能从本次文档PASS推定业务已修复。
