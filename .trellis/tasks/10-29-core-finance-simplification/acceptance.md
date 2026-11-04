# 功能与集成验收矩阵

日期：2026-10-29；实施起始：2026-10-30；修复轮复核：2026-11-01。全部用例初始为未执行；当前按子任务执行并仅在证据达标后更新状态。

每条通过后记录：验证日期、代码/服务/APK版本、合成账本或fixture、命令/操作步骤、结果及证据路径。证据放在实际执行子任务的 evidence/ 中；未执行不得写PASS。自动化和真机结果分别记录。

状态记法：`AUTO-PASS` = 自动化命令已通过（见 `.trellis/tasks/10-30-core-finance-simplification-review/evidence/repair-checks.md`）；`DEVICE-PENDING` = 该条含设备专属行为，真机未执行。任何条目在设备证据补齐前**不得**标记 PASS。

自动化门禁基线（2026-11-01）：shared 388 项、server 1038 项、Android 570 项全部通过；Android lint 0 错误；shared/server/Android 均构建成功。计数与命令见 `evidence/repair-checks.md`。

## 固定合成账本

- Asia/Shanghai；普通账户A初始0；记录工资10000元，不另建普通工资收入。
- 默认四用途：成长2500、应急1500、必要5000、随心1000；消费预算6000。
- 必要消费3200、随心600；另一独立退款fixture：支出100、退款30、确认原单归属。
- 应急起始12000、目标必要开支5000×5；本期存1500/取1000。
- 投资本金起始5000，本期投入2500/取回1000；不输入收益或市值。
- 日期fixture：2026-10-29 12:00 +08；跨年2026-12/2027-01；固定起始日25。
- 导入使用去敏合成微信/支付宝CSV/XLSX，包含空备注、新类别、重复/冲突、退款和超过首屏的行。

## C1：入口与快捷记账

| ID | 功能/验收操作 | 必须得到的结果 | 证据 | 状态 |
|---|---|---|---|---|
| C1-01 | 冷启动后查看底部并分别打开计划/＋ | 首页、账单、＋、计划、我的；＋保存后回来源 | 真机；构建 | 未执行 |
| C1-02 | 从更多进入AI/物品/旧模板，再返回和滑动计划 | 工具可访问，来源恢复，隐藏页不截获触摸/无障碍 | 真机；已有状态测试 | 未执行 |
| C1-03 | 默认元数据下记录20元普通支出 | 金额→分类→保存，最多3个业务步骤；按键数量不充当额外产品步骤 | 真机录像 | 未执行 |
| C1-04 | 填备注/标签/用途，反复折叠并切换键盘 | 金额、元数据与用途均保留，保存载荷准确 | JVM行为；真机IME | 未执行 |
| C1-05 | 删除最近账户，或切换服务/用户后新记一笔 | 选择本作用域可用账户；无账户明确阻止 | JVM选择逻辑；真机 | 未执行 |
| C1-06 | 从支出发起退款，原账户分别可用/不可用 | 正确预填原单；不可用明确拒绝，不换其他账户 | JVM退款；API；真机 | 未执行 |
| C1-07 | 从首页/列表新建编辑取消保存、关闭详情 | 返回来源，筛选、滚动、记录保持；无双提交 | 真机；编辑器行为测试 | 未执行 |
| C1-08 | 检查低频工具及已有资料 | 物品照片/抠图、图标和旧模板均可访问，核心页无新增堆叠 | 真机；目录复核 | 未执行 |

## C2：月计划与工资

| ID | 功能/验收操作 | 必须得到的结果 | 证据 | 状态 |
|---|---|---|---|---|
| C2-01 | 10000元工资明确纳入周期 | 四项2500/1500/5000/1000守恒，消费6000；读取不写入 | shared金额；API；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C2-02 | 必要3200、随心600 | 两项剩1800/400，合计剩2200，无旧信封叠加 | shared/API；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C2-03 | 从收入入口录工资，再读交易/余额/统计 | 单一工资事实，A增加10000、总收入10000，无第二笔普通收入 | API整集断言；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C2-04 | 原周期消费100，后期退款30并明确分摊 | 普通毛支出100/退款收入30；原用途/原周期净消费70 | shared/refund API；真机标签 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C2-05 | 无当月工资仅有旧周期；另测25日起始与跨年 | 无自然月当前方案不借旧方案；自定义显示冻结真实范围 | API窗口；JVM解码；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C2-06 | 未分类、退款未分摊、工资编辑/删除 | 待核对状态，remainingCents=null；旧冻结决策不静默重写 | API故障/生命周期；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C2-07 | 进入旧信封/结余池/测算/多修订历史 | 旧金额/快照仍可查，明确工具标签；不能成为第二份消费预算 | 旧API回归；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C2-08 | 正常seed默认模板；再移除/失效模板fixture | 正常无需进管理页；缺失清楚修复且零写入，不自动造分类 | seed/salary API；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C2-09 | 工资/计划分别双击、断网及重放；跳过纳入 | 相同key分别一次，失败不再建工资，跳过不产生周期 | API幂等；JVM重放；真机弱网 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |

## C3：统计与复盘

| ID | 功能/验收操作 | 必须得到的结果 | 证据 | 状态 |
|---|---|---|---|---|
| C3-01 | 工资＋普通收入＋退款＋毛支出fixture | 收入包含工资/退款；支出为毛额；退款子项和名称准确 | stats API；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C3-02 | 默认打开本月，再查看历史趋势 | 本月排行与默认6月趋势，趋势范围与选月锚点清楚，更多折叠 | API endMonth；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C3-03 | 固定now=10-29 12:00 +08，选择近30天和跨年月份 | last30=9-29 12:00至10-29 12:00；月窗口半开，设备时区不改变服务端金额 | shared窗口/API；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C3-04 | 选择账户/分类进入含超过500行的明细 | from/to/category/account一致；合计相等；不只显示首批并称全量 | API/loader边界；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C3-05 | 查看结余池和账面结余 | 池在高级预算仍可查；账面结余不标实际存款 | 旧pool回归；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C3-06 | 空范围/快速切月/慢失败/关闭详情/返回统计 | 标签与当前数据相匹配，错误可重试，旧位置保留 | 请求状态测试；真机 | AUTO-PASS（JVM）+ DEVICE-PENDING |
| C3-07 | AI未配置时打开月末消费复盘 | 确定性top类别/可支持预算提示及来源可读；不足明确标注 | API/无模型调用；真机 | AUTO-PASS（server）+ DEVICE-PENDING |

## C4：手动实际进度

| ID | 功能/验收操作 | 必须得到的结果 | 证据 | 状态 |
|---|---|---|---|---|
| C4-01 | 应急起始12000，存1500取1000 | 应急记录12500；期间净存入500；账户/交易/工资不变 | shared/API整集；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C4-02 | 投资起始5000，投2500取回本金1000 | 投资记录本金6500；期间净投入1500，不含收益 | shared/API；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C4-03 | 必要5000、目标5月、应急12000、参考存1500 | 目标25000，48%，缺13000，9次假设投入；基准缺失或参考0时不猜ETA | shared精度/缺失；真机 | AUTO-PASS（shared/server）+ DEVICE-PENDING |
| C4-04 | 超额取出、负数/非分精度、早于起始或未来日期 | 验证失败，业务行及operation记录均无部分写入 | API事务/边界 | AUTO-PASS（server/JVM） |
| C4-05 | 编辑/删除旧存入导致后续取出无余额 | 整笔拒绝；合法修改正确重算并保留历史/软删除事实 | shared历史/API事务 | AUTO-PASS（shared/server） |
| C4-06 | 有旧测算备用金和预测，未确认新起始/记录，推进时钟 | 不自动迁移，不随时间增长；明确手动来源 | API零写入；JVM展示；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C4-07 | 成长参考2500，技能消费500，投资2000，另测目标间挪动 | 技能不生成本金，不声称成长执行100%；两目标不冒充核验资产/净储蓄率 | API与文案；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C4-08 | 同key重放/不同载荷、并发revision；升级旧库后备份恢复 | 相同一次、冲突拒绝，完整记录及重放保存；旧账本金额不改 | API/迁移/恢复；真机未知结果 | AUTO-PASS（server/JVM）+ DEVICE-PENDING（未知结果/备份恢复） |

## C5：平台导入与AI

| ID | 功能/验收操作 | 必须得到的结果 | 证据 | 状态 |
|---|---|---|---|---|
| C5-01 | 数据/AI入口选1份或多份微信/支付宝文件；取消picker | 新统一工作区；取消无空会话/批次；上下文返回正确 | API调用计数；真机SAF | AUTO-PASS（JVM/API）+ DEVICE-PENDING（SAF 取消） |
| C5-02 | AI未配置/关闭完成人工parse→review→confirm | 财务确认成功，analyse/generation/Provider调用计数0 | API mock/wire；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C5-03 | 1–5文件、5MiB单/8MiB总/500行与各超限fixture | 兼容现有限额；超限整批拒绝不截断，人工可用 | 导入limits回归；真机错误 | AUTO-PASS（server）+ DEVICE-PENDING（错误提示） |
| C5-04 | 原空备注、异常/冲突、新类别及跨页编辑 | 全部行可查看，草稿和原备注准确，用户排除和规则忽略分开 | wire/state；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C5-05 | 进入review，确认新类别，再改变原件/令牌 | 权威汇总正确；批准后创建；改变原件/过期令牌拒绝且零部分入账 | confirm原子API；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |
| C5-06 | 双击、断网未知、批次revision冲突、分析失败 | 原批次核对，不重复入账/重发模型；分析失败仍能人工核对 | API/state；真机弱网 | AUTO-PASS（server/JVM）+ DEVICE-PENDING（弱网未知） |
| C5-07 | 打开旧单文件待确认卡、本应用账单/转账CSV与备份 | 各旧合同保留，不被强行当平台格式解析 | 旧回归；真机 | AUTO-PASS（server）+ DEVICE-PENDING |
| C5-08 | 手填/拉取搜索模型、关闭草稿开关、保存/测试高级配置 | 已有功能有效，草稿与真实状态清楚；新入口不引入隐藏调用 | Provider/state回归；真机 | AUTO-PASS（server/JVM）+ DEVICE-PENDING |

## G：跨任务验收

| ID | 操作/验收结果 | 必需证据 | 状态 |
|---|---|---|---|
| G01 | 合成账本完整执行工资→计划→支出→退款→统计→手动存投→复盘，逐项对照上述固定金额 | API快照、JVM结果、真机录像 | AUTO-PASS（`core-finance-repair-integration.test.ts` 跨域链路：手动目标起始/存入精度/人工导入/去重分类计数/事后余额一致）+ DEVICE-PENDING（真机录像） |
| G02 | 毛收支、净用途、手动进度及假设预测标签/来源不同且无重复合计 | contract断言、页面截图 | AUTO-PASS（shared/server contract）+ DEVICE-PENDING（页面截图） |
| G03 | shared/server全量及Android相关门禁通过，工资/转账/退款/历史/备份金额保持 | 新命令日志与报告，非历史计数 | AUTO-PASS（shared 388 / server 1038 / Android 570 / lint 0 错误 / 三端构建均 exit 0，见 `evidence/repair-checks.md`） |
| G04 | 旧服务器对新月计划/目标接口404或能力不支持，仍可用旧工具，不生成假0进度 | 旧服务fixture、设备错误图 | AUTO-PASS（server 兼容回归）+ DEVICE-PENDING（设备错误图） |
| G05 | 慢响应、A→B服务/用户切换、401、取消与未知结果均不串草稿/数据、不重复写入 | owner/replay测试、真机弱网 | AUTO-PASS（`ApiTransportTest`/`AssistantBatchRecoveryStateTest`/`ManualGoalOperationReplayTest`）+ DEVICE-PENDING（真机弱网） |
| G06 | 所有改变的稳定ID、入口、字段、API、缺口已按源码复核；本地/真机/部署分别记录 | inventory diff、任务evidence索引 | AUTO-PASS（`clients/android/README.md` 增补 113 文件目录与 T09–T12 变更日志；`evidence/repair-checks.md`/`repair-closure.md` 分级记录）+ DEVICE-PENDING / 未部署 |

## 验收状态规则

单元/API通过只能勾对应自动化证据；涉及触摸、IME、SAF、小屏、无障碍、返回和弱网的用例需要设备证据。迁移/恢复用隔离合成库，生产账本不作测试库。用户未授权生产部署，需另行批准。父任务产品验收须全部46条满足，不能以文档齐全或APK可构建代替。

**2026-11-01 修复轮补充**：本轮仅补充 SOURCE 与 AUTOMATION 证据（命令、计数、exit code 见 `.trellis/tasks/10-30-core-finance-simplification-review/evidence/repair-checks.md`，逐项 R01–R20 对照见同目录 `repair-closure.md`）。带 `DEVICE-PENDING` 的条目一律**不得**视为通过；当前无可用真机，未部署、未安装。46 条中凡含设备专属行为者（C1 全部、C2-09、C3-03/06、C4-08、C5-01/03/06、G01/G02/G04/G05/G06）仍为未完成状态。
