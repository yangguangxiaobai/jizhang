# 核心记账与财务规划精简实施审查

日期：2026-10-30。基线：main，`bde9a18da5ef33567f52fb544f181479cd4aedf3`，包括开始审查时已有的 329 项工作区改动及未跟踪源码。

**结论：主要模块已经实现，但还未完全符合计划。工资保存存在重复入账风险；月计划刷新、手动进度接入、导入入口和未知结果恢复仍有缺口。** 本次只读审查业务源码，新增的是审查任务、报告和隔离复核材料。

shared 385、server 1025、Android 518 个测试通过，合计 1928 个；lint、类型检查及构建通过。测试通过不能替代下列实际调用路径检查，也不能代表设备验收通过。

## 已实现的主要行为

| 范围 | 当前源码及本地检查支持的结果 | 仍受影响的验收 |
|---|---|---|
| C1 | 核心底栏与计划入口；更多工具；备注/标签/用途折叠保留；默认账户按作用域选择；原账户不可用的退款阻断 | 外层返回守卫；三步记账、小屏、IME、触摸和无障碍待设备验证 |
| C2 | 服务端消费预算为必要＋随心；复用完整净执行事实；待核对时精确剩余为 null；只读、不借旧周期、不叠加信封；旧工具可达 | 工资重放键、摘要刷新、失效模板修复、确认窗口时区 |
| C3 | 普通毛支出与工资/退款收入；服务端近30天窗口；默认六个月趋势；同范围分类明细及完整分页；结余池归入高级预算；无 AI 消费复盘 | C4 实际存投复盘接入；少数历史时区边界；设备返回与位置保留 |
| C4 | 独立手动事实表；显式起始值；存取与本金；CAS 和服务端同键重放；历史负余额整体拒绝；历史窗口未开始状态 | 客户端未知结果恢复、同周期展示、历史分页、精度和预测来源 |
| C5 | 数据页人工导入；服务端限额、完整行、权威 review、分类批准、原件哈希/修订/令牌保护、原子确认与确认重放；旧卡片、CSV、转账、备份和 Provider 设置保留 | AI 入口未统一；按需分析与未知结果、附件作用域、返回、替换恢复及核对展示 |

## 需要处理的偏差

### R01 · P1 · 工资幂等键没有发到服务端

位置：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryOperationReplay.kt:25`；`SalarySheet.kt:119`、`:576`；`repo/FinancialExecutionRepository.kt:230`；`packages/server/src/services/salary-service.ts:286`。

`SalaryCreateRequest.build()` 只把表单输入复制进请求 JSON，`operationId` 保留在本地对象。生产 gateway 把 JSON 原样发送，服务端因此进入兼容旧客户端的无键创建路径。首次入账但响应丢失后，重试或重启恢复会再次创建工资，工资、账户余额与收入可重复增加；查本地操作 ID 也找不到服务端结果。

隔离 API 复核：同一无键载荷发送两次新增 **2** 行；带同一个 `operationId` 则新增 **1** 行。需修复实际发送载荷，并覆盖 HTTP JSON、响应丢失和重启恢复。现有 FakeGateway 测试检查本地 operation 对象，未发现请求字段缺失。

验收：**C2-03、C2-09、G05**。证据：[api-probes.json](evidence/api-probes.json)。

### R02 · P2 · 支出保存和执行工具修改后，月计划仍显示旧摘要

位置：`ui/MonthlyPlanWorkspace.kt:83`；`ui/MainShell.kt:148`、`:334`；`ui/FinancialExecutionWorkspace.kt` 各修改后的 onSaved 接线。

从计划页中央＋保存支出后，`ledgerRefreshToken` 只传给首页/账单，没有传给财务宿主。月计划读取只依赖 repository/retry，执行工具内部刷新也没有使摘要失效。已花 3200＋600 后可继续显示旧的已消费/预算剩余，且没有过期标记；需手动刷新才能看到 3800/2200。工具内确认工资周期、退款和配置修改同样受影响。

验收：**C2-02、C2-04、C2-06、G01**。应接入统一的保存失效通知或在工具返回时刷新，并验证实际父子页面接线。

### R03 · P2 · 手动存投的未知结果被保存，却没有恢复入口

位置：`ui/ManualGoalProgressWorkspace.kt:273`、`:322`、`:353`、`:394`；`repo/FinancialGoalRepository.kt:124`；`ui/FinancialExecutionWorkspace.kt:189`。

四种写操作都会记录 PendingFinancialOperation，但失败后只显示错误；该工作区没有扫描、查询或重放原操作的逻辑。`FinancialGoalRepository.operation()` 没有调用者，旧执行工作区还明确排除了 financial-goals 的待处理记录。首次写成功、响应丢失时，再次保存会生成新 UUID；旧 revision 先导致冲突，刷新后重录可能重复增加手动进度。一般 4xx 失败也不会清除这些无效待处理记录。

验收：**C4-08、G05**。应按原键先核对结果，再提供同请求恢复；明确区分失败、未知和已确认。待重放载荷中的备注也应通过 JSON 编码保存，当前字符串插值不能保证含引号/换行备注的精确恢复。

### R04 · P2 · 旧请求的401会退出新会话

位置：`net/ApiClient.kt:127`、`:300`；`MainActivity.kt:45`、`:68`；`repo/AuthRepository.kt:47`。

同一个 ApiClient 跨登录会话复用。A 的普通请求使用同步 OkHttp；退出/换服务/登录 B 后，A 的延迟401仍无条件清空当前 cookie jar 并设置 sessionExpired，导致 B 被退出。页面 owner 检查无法撤销拦截器已经发生的副作用。

验收：**G05、C3-06**。应在网络认证边界核对请求所属的服务及会话代次；现有“不相关 cookie 不清会话”测试未覆盖延迟401。

### R05 · P2 · 外层导航绕过财务和导入离开守卫

位置：`ui/MainShell.kt:109`、`:494`；`ui/feature/imports/PlatformImportHost.kt:95`、`:111`；`ui/feature/assistant/AssistantBatchImportWorkspace.kt:399`；`ui/MyTab.kt:122`。

财务工具有草稿或未知请求时，底栏 selectTab 直接销毁宿主，没有咨询 scenarioGuard/executionGuard。数据导入主列表从 PlatformImportHost 提前 return，未注册宿主 BackHandler；批次工作区只对编辑/比较/review 子视图处理 Back，系统返回因此关闭整个数据页。AI 外层返回按钮也无条件关闭 Assistant。上述路径会丢失草稿、原件内存和正在进行的确认恢复状态，而不是按页面的离开约束处理。

验收：**C1-02、C2-07、C5-01、C5-04、C5-06、G05**。源码路径已确认，实际系统返回、触摸和弱网操作仍需设备验证。

### R06 · P2 · 默认模板失效后没有进入修复状态

位置：`ui/SalarySheet.kt:1590`、`:1251`、`:477`；`packages/server/src/services/salary-service.ts:411`。

可用性只检查模板 ID 和非空 modules，引用已删除分类的默认模板仍被预选。修复按钮只在 defaultTemplate 为 null 时出现；保存得到分类错误后，仍维持“可用模板”状态。服务端确实拒绝并零写入，但没有计划要求的明确修复入口。

验收：**C2-08**。应依据当前可用分类验证模板，或把确定的模板失效错误转入修复流程。

### R07 · P2 · 工资确认窗口使用设备时区

位置：`ui/SalaryFinancialPrompt.kt:247`；`ui/format.kt:20`。

冻结上海时间10月25日零点至11月25日零点，设备为 UTC 时，formatDay 会显示10月24日至11月24日；也未说明冻结时区和排他终点。月计划服务端标签本身正确，工资确认却展示了另一组日期。

验收：**C2-05**。应使用冻结周期 timeZone 或服务端标签，不能用设备默认时区格式化。

### R08 · P2 · C4实际进度没有接入同周期计划和复盘

位置：`ui/ManualGoalProgressWorkspace.kt:119`；`ui/MonthlyPlanWorkspace.kt:275`；`ui/StatsTab.kt:235`、`:263`；`repo/FinancialGoalRepository.kt:13`。

目标 API 已支持 from/to 和期间净存入/净投入，客户端只调用无窗口的 load()，显示累计数。月计划只有跳转链接，统计复盘只有“请以手动确认进度记录为准”的说明，没有读取目标数据。因而不能按所选周期比较计划预留和实际存投，也缺少 C4 应补齐的月末实际净存入/本金净投入。

验收：**C4-01、C4-02、C4-07、G01** 及父设计 §4。API 复核已正确返回应急12500元/本期净存500元、投资6500元/本期净投入1500元，缺的是页面消费这些结果的接线。

### R09 · P2 · 手动历史只显示首100条

位置：`ui/ManualGoalProgressWorkspace.kt:122`、`:241`。

读取 listEntries(limit=100).items 后丢弃 hasMore/nextCursor/total，没有下一页或完整读取。超过100条后，较早记录在界面中不可查看、更正或删除；“明细记录”也没有说明截断。

验收：**C4-05、G06**。应提供有界分页和加载状态，并保留全历史操作入口。

### R10 · P2 · 手动金额接受超过分精度的输入并取整

位置：`ui/ManualGoalProgressWorkspace.kt:799`。

parseYuanCents 使用 Double 和 Math.round。输入1.234元会被静默保存为123分，未按 C4 的非分精度拒绝要求处理；起始值、新记录和编辑均共用该函数。服务端只收到取整后的合法整数分，不能再发现原输入问题。现有状态测试里的 parseYuan 是测试自身重写的函数，没有执行这个生产解析器。

验收：**C4-04**。应验证小数精度并进行精确十进制转换，测试真实解析函数。

### R11 · P2 · 应急预测把历史周期预留称为当前月计划

位置：`packages/server/src/services/financial-goals-service.ts:802`；`ui/ManualGoalProgressWorkspace.kt:475`。

参考额取任意 financial_period_revisions 中最近创建的记录，没有筛选包含当前时刻的活跃周期；界面却写“按当前月计划预留”。隔离正常 API 流程只确认9月周期，10月 monthly-plan 明确返回 no-period，目标 API 仍返回每月1500元参考和9次估计。历史修订晚于当前修订时，也可能换成历史金额。

验收：**C2-05、C4-03、G02**。应对齐当前冻结计划，或明确提供历史来源并由用户确认预测假设。手动实际余额没有被自动增长；问题在预测来源与标签。

### R12 · P2 · 导入入口未统一，按需AI两端行为不一致

位置：`ui/AssistantTab.kt:780`、`:1469`；`ui/DataTab.kt:138`；`ui/feature/assistant/AssistantBatchImportWorkspace.kt:875`；`packages/server/src/routes/import-batches.ts:181`。

AI 页选择1–5份文件后，通过通用“发送”按钮直接 createImportBatch(analyse=true)，没有进入 PlatformImportHost 或显式分析选择，服务端自动启动模型分析。数据页正确使用 analyse=false，但新批次状态为 idle，工作区唯一分析按钮只在 failed 分支出现，因此人工导入后又无法主动选择 AI 整理。

验收：**C5-01、C5-02、C5-08**。应统一人工默认宿主，在 idle/可分析状态提供明确的可选操作。

### R13 · P2 · 批次附件和完成响应可以串到另一会话

位置：`ui/AssistantTab.kt:185`、`:229`、`:1002`、`:1469`、`:1481`。

composerBatchFiles 是全局列表，切换会话不清空或按 conversationId 保存。A 选择的文件会显示在 B，并使用 B 的 id 提交。A 的慢创建响应还可能在切到 B 后设置 workspaceBatchId，随后工作区用当前 B 的 conversationId 配对 A 批次。

验收：**C5-01、C5-04、G05**。附件、工作区状态和异步完成必须属于创建操作时的会话。

### R14 · P2 · 分析重试结果未知时可能再次调用模型

位置：`ui/feature/assistant/AssistantBatchImportWorkspace.kt:894`。

失败分支每次使用新 UUID 请求 analyseImportBatch。服务器分析已完成但响应丢失时，异常没有先查询原批次/建立未知结果状态；陈旧 failed 页面仍可再次分析，形成第二次模型运行。

验收：**C5-06**。应先核对原批次，明确区分失败与未知，不用新请求代替结果确认。

### R15 · P2 · 文件替换响应丢失后，原件恢复入口可能被隐藏

位置：`ui/feature/assistant/AssistantBatchImportWorkspace.kt:112`、`:341`、`:836`。

替换 bytes 只在请求成功返回后更新到 memoryFiles。服务器已替换、响应丢失时，刷新后本地仍持有旧 bytes；filesMismatch 只比文件数，文件数相同就不显示重新绑定原件入口。确认时哈希校验会拒绝旧 bytes，而已成功解析的文件又没有失败文件替换控件，当前页面无法顺畅恢复。

验收：**C5-06** 及原件恢复合同。应按哈希确认匹配，保留候选原件及原操作结果恢复入口。服务端零部分入账保护仍有效。

### R16 · P2 · 导入仍默认全部行，没有异常优先视图

位置：`ui/feature/assistant/AssistantBatchImportWorkspace.kt:108`、`:920`。

默认 filter 为“全部”，没有合并需要处理的异常/冲突/未分配行的视图。普通行可能淹没需要用户核对的行，未实现计划要求的异常优先且可切回全部。

验收：**C5-04**。

### R17 · P2 · 合并来源的不同原备注没有展示

位置：`ui/feature/assistant/AssistantBatchImportWorkspace.kt:1153`、`:1221`；`packages/server/src/services/import-batch-identity.ts:307`。

后端保留 noteAlternatives，Android 也解码了该字段，但批次工作区仅显示主备注或编辑后的备注，来源区只有文件名。不同导出来源携带的备注无法在核对界面查看。

验收：**C5-04**。应展示原备注差异并保留用户明确选择后的确认备注。

### R18 · P3 · 最终结果中的复用分类数按行重复计算

位置：`packages/server/src/services/import-batch-service.ts:2719`、`:2768`、`:2854`。

3行共用一个批准的新分类时，review 为创建1个/复用0个，confirm 为创建1个/复用2个；3行复用同一个已有分类会显示复用3个。计算按行解析累计，结果文案却称“分类N个”。账单金额和实际新建分类数保持正确，但最终分类摘要与 review 含义不一致。

验收：**C5-05**。应明确计数单位，若展示分类实体数量则按分类 ID 去重。

### R19 · P3 · 极少数历史时区窗口选中了第二次月初零点

位置：`packages/shared/src/stats-window.ts:264`。

America/St_Johns 的2009年11月第一次零点是02:30Z，一分钟后回拨到10月31日。当前二分查找假设月份序数单调，返回03:30Z 的第二次零点；02:30:30Z 的11月账单会落在返回的10月窗口中。上海近30天和常规月份检查通过，该问题限于特殊历史 IANA 边界。

验收：**C3-03、G03**。需要明确重复月边界策略并加入对应时区用例。证据：[api-probes.json](evidence/api-probes.json)。

### R20 · P3 · 功能目录与实施证据没有同步完整

位置：`clients/android/README.md:338`、`:391` 及 D017–D019、B03.13；原计划开头与父任务 acceptance.md。

目录称数据/AI入口均使用人工宿主，与 R12 不符；仍把实际存投复盘标为未来 C4 接入。D017–D019 保留旧单文件流程的禁选行、自由文本分类和直接确认说明，未与当前数据页批次流程区分。B03.13 的客户端重放表述也强于 R03 的实际接线。计划仍写 C2 正在实施/C3–C5 未完成，验收矩阵46条仍为未执行，不能据新文件或构建推断完整验收。

验收：**G06**。需逐项复核后更新对应稳定 ID、缺口和证据，设备未验证状态应保留。

## 验证结果及证据边界

完整命令结果见 [本地验证记录](evidence/checks.md)，可重复的隔离 API/窗口复核见 [api-probes.mjs](evidence/api-probes.mjs) 和 [输出](evidence/api-probes.json)。复核采用真实迁移、认证与公开 API，数据库仅在内存中，没有连接生产服务。

R01/R11/R19 有额外运行复核；其余 UI 调用/状态/入口问题来自源码追踪和现有测试覆盖检查，未声称完成真机复现。SAF、IME、小屏、TalkBack、真实点击/返回、弱网与重启恢复仍需设备证据。G01完整设备链路、G04旧服务器设备提示、G05设备弱网和G06最终证据闭环均不能记为完整通过。

建议顺序：先修工资真实载荷及未知结果恢复，再补月计划失效通知和会话/离开守卫，然后接通同周期存投与统一人工导入，最后补核对展示、历史分页和目录。回归应覆盖实际 HTTP 载荷、父子页面接线与真实解析函数；现有金额单元测试继续保留。
