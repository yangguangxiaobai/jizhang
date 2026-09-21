# Design

## Change boundary
最小行为差距：主流程已存在，但预算仅枚举模板模块导致模板外支出漏算；工资 PATCH 单独改工资行导致快照脱节；PIN 是额外、非安全边界的使用阻碍。

## Shared budget engine
在同一纯函数中按周期窗口生成模块视图：先合并工资分配，再收集窗口内有效支出分类，未获分配的分类预算为零。费用仍使用 expenseContribution（退款为负）。当前视图、历史结余与趋势都复用这个窗口口径。保留既有发薪日/配置起始日和快照规则，不另造一套前端算账逻辑。

## Salary writes
金额变更没有显式 allocations 时拒绝，避免静默重算丢失手工分配。先验证全部金额/日期/分类/总和，再在一个 SQLite transaction 内写工资及快照。日期更新同步快照；显式替换分配时以工资日期校正快照。不做自动历史数据迁移。

## UI simplification
AppShell 始终渲染认证后的界面；Settings 去除 PIN 表单/按钮；移除 useLock 与 LockScreen。旧 localStorage PIN 项不再被读取，不妨碍进入应用。更新主题/配色浏览器检查，删除只为 PIN 保留的动效或审计引用。保留服务端认证和数据保护功能。

## Verification architecture
单元测试覆盖周期边界、模板外分类、退款、历史、结余趋势；接口测试覆盖原子工资更新与完整账本操作。浏览器从真实表单完成模板、工资、账单操作，而不是用 API 预填所有关键行为。专用测试服务使用新建临时数据库、随机/专用回环端口，拒绝用户 DATA_DIR；无复用真实凭据。优先同时验证 Chromium 与 WebKit；引擎模拟不能冒充 iPhone 真机。

## Expected files
- shared/src/budget-engine.ts 与 shared/test/*：统一预算口径和回归。
- server/src/services/salary-service.ts、server/test/*、必要的 API 类型：原子工资契约。
- web/src/views/AppShell.vue、SettingsView.vue、LockScreen.vue、composables/useLock.ts、styles 与已有浏览器脚本：移除 PIN 及死代码。
- web 主流程视图/路由：只修验证发现的交互缺陷，不重新设计整站。
- 隔离浏览器测试运行器、包脚本与必要开发依赖：可复现交付验证。
- README / 交付与用户说明、对应 spec：当前能力、运行步骤、验收证据。

## Preservation
不回滚已有配色工作；不读取/改写用户业务账目；不清理未知进程、不修改线上服务；不改 .agents 或工具配置。
