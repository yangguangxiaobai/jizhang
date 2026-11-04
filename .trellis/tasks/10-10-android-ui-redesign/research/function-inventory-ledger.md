# Research: Android 账务、预算、统计、工资与基础资料功能清单

- Query: 用户要求逐点探查当前 App 实际功能，生成需要持续维护的 README；本文件提供账务域的源码事实，不以 UI 设计文档代替实现。
- Scope: internal，Android 可达界面 → Repository → Server Routes/Services → shared 账务规则。
- Date: 2026-10-10
- Verification: 静态源码核对；未构建、未运行测试、未操作真机；界面布局、动画观感及触摸可达性均未实机验证。

## Findings

### 文件与职责（覆盖清单）

以下路径均从仓库根目录开始；`file:line` 是证据定位，不是设计要求。

| 已核对文件 | 功能职责 / 证据起点 |
|---|---|
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt` | 六入口、详情/编辑/工资/待确认页路由、底栏可见性，:39、:87、:117 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt` | 首页聚合、最近账单、预算提示、待确认提醒，:61、:94 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt` | 月账单、搜索、筛选、分页、删除，:75、:114、:459 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt` | 只读详情、退款关联原支出，:41、:58、:181 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt` | 收支新增/编辑、日期选择器、退款关联、草稿放弃确认，:73、:117、:375 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt` | 单选/多选账单关联、独立分页、缺失选项保留，:59、:84、:211 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt` | 周期筛选、额度/池/父子分类、预算进度，:45、:66、:393 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt` | 分类范围、3/6/12月趋势、池趋势、独立请求状态，:50、:96、:437 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt` | 环形图、月收支柱、结余池线、点选和数值明细，:51、:215、:365 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt` | 工资历史/新增编辑/分配三阶段，:95、:316、:403、:445 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt` | 分类/账户/标签管理及模板管理，:146、:448 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/format.kt` | 分→元、日期显示、日期严格解析，:12、:32 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt` | transactions/meta/transfer/trash API 包装（本研究详细覆盖 transactions/meta） |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt` | budget/salary/template/settings/stats/recurring API 包装 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AdminRepository.kt` | 分类/账户 CRUD、移动、使用数量、标签改名/删除 |
| `packages/server/src/routes/{transactions,budget,master-data,stats}.ts` | 路由、查询参数和响应 |
| `packages/server/src/services/{transaction-service,budget-overview-service,salary-service,template-service,master-data-service,account-balance-service,stats-service,tags}.ts` | 数据校验、软删除、聚合、层级与限额 |
| `packages/shared/src/{types,budget-engine,account-balance}.ts` | 当前唯一支出/收入/预算/余额计算口径 |

### L00 导航与总览

| ID | 当前功能 / 输入 / 操作 | 源码证据 |
|---|---|---|
| L00.01 | 登录后默认首页；六个底部入口顺序为首页、账单、预算、记一笔、统计、我的。记一笔是动作入口，记录来源后切到账单编辑流程。 | `ui/MainShell.kt:39`、`:87`（以下 `ui/` 均指上述 Android ui 目录） |
| L00.02 | 账单新增/编辑/只读详情、工资流程、首页待确认页、我的二级页隐藏底部导航。新账单保存/取消返回来源入口。 | `ui/MainShell.kt:87`、`:147` |
| L00.03 | 首页查看全部切到账单；最近记录打开详情；首页“记一笔”创建账单；提醒卡打开 PendingTab。 | `ui/MainShell.kt:135` |
| L00.04 | 预算“记工资”进入工资历史流程，不直接进入新建表单；“分配模板”切到我的模板二级页。 | `ui/MainShell.kt:183` |
| L00.05 | 页面/筛选/草稿普遍使用 Compose `remember`，并非离线账本或持久化草稿；进入别的主分支后重新组合可丢失局部状态。 | `ui/MainShell.kt:70`、`ui/TransactionsTab.kt:86`、`ui/TransactionEditSheet.kt:83` |

### L01 首页

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L01.01 | 首页刷新顺序请求本月趋势（1个月）、最近5笔、当前预算、分类；再尝试账户余额；将主要结果一起发布。顶部显式刷新按钮，加载时禁用。 | `ui/DashboardTab.kt:94` |
| L01.02 | 总余额显示服务端 `totalBalanceCents`，标“所有账户”；负值用危险色。账户请求失败是补充错误，不清空主页面；已加载的余额可保留。 | `ui/DashboardTab.kt:104`、`:259` |
| L01.03 | 收支概览显示服务端 `incomeCents`、`netExpenseCents` 与服务端月份标签；缺数据为“—”，不在客户端从5条列表累加。 | `ui/DashboardTab.kt:114`、`:281` |
| L01.04 | 当前预算显示总预算、已用、结余池、各模块剩余；只对进度图计算比例且限制在0–1，显示金额不截断。无预算时提示未分配并仍显示结余池。 | `ui/DashboardTab.kt:301` |
| L01.05 | 首页依据每个模块已用/预算提示接近上限（≥80%）、超支（>100%），零预算且有支出也算超支；负结余池提示借用/透支。 | `ui/DashboardTab.kt:135` |
| L01.06 | 首页每次 reload 调显式 POST recurring/generate 后 GET pending；只在 pendingCount>0 显示可点击提醒卡；提醒失败单独显示并可重试整个首页。 | `ui/DashboardTab.kt:171` |
| L01.07 | 最近5笔显示标题（备注优先、否则分类）、日期/分类、收支符号与金额，可点开详情；空列表有提示和底部“记一笔”。 | `ui/DashboardTab.kt:419` |
| L01.08 | 首次加载显示进度，首次失败阻断正文且有重试；刷新时保留上次成功结果，进度和“保留上次结果”提示；刷新失败保持旧数据显示错误/重试。401交统一过期处理。 | `ui/DashboardTab.kt:203` |

### L02 月度账单列表与筛选

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L02.01 | 默认本月；左右箭头任意前后切月，月份区间为设备本地月初00:00到下月初（右开区间），无“全部历史”或自定义日期范围。 | `ui/TransactionsTab.kt:118`、`:587` |
| L02.02 | 支出/收入/全部类型 chip 即时更新；退款收入属于收入筛选。切月/类型/账户/分类/标签/搜索均重置第1页。 | `ui/TransactionsTab.kt:174`、`:268` |
| L02.03 | 搜索只查备注；输入框文字为草稿，点搜索图标后 trim 才应用。后端 q 为 literal LIKE，%/_不会变成通配符。 | `ui/TransactionsTab.kt:229`、`transaction-service.ts:811` |
| L02.04 | 筛选底部面板支持一个账户、一个分类、一个标签及“全部”。先修改草稿，“应用”才刷新；取消/滑动关闭不提交；重置仅清空面板草稿。 | `ui/TransactionsTab.kt:407` |
| L02.05 | 活跃筛选为可单独清除 chip；整体“清除”清账户/分类/标签/备注搜索，**不清月份和收支类型**；筛选数量只计账户/分类/标签。 | `ui/TransactionsTab.kt:108`、`:191` |
| L02.06 | 历史分类/账户名称经 includeDeleted=true 获取，已删除资料也可用于历史筛选；标签来自当前活跃账单派生列表。分类筛选是 exact categoryId，不自动包含子分类。 | `ui/TransactionsTab.kt:145`、`transaction-service.ts:797` |
| L02.07 | 每页50笔（offset=page×50）；总数/页码、上一页/下一页、显式刷新；后端默认按date降序再updatedAt降序，API单页最大500。删除尾页后会修正页码。 | `ui/TransactionsTab.kt:107`、`:138`、`transaction-service.ts:260`、`:820` |
| L02.08 | 卡片正文点开只读详情；右侧更多菜单有编辑与删除。显示备注、分类、账户、日期、金额、支出/收入/退款收入徽标、每个标签。 | `ui/TransactionsTab.kt:500` |
| L02.09 | 删除有确认（说明可去回收站恢复），提交时按钮禁用/删除中；失败留对话框错误；成功软删除后刷新。 | `ui/TransactionsTab.kt:459` |
| L02.10 | 首次加载、加载失败重试、无账单“开始记账”、无筛选结果“清除筛选”；有旧列表时加载小进度/失败提示保留旧结果。401退出当前认证流程。 | `ui/TransactionsTab.kt:340` |

### L03 只读账单详情

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L03.01 | 读取单条账单，显示支出/收入/退款收入、大金额、分类、账户、日期；备注与标签仅非空时显示；名称用includeDeleted资料，读取失败降级为已删除分类/账户。 | `ui/TransactionDetailScreen.kt:58`、`:139` |
| L03.02 | 顶部返回和系统返回退出详情；编辑图标在单条账单已加载后可用；无独立删除按钮。 | `ui/TransactionDetailScreen.kt:103`、`:116` |
| L03.03 | 退款收入逐个 getTransaction(refundLinkedTxIds)，显示原支出标题、日期、金额；失败/未关联时显示“未读取到关联账单详情，关系仍保留”；关联行仅文字，**没有点击跳转**。 | `ui/TransactionDetailScreen.kt:83`、`:181` |
| L03.04 | 首次进度、错误信息、重试；已读到交易时可同时显示交易和后续错误/更新中。 | `ui/TransactionDetailScreen.kt:120` |
| L03.05 | 后端原支出详情提供refundSummary及refundDetails，当前列表/详情均未读取这些字段，故目前无法从原支出查看已退款总数、金额及退款明细。 | `transaction-service.ts:422` 对照 `ui/TransactionDetailScreen.kt:83` |

### L04 新增与编辑账单

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L04.01 | 新建默认支出、当日、第一可用支出分类和账户；编辑先取原始账单，保留type/amount/category/account/date/note/tags/isRefund/关联ID。分类和账户未全部加载前不显示可保存表单，有返回/重试。 | `ui/TransactionEditSheet.kt:128` |
| L04.02 | 支出/收入切换会选择该类型第一分类；切回支出关闭isRefund，退款关联文本仍可在内存里保留但支出保存发送空数组。即使点当前类型chip也执行重置分类的onClick。 | `ui/TransactionEditSheet.kt:241` |
| L04.03 | 元金额输入，实时预览分→元；parseYuanToCents使用Double+Math.round，拒绝非有限、负数和>JS安全整数分；保存要求大于0，**此表单不限制最多两位小数，额外小数会四舍五入，也接受Double可解析的科学计数法**；不支持计算器表达式。 | `ui/TransactionEditSheet.kt:509`、`:375` |
| L04.04 | 分类按收支类型列选择、账户列表选择；旧ID不在可用列表时显示已选项目暂不可用且保留ID，服务端决定可保存性；没有可用项时提示先添加。 | `ui/TransactionEditSheet.kt:276`、`:478` |
| L04.05 | 日期支持文本和Material DatePicker，确认应用、取消不改；DatePicker用UTC转换确保日期显示，API保存用设备本地日期解析；parseDateInput不宽松且需解析完整文本，但没有固定宽度YYYY-MM-DD正则。服务端日期须≥2000-01-01且不超过服务器当前时间+1天。 | `ui/TransactionEditSheet.kt:416`、`ui/format.kt:32`、`transaction-service.ts:213` |
| L04.06 | 备注可选多行；标签可选，中文/英文逗号拆分trim删空；服务端去重、单标签最多32字符、每条最多20个（超出截断而不是验证报错）。 | `ui/TransactionEditSheet.kt:307`、`:395`、`services/tags.ts:17` |
| L04.07 | 仅收入提供退款标记；标记后可多选原支出，原支出不被改写；非退款收入/支出保存均强制空refundLinkedTxIds。服务端允许退款不关联任何原支出；不验证退款金额≤原支出金额。 | `ui/TransactionEditSheet.kt:322`、`transaction-service.ts:391`、`:469` |
| L04.08 | 保存完整payload（POST新建或PATCH编辑），操作中保存/取消禁用；错误留当前草稿，401调用统一处理；成功返回来源页。普通创建未携带幂等key，超时后手动重试可能重复记账。 | `ui/TransactionEditSheet.kt:369`、`repo/LedgerRepository.kt:49` |
| L04.09 | 取消和系统返回统一requestClose；加载后与baseline比较所有账单字段/关联，修改后提示放弃修改/继续编辑；saving时拦截离开。草稿不持久化。 | `ui/TransactionEditSheet.kt:102`、`:117`、`:433` |
| L04.10 | 保存栏位于正文外且imePadding；表单分金额、账单信息、备注标签、退款关联四组，滚动正文。触摸/键盘遮挡表现待设备确认。 | `ui/TransactionEditSheet.kt:223`、`:357` |

### L05 关联账单选择器（退款/物品复用）

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L05.01 | 由type限定支出或收入，仅按type查询全时段，分页50笔，不支持月份/搜索/账户/标签筛选。打开默认回第1页；显示备注/日期/金额。 | `ui/LedgerLinkPicker.kt:84` |
| L05.02 | 多选：独立draftSelected，确认后提交；取消/关闭丢弃本次选择。单选点行立即提交并关闭；“不关联”立即清空并关闭。 | `ui/LedgerLinkPicker.kt:211` |
| L05.03 | 显示已选数量和已选记录，跨页选中不丢；未缓存的已选ID逐条取详情；查不到保留ID显示不可用并可移除；当用户确认移除才修改关联。 | `ui/LedgerLinkPicker.kt:121`、`:163` |
| L05.04 | 首次加载/失败重试/空列表；有列表时更新失败保留旧列表；401回调或展示重新登录提示。当前行提示“可从详情跳转核对”未代表选择器本身有详情导航能力。 | `ui/LedgerLinkPicker.kt:186` |

### B01 预算

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| B01.01 | GET periods + overview；默认当前周期。当周期数>1显示横向chip（当前+历史），保留服务端顺序；历史显式只读，显示起始日。未知periodStart服务端返回400，不回退当前。 | `ui/BudgetTab.kt:66`、`:167`、`budget-overview-service.ts:145` |
| B01.02 | 有预算显示服务端总预算、已用、结余池（负值标示）；无预算有第一笔工资按钮。`hasBudget`实际是服务端modules非空，不可解读成“有当月工资”的严格判定。 | `ui/BudgetTab.kt:247`、`budget-overview-service.ts:212` |
| B01.03 | 模块显示父级名称、预算、已用、剩余、封顶进度、未封顶已用百分比；状态正常/将超支（≥80%）/已超支（>100%）/零预算/零预算已超支；不能直接编辑模块额度。 | `ui/BudgetTab.kt:393` |
| B01.04 | 模块有children时可展开/收起子分类支出，服务端返回儿童金额。一次仅一个expandedModuleId；切周期清展开。不会跳到账单筛选页。 | `ui/BudgetTab.kt:61`、`:476` |
| B01.05 | 工资与分配卡有模板入口与工资入口；预算另读pending数，有待确认时仅文字提醒，**无点击处理入口**，需首页/我的处理。 | `ui/BudgetTab.kt:146`、`:325` |
| B01.06 | 首次加载、错误重试；切周期失败保持上次成功周期和金额，明确历史/当前标签；提醒失败可单独提示但重试实际reload预算及提醒；无常驻刷新按钮。 | `ui/BudgetTab.kt:206` |
| B01.07 | 预算进度由MotionTokens驱动，金额直接显示不动画计数；减少动态时token为0（策略见其他研究）。 | `ui/BudgetTab.kt:409` |

### S01 工资与分配

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| S01.01 | 工资历史/表单/分配三个阶段；入口来自预算或我的。打开先获取账户、工资、模板、支出分类；列表含金额、到账日期、账户、备注和编辑/分配/删除。当前工资GET最多返回最近200条，Android无分页/搜索/月份筛选。 | `ui/SalarySheet.kt:162`、`:702`、`salary-service.ts:219` |
| S01.02 | 新增工资：金额、到账日期（文本）、到账账户（必选）、分配模板（必选且默认模板优先）、备注；默认当日，但默认账户为空需明确选择；无模板时无法创建并指示去我的→分配模板。 | `ui/SalarySheet.kt:204`、`:316` |
| S01.03 | 工资金额正数最多两位小数，BigDecimal精确转分，范围≤9,007,199,254,740,991分；不接受负号/指数/空值。日期严格解析，服务端≥2000且不超过now+1天。 | `ui/SalarySheet.kt:1344`、`salary-service.ts:132` |
| S01.04 | 新增按模板比例生成工资分配快照；工资存salary_records而非transactions，账单列表不显示工资；工资会影响账户余额及本月收入。模板小数分舍入由服务端执行。 | `ui/SalarySheet.kt:374`、`salary-service.ts:256`、`stats-service.ts:261` |
| S01.05 | 编辑稳定使用工资ID，先读取单条详情；可改金额、日期、到账账户、备注。未改金额/分配仅PATCH这些信息，保留服务端快照；编辑不允许选择另一模板。 | `ui/SalarySheet.kt:226`、`:348` |
| S01.06 | 修改工资金额时显示同步分配编辑，所有模块非负且最多两位小数，总和必须等于新工资金额，显示差额/超额；零分配项不提交、不能全零；确认“同时替换工资分配”后一次PATCH包含新金额及allocations。 | `ui/SalarySheet.kt:350`、`:564`、`:651` |
| S01.07 | 独立“分配”流程读取该工资ID详情，可对支出分类填写金额，保留当前资料之外历史分类项并注明；总和=服务器工资金额才能保存；二次确认后PUT替换整份分配，非追加。 | `ui/SalarySheet.kt:269`、`:403`、`:1120` |
| S01.08 | 分配显示局部表单合计仅用于验证，不代替预算/池计算；保存后返回历史并服务器重读，刷新失败明确“操作已确认但列表未刷新”。 | `ui/SalarySheet.kt:300`、`:1330` |
| S01.09 | 删除二次确认标明工资金额日期及同时移除分配；后端同时软删除工资与分配；不进入Android交易回收站。 | `ui/SalarySheet.kt:624`、`salary-service.ts:526` |
| S01.10 | 表单/分配有未保存修改，顶部返回和系统返回提示放弃/继续编辑；历史返回退出流程。加载失败可重试，提交状态/字段错误/总错误分开，分配失败保留输入，401统一退出。 | `ui/SalarySheet.kt:192`、`:686` |
| S01.11 | 三阶段切换有短距离水平移动+淡入淡出，时长baseMillis；列表项位移动画；减少动态直接终态。不能据此宣称十二原则每项实机验收通过。 | `ui/SalarySheet.kt:488` |

### M01 分类、账户、标签管理

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| M01.01 | 我的→分类与账户进入一个页面，内部分类/账户/标签tab；显式刷新；全量列表无分页搜索。首次同时读分类、账户、标签、账户余额，任一失败会影响初次加载。 | `ui/ManageTab.kt:146`、`:189` |
| M01.02 | 分类列表展示支出/收入、内建标记、图标名称、色块、父模块/独立收入/子分类关系；子分类缩进；支持新建、编辑、上移/下移和非内建删除。 | `ui/ManageTab.kt:279` |
| M01.03 | 分类表单：名称必填（后端max40）；类型只在新建可选（0支出/1收入）；支出可选独立/顶级支出父模块；收入无父级；图标10种（餐饮/交通/住房/购物/娱乐/工资/医疗/教育/宠物/其他）；颜色12个预设，未命中预设保留原色。 | `ui/ManageTab.kt:371`、`master-data-service.ts:579` |
| M01.04 | 后端只支持两层，不能自己作为父级，父级必须活跃支出顶级分类；已有子级的分类不能改成子级；修改分类类型不提供。 | `master-data-service.ts:154`、`:228` |
| M01.05 | 删除前GET usage展示活跃交易引用数及子类数；软删除保留历史账单名称，子类脱离成为独立分类，同时退役引用该分类的周期规则和pending occurrence。内建分类可编辑但不可删。 | `ui/ManageTab.kt:338`、`master-data-service.ts:279` |
| M01.06 | 账户列表显示类型、内建、服务器当前余额、初始余额、负余额提醒；新建/编辑/上移/下移、非内建可删。 | `ui/ManageTab.kt:313` |
| M01.07 | 账户输入名称、6类型（现金/储蓄卡/信用卡/支付宝/微信/其他）、初始余额；负数允许，BigDecimal 必须能精确转成整数分且在 JS 安全范围内。UI 提示最多两位小数，但没有小数位正则，带多余末尾零或指数的数值只要精确到分仍可接受；空余额按0处理，名称后端max40。 | `ui/ManageTab.kt:397`、`:423` |
| M01.08 | 删除账户GET usage显示引用交易数和将离开总余额的当前余额，历史账单保留；后端软删除账户并清引用周期规则/pending。账户内建可编辑不可删。 | `ui/ManageTab.kt:345`、`master-data-service.ts:405` |
| M01.09 | 标签不支持独立新增；使用账单标签后派生名称/count，按使用次数降序；可改名（必填）与删除。改名为已存在名会合并去重；删除仅从交易移除该标签，不删交易；确认后统一改写。 | `ui/ManageTab.kt:241`、`master-data-service.ts:497`、`:520` |
| M01.10 | 分类/账户上移下移是调用move(dir=-1/+1)与相邻sort_order交换，再刷新；不是拖动排序；边界无相邻项时后端无动作。 | `ui/ManageTab.kt:365`、`master-data-service.ts:442` |
| M01.11 | 加载占位、初次错误/重试、空态与新建按钮；刷新/保存/删除时busy禁用控件；对话框错误保留草稿；没有未保存编辑放弃确认（可直接取消/关闭）。 | `ui/ManageTab.kt:253`、`:369` |

### M02 工资分配模板

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| M02.01 | 我的→分配模板或预算入口；列表显示名字、默认标记、比例合计和每分类比例，显式刷新，无分页。 | `ui/ManageTab.kt:448` |
| M02.02 | 新建/编辑模板名称和若干支出分类模块，每项比例以百分数输入；可逐项添加/移除，不默认全量分类；保留缺失分类并明确要求移除后保存。 | `ui/ManageTab.kt:603` |
| M02.03 | 模板名必填，至少一个模块；比例每项>0≤100，不能空/非法；总和距离100%必须小于0.01个百分点（后端fraction容差1e-4）；父类与子类不能同时选择。显示实时合计/剩余/格式问题。 | `ui/ManageTab.kt:679`、`template-service.ts:81`、`:102` |
| M02.04 | 可将非默认模板设为默认；成功刷新并反馈。新增工资自动预选默认模板，但历史工资分配快照不会随模板编辑改动。 | `ui/ManageTab.kt:556`、`ui/SalarySheet.kt:217` |
| M02.05 | 删除须确认“历史工资分配保留”；当前UI对默认模板也显示删除按钮，但服务端拒绝删除默认模板，需先设另一模板为默认。 | `ui/ManageTab.kt:568`、`template-service.ts:232` |
| M02.06 | 应用当前周期须二次确认，覆盖该周期所有现役工资的分配快照（不是仅最近一笔，也不改工资金额）；成功反馈；无工资/周期服务端拒绝。 | `ui/ManageTab.kt:586`、`salary-service.ts:473` |
| M02.07 | 默认模板/模板列表读取来自服务器；表单保存失败保留输入；初次加载/错误/空态、新建入口、busy防连续操作；直接取消表单无放弃草稿确认。 | `ui/ManageTab.kt:477` |

### B02/S02 统计与图表

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| B02.01 | 三独立区：分类占比、收支月趋势、结余池趋势；各自加载/失败/重试，不互相清空。请求序号匹配才发布，旧结果与旧范围标签一起保留。 | `ui/StatsTab.kt:96`、`:133`、`:156` |
| B02.02 | 图表/明细两种展示方式是整页本地开关，不新增API；完整金额明细可读，不依赖Canvas触摸。 | `ui/StatsTab.kt:194` |
| B02.03 | 分类区间本月/近30天/近3个月/指定月；“近3个月”本月及前两个月；本月/近3个月截止下月初；显示最早账本记录日期；无自由起止日期。 | `ui/StatsTab.kt:42`、`:437` |
| B02.04 | 指定月弹窗年+/−（1..9999）、12个月，应用/取消；月边界由服务端month-window给出，以服务器时区为准。 | `ui/StatsTab.kt:106`、`:339` |
| B02.05 | 当前“近30天”实际from=设备now−30×86400000、to=设备下月初，不是今天为右边界，可能覆盖将来允许入账日期；这是现有代码边界，非产品保证。 | `ui/StatsTab.kt:448` |
| B02.06 | 环形图只绘制正金额slice，服务器总额≤0或无正slice显示不可绘制空态；可点扇区查看分类金额；列表保留全部类别金额及ratio百分比；无“点击分类查看对应账单”导航。 | `ui/Charts.kt:58`、`:96`、`:174` |
| B02.07 | 分类统计只累加type=0支出，各分类独立（不自动父子合并），按金额降序/名称；不统计工资收入和退款收入。尽管旧注释称net，当前实现是毛支出。 | `stats-service.ts:178`、`shared/types.ts:182` |
| B02.08 | 收支趋势默认6月，可3/6/12月，和分类区间完全独立；后台支持1..36月但App仅暴露三个选项；服务端补无记录月份为0。收入含普通收入+退款+工资，netExpenseCents当前为毛支出。 | `ui/StatsTab.kt:292`、`stats-service.ts:235` |
| B02.09 | 月度双柱显示收入/净支出标注、月份、图例；点月份柱显示该月两个精确值；全零仍显示轴/明细和无变化提示；坐标支持负值（历史数据适用），不改金额。 | `ui/Charts.kt:215` |
| B02.10 | 结余池趋势GET pool-trend，没提供自选范围；线图两端日期、可点看周期/池值、最新池值及逐期明细；支持负池、零轴、单点/空态。 | `ui/Charts.kt:365` |
| B02.11 | 图形入场/模式切换、柱/线渐显采用slow/quick tokens，不做金额动画；Canvas语义描述和文字明细可用，但TalkBack、色盲、小屏实际体验待验证。 | `ui/Charts.kt:65`、`:249`、`:398` |

### 当前账务规则（以实际函数为准）

1. **毛支出/退款收入**：`shared/types.ts:182` expenseContribution只给type=0正金额，所有收入贡献0；`:195` incomeContribution给type=1全额，含退款。旧frontend规范与少量源码注释“退款负支出”“净支出”已过时，不能写成现行规则。
2. **工资独立且无自动去重**：salary_records增加收入和到账账户余额，不写transactions。若同一笔工资又手动创建收入账单，两条均计入收入，App没有重复检测。`stats-service.ts:253`、`.trellis/spec/backend/index.md`。
3. **账户余额**：初始余额+全部活跃收入+工资+转入−全部活跃支出−转出；没有月份过滤，软删除交易/工资/转账不贡献；已删账户不在余额汇总里，历史账单仍存在。`shared/account-balance.ts:178`、`:217`。
4. **退款关联只溯源**：对账链接不改写原支出，不冲减支出、不恢复预算，退款增收入/余额。服务端校验关联ID存在、活跃、为非退款支出、去重且不自关联。`transaction-service.ts:391`、`shared/types.ts:182`。
5. **预算实时由shared引擎计算**：同周期多次工资的模块分配相加；自然月模式按发薪所在月合组；配置1..28起始日时按发薪所在月起始日归属（发薪日早于起始日也分到当月该起始日）。模块消费使用区间内活跃支出，未在模板中的消费仍成为零预算模块。父子支出按顶级父类归集；期末剩余进入累计结余池，超支借用池，池可负；不物化余额。`shared/budget-engine.ts:109`、`:150`。
6. **周期起点语义**：自然月group的start是组内最早发薪日（`earliestDate`），不是UI自行假定月1号；账务引擎另按自然月边界计算。在文档中应保留“服务端返回的周期起点”，不要把UI日期擅改成月首。`shared/budget-engine.ts:82`、`budget-overview-service.ts:145`。
7. **日期/精度**：请求金额整数分、时间epoch毫秒；日期输入和部分统计范围来自设备本地时区，服务器月窗口/周期计算来自服务器时区。文档须区分，不宣称跨时区一致已验收。
8. **删除范围**：账单可进交易回收站；工资/模板/基础资料软删除没有Android恢复入口。删除前确认不等于存在撤销能力。

### API 对照与仅服务端/尚未暴露能力

| Android 功能 | 接口 | 与后端的差异 |
|---|---|---|
| 月账单/关联picker/最近列表 | GET `/api/v1/transactions`；GET `/:id`；POST；PATCH `/:id`；DELETE `/:id` | API支持任意from/to、includeDeleted、limit≤500，Android列表限定月、50/页；picker仅type+offset，首页5笔 |
| 原支出退款反查 | GET `/api/v1/transactions/:id` 返回refundSummary/refundDetails | 当前Android详情未展示这些字段 |
| 分类/账户 | GET、POST `/categories` `/accounts`；PATCH/DELETE `/:id`；POST `/:id/move`；GET `/:id/usage` | 后端可传sortOrder，Android仅上下移动；分类类型编辑未开放；includeDeleted用于历史显示但管理列表不显示已删除项 |
| 余额 | GET `/api/v1/accounts/balances` | 服务端还提供每账户flow、正资产/负债等，首页只展示净总余额，管理只展示每账户balance |
| 标签 | GET `/tags`；PATCH `/tags` {from,to}；DELETE `/tags/:name` | 无独立新建接口/标签表，App从交易创建标签 |
| 预算 | GET `/budget/periods`、`/budget/overview?periodStart` | Android仅切已有周期；无预算直接编辑接口 |
| 工资 | GET `/salaries`、`/:id`；POST；PATCH `/:id`；PUT `/:id/allocations`；DELETE `/:id` | 后端POST支持直接allocations或者模板，Android新建仅模板；工资列表服务端最多200、App无分页 |
| 模板 | GET/POST `/templates`；PATCH/DELETE `/:id`；POST `/:id/default`、`/:id/apply-current` | API create支持isDefault，Android创建不提供默认开关而用列表单独设默认 |
| 周期设置 | GET/PUT `/settings`，cycleStartDay=null或1..28 | Android暴露在SettingsTab，由其他研究覆盖 |
| 统计 | GET `/stats/range`、`/month-window`、`/category-share?from&to`、`/monthly-trend?months`、`/pool-trend` | monthly-trend backend1..36；Android3/6/12；category-share backend任意区间、Android四选项 |

### 已发现限制 / 功能状态差异（须纳入主README）

- **L-GAP01：首页详情编辑路由**。首页recent打开详情时tab保持Dashboard；详情编辑回调只设editingTx并清viewingTx，编辑器仅在Tab.Transactions分支。按静态状态流，此路径会回首页同时editingTx导致底栏隐藏；尚未实机复现。证据 `ui/MainShell.kt:117`、`:137`、`:152`。
- **L-GAP02：退款原支出反向明细缺失**。只读详情未读取后端refundSummary/refundDetails；退款关联行不可点击跳转。选择器文案提“详情跳转”并未对应这份详情实现。
- **L-GAP03：父分类仍可在账单编辑器选择**。分类picker未过滤有孩子的父分类；后端assertCategoryUsable拒绝父类记账。不能写“所有可选分类都能保存”。`ui/TransactionEditSheet.kt:278` / `transaction-service.ts:342`。
- **M-GAP01：默认模板删除按钮与服务端不匹配**。按钮可点，后端返回验证错误；应在功能文档记录“默认模板不可删，先切默认”。
- **B-GAP01：预算页待处理卡不是处理入口**；普通成功预算页面没有显式刷新按钮，需切页/切周期等触发重新加载。工资流程onSaved为空，直到退出流程回预算重新组合才更新预算。
- **B-GAP02：近30天上界取下月初**；指定月用服务器边界、其他统计窗口用设备边界，设备/服务端时区差异未验收。
- **S-GAP01：工资只列最近200笔，无分页；工资删除不进入交易回收站；新建工资没有幂等key，网络结果不明时不应宣称重试不会重复。**
- **L-GAP04：账单金额允许多余小数并四舍五入，与工资的最多两位小数正则、账户初始余额的精确整数分转换不同**；初始余额可接受指数或多余末尾零但拒绝非零厘精度。账单编辑/工资日期表单支持范围仍由服务端最终拒绝，DatePicker本身未限制2000..now+1天。
- **L-GAP05：详情关联读取的runCatching吞掉所有Exception**，其中可能包含AuthExpiredException与取消，局部无法区分失败原因。但 ApiClient 拦截器与 MainActivity 仍会处理任一非登录 HTTP401，不能据此断言关联阶段401缺少全局登录导航。这是局部静态错误边界，不是本轮改动。
- **L-GAP06：旧注释与现行函数冲突**。首页/图表用“净支出”文案，但退款已不冲减支出；shared/budget-engine开头、AccountFlow字段注释及旧frontend规范残留旧口径，功能README应明确实际运行函数。
- **L-GAP07：账单列表没有请求代次守卫**。月份/类型快速变更时LaunchedEffect会取消旧查询，但手动refresh与LaunchedEffect并发没有统一编号；不能从静态代码保证所有旧请求永不覆盖。StatsTab有requestId守卫，不能据此推及所有页面。
- **L-GAP08：年月只显示M月d日的交易详情/历史工资可能跨年不明确**；formatDay不含年，列表月份标题有年。该点属于展示事实，是否修改待UI方案。

### 文档维护建议

主README应保留以上稳定功能ID；每次UI入口、参数、校验、接口、金额口径或限额变更，同提交更新对应行及“最后源码核对日期”。把“源码实现”“设备验收”“服务端有但App未暴露”分列，不用design的S01–S48状态代替功能实现。功能删除须记录替代路径；缺口保留GAP ID直至已实现并有核对证据，不能靠文案确认关闭。

## External references

本轮为仓库静态调查，无需外部资料；Compose/Android依赖版本与运行兼容性由其他专项研究覆盖。未请求外部网络或访问生产服务。

## Related specs

- `.trellis/spec/backend/index.md`：API-only、唯一shared账务口径、工资属于收入、账户余额派生。
- `.trellis/spec/backend/native-delivery.md`：Android delivery / API-only 边界。
- `.trellis/spec/frontend/index.md`：原Web设计参考，**其中退款负支出和iPhone假设不是当前Android账务合同**。
- 当前任务 `prd.md` / `design.md` / `implement.md`：范围与历史设计，不作为已实现功能的唯一证据。

## Caveats / Not Found

- 限本agent分配的11个UI文件、其Repositories及后端账务服务；认证设置、AI、物品、周期规则、转账回收站、文件导入导出由其他研究负责，未冒充全App已核对。
- 没有真机/模拟器操作证据，没有截图审美、动画观感、返回栈实际表现、键盘、TalkBack、HarmonyOS4兼容性验收。
- 没有构建/测试/生产API验证，本轮只读产品代码并写研究文档；未修复上述缺口。
- 金额与退款规则引用可执行函数，忽略冲突旧注释；账务字段名netExpenseCents保留API原名，不能因名字推断退款扣减。
