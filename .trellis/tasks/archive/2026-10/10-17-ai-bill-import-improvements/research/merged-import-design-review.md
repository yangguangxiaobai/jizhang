> Historical planning evidence only. The revised PRD, design.md, implement.md and merged-import-contract-proposal.md supersede these options; no implementation approval is implied.

# Merged Import Design Review — 后端技术事实（只读）

- 状态：DONE（仅只读取证 + 1 个决策的技术事实核查；未改产品/测试/spec/PRD，未部署、未动 provider/设备、未 start）
- 任务：`.trellis/tasks/10-17-ai-bill-import-improvements`（planning）
- 基线依据：`prd.md`、`research/backend-import-investigation.md`、本次对 `packages/shared/src/platform-bills.ts`、`packages/server/src/services/{portability-service,assistant-tool-registry,assistant-orchestrator,assistant-types,assistant-conversation-service,master-data-service}.ts`、`packages/server/src/routes/assistant.ts`、`packages/server/src/db/migrations/001-init.ts`、`.../db/migrations/009-assistant.ts`、`node_modules/better-sqlite3/lib/methods/transaction.js` 的实际读取。
- 授权边界：本报告只给可读码断言的事实与改动边界，不含任何实施方案批准；推荐容量一律标注“待用户批准”，不声称当前已存在。

---

## 0. 结论速览（直接回答）

- **多文件融合能否取到完整 parsed rows、不截 200？** — **服务/解析层可以**（`parsePlatformBills` 与 `importPlatformBills` 均返回全量行，无行数上限）；**但当前助手卡链路在 3 个独立位置把行数截到 200**，且选择与覆盖在 4 个位置被卡到 100。要“完整融合不截断”必须显式改动这 3+4 处守卫，**不能算静默扩限**——与 PRD“明确多文件策略前不静默扩大”一致。
- **>100 选中：一次最终确认原子入账 vs 100 分批，改动边界哪个小？** — **一次确认原子入账的边界明显更小**：写入路径本身就是“单 `db.transaction` + 全量 INSERT 循环”，已能处理任意 N 行；只需放宽/参数化若干数字守卫。100 分批则需要新状态机（部分已确认状态、跨批草稿继承、逐批指纹、失败续传、半途退出语义），是**新增能力**而非改常量。
- **人工批准后“同事务创建新分类”是否可行？** — **技术上可行且已有同类先例**（非严格路径的 `ensureNamedCategory` 已在同一 `runWrite` 事务内 INSERT 分类；`better-sqlite3` 嵌套事务走 SAVEPOINT；`transactions.category_id` 无外键约束），但**仍属显式契约扩展**：需在严格校验分支接纳“待建分类 ID”、在同事务先建类再插账、把新分类纳入指纹，并复用人机批准的命名/类型/父级规则。不是“零改动顺手建类”。

---

## 1. 决策 1：融合批次能否拿到完整 parsed rows（不截 200）

### 1.1 事实：解析层与 portability 服务层**无行数上限**
- `packages/shared/src/platform-bills.ts:328` `parsePlatformBills()` 遍历 `located.index+1 .. table.length`，`rows.push(...)`（`:404`）无任何 slice/take；`total = rows.length`。**解析结果全量。**
- `packages/server/src/services/portability-service.ts:843` `previewRows = parsed.rows.map(...)`，返回值 `rows: previewRows`（`:1059`）**全量**；`PlatformImportResult.rows` 由 `total/importable` 等计数描述。遗留数据管理路由 `routes/portability.ts:187/217` 直接把它整数组回给客户端，**无 200 裁剪**。
- 因此“融合后能不能看到所有行”在**服务/解析层是 yes**；“被截到 200”是**助手卡渲染/持久化/严格校验**三处的独立限制叠加，不是解析能力不足。

### 1.2 事实：200 上限的 3 个落点（各自独立）
1. **卡片预览** `assistant-tool-registry.ts:42` `MAX_IMPORT_PREVIEW_ROWS = 200`，`:301-322` `boundedRows()` = `result.rows.slice(0, 200)` + 字段裁剪。`:802` 用它构造 `previewData.rows`。
2. **JSON 持久化** `assistant-types.ts:292` `MAX_ARRAY_LENGTH = 200`；`normalizeAssistantJson`（`:317-320`）对**任意数组**静默 `slice(0, 200)`。`prepared()` 的 `preview: json(preview, ...)`（`assistant-tool-registry.ts:226`）会走这条，故落库 `preview_json` 的 rows 也 ≤200。
3. **严格选择/覆盖校验** `portability-service.ts:890` `const visible = parsed.rows.slice(0, 200)`：`selectedIds` 必须在 `visible` 内（`:892`），`categoryIds`/`noteOverrides` 的行也必须在 `visible` 内（`:898,:901`）。

### 1.3 事实：100 上限的 4 个落点（选择）+ 覆盖键上限
选择 `selectedIds` ≤100：
- `routes/assistant.ts:473`（HTTP 层，显式 `>100` 拒绝）
- `assistant-orchestrator.ts:296`（`prepareConfirmation`，非空且 1–100）
- `assistant-tool-registry.ts:297`（`importArgs` 原始长度 `>100` 拒绝）+ `:830`（confirm 1–100）
- `portability-service.ts:892`（严格路径，`>100` 拒绝）

覆盖 `categoryOverrides`/`noteOverrides` 键数 ≤100：
- `routes/assistant.ts:479`（categoryOverrides）、`:486`（noteOverrides）
- `assistant-tool-registry.ts:294`（两 map 统一 `>100` 拒绝）
- `assistant-types.ts:293` `MAX_OBJECT_KEYS = 100`（`normalizeAssistantJson` 对任意对象 `entries.length > 100` 抛错，`:323`）

> 注：`stringArrayArg`（`assistant-tool-registry.ts:154`）内含 `.slice(0, MAX_RESULT_ITEMS=100)` 是**静默截断**，但 `:297` 的原始 `record['selectedIds'].length > 100` 显式拒绝在后，净效果是**显式拒绝**而非静默丢弃。

### 1.4 变更边界（若决定融合不截断）
必须**同批显式**处理：
- 预览展示上限：`MAX_IMPORT_PREVIEW_ROWS`（registry）与 `MAX_ARRAY_LENGTH`/`MAX_OBJECT_KEYS`（types）需协调（否则 JSON 层先静默截到 200/100）。
- 严格校验 `visible` 切片：`portability-service.ts:890` 的 `slice(0, 200)` 决定了可选/可覆盖行集合。
- 选择与覆盖计数守卫：上列 4+3 处。
- 指纹输入：`assistant-tool-registry.ts:811/833` 的 `hashJson({... rows: preview.rows})` 已用**全量** rows（非 200），故行数扩展不破坏指纹语义；但 `categories` 投影若变化必须同步。
- AI 分析输入：`assistant-orchestrator.ts:146` 取 `prepared.preview['rows']`（受 1.2 第 1/2 点限制，最多 200），`:149` 按 25/批调 provider。融合后行数变大只影响 **批次数**（线性增多 provider 调用），不改单批契约。

**不构成结论**：以上仅描述“要改哪些点”，不含是否放宽的批准。

---

## 2. 决策 2：一次最终确认原子入账 vs 100 分批

### 2.1 事实：原子单次入账**已是现有默认形态**
- `assistant-orchestrator.ts:311-341` `confirmAction`：整个写入 + 置 `confirmed` + 追加 result 消息包在 **一个 `this.db.transaction(...)`** 内；`confirmInTransaction`（`assistant-tool-registry.ts:417-425`）在同一事务内同步执行工具的 `confirm`。
- `portability-service.ts:953` `runWrite = this.db.transaction(...)`：`resolve()`（含 `ensureNamedAccount`/`ensureNamedCategory`）与**全部 INSERT** 在同一事务；`pending` 数组收集所有可写行（`:994`），循环 `insert.run(...)`（`:1021`）。**该循环无行数上限**。
- 幂等/原子：重复确认走 `status==='confirmed'` 短路（`:317`）；任一 INSERT 失败（含 PK 冲突）→ 事务回滚 → 全无。
- 硬重复拦截：`existingIds`（`:805`）= `SELECT id FROM transactions` 全表快照，`alreadyExists` 行不进写集（`:880`）；确认时已选重复计 `skipped`（`:966-973`）。

### 2.2 事实：100 分批**不存在**现有支撑
- `assistant_pending_actions.status` 仅 `pending|confirmed|cancelled|expired`（`009-assistant.ts:42`），**无“部分确认/进行中”状态**。
- 无“逐批指纹 / 已确认行游标 / 草稿跨批继承”列或服务；`result_json` 只在终态写一次。
- 一个 action 的确认锁为进程内 `confirmingActions` 单 action（`routes/assistant.ts:464-505`），无跨 action 原子。

### 2.3 变更边界对比
- **一次确认原子入账（边界小）**：只需把上列数字守卫从“固定 100/200”改为“经批准的有界上限”（单一常量族 + 校验阈值），**写入路径与事务/幂等/审计不变**。
- **100 分批（边界大）**：需新增 `status` 值或新表（批进度）、逐批指纹与草稿承接、跨批 idempotency、失败续传 UI 契约、半途退出语义与审计事件——属于**新能力**，与本任务“修复分类/排除/多文件”范围显著不同。

### 2.4 可行性：人工批准后“同事务创建新分类”
- **已有先例**：非严格路径 `portability-service.ts:932` 在 `runWrite` 事务内调用 `ensureNamedCategory`（`:1102-1145`），内部 `randomUUID()` + `INSERT INTO categories`。即“导入事务内建类”在代码上**已被走通**（只是助手链恒 `strictCategories:true`，故当前不触发）。
- **事务嵌套支持**：`confirmAction` 的 `db.transaction` 内再进 `runWrite` 的 `db.transaction` → `better-sqlite3` 检测 `db.inTransaction` 后改用 `SAVEPOINT/RELEASE/ROLLBACK TO`（`node_modules/better-sqlite3/lib/methods/transaction.js:52-77`）。`master-data-service.createCategory`（`:184-211`）是**裸 INSERT、无自带事务**，若在已开事务内调用会**加入同一事务**。
- **无外键阻碍**：`001-init.ts:71` `transactions.category_id TEXT NOT NULL`，**无 REFERENCES**；`007` 的 FK 只加在 `categories.parent_id`。故同事务内“先建类再插账”无 FK 顺序约束。
- **需要显式扩展的点**：
  1. 严格分支 `portability-service.ts:904-910` 目前要求 `categoryIds` 必须是**存在、未删、同 type、叶**ID；“待建类”ID 会被拒 → 需新增“本批待建分类”白名单并在写前 INSERT。
  2. 指纹 `hashJson({..., categories, ...})`（`:811/833`）需纳入“待建分类集合”，否则建类变更不失效卡片。
  3. 命名/类型/父级规则须复用 `master-data-service.requireParentId`（`:153-173` 仅支出可有父、父须同类型支出一级、禁自环）+ 名称长度/去空格，`categories` **无 `UNIQUE(name,type)`**（`001-init.ts:40-51`），重名须由调用方定语义（现有 `ensureNamedCategory` 同名同类型取 `sort_order` 首个，歧义）。
  4. AI 侧当前看不到“新分类”：`importCategories`（`assistant-tool-registry.ts:275-277`）只投影**已存在活叶类**，且 `normalizeBillRecommendations`（`bill-import-analysis.ts:17-31`）对未知 `categoryId` 直接判无效 → 必须另设“新分类建议”通道与人工确认契约，而不能靠 AI 回一个未知 ID。
  5. 取消/回滚语义：一旦并入同一事务，取消即整体回滚；若勉强拆两次确认则回到“两步式”，原子性更弱。

**不构成结论**：以上为可行性事实与改动面清单；“是否选同事务建类”仍需用户/主代理拍板。

---

## 3. 稳定 ID / 事实冲突 / 弱哈希（必要补充要点）

- **稳定 ID 来源**：有单号 → `wx-{orderId}` / `ali-{orderId}`，`.slice(0, 64)`（`platform-bills.ts:401`）；无单号 → `pb-{source}-{simpleHash(date|type|amount|note)}`（`:402`）。`simpleHash` 为 FNV-1a 32-bit ×2 → 16 hex（`:264-276`，注释明示“非加密，仅够导入去重”）。
- **跨文件去重仅靠 `existingIds`（已落库快照）**：`portability-service.ts:805` 每次调用现读全表 `transactions.id`。因此**两个 pending 卡并发时，谁都没入账 → 都看不到对方**；只有前者提交后，后者才 `alreadyExists/skipped`。同一 `orderId` 在两文件 → 同一 `wx-/ali-` ID。
- **同批内无自去重（风险事实）**：`parsePlatformBills` 与 `importableRows`（`:878-886`）**都没有批内 `seen` 集合**。若同一文件（或未来融合）里出现两条相同 ID：
  - 有单号：同 `orderId` 两行 → 同 ID → 第二次 `INSERT` 触发主键冲突 → **整事务回滚**（`transactions.id` 为 PK）。
  - 无单号：同 `date|type|amount|note` 的**合法多笔**也会同 ID → 同主键冲突 → 整批失败，而非“疑似重复提示”。
  - 这是**融合设计必须先解决**的点；仅提示“可能重复”不足以避免 PK 冲突。
- **事实冲突（同稳定 ID、金额/类型不一致）**：PK 冲突会回滚，不能自动“取其一”；必须由用户在入账前明文二选一，且 AI 无权改金额/类型/日期/订单号（PRD/前序报告已锁定）。
- **弱哈希不是强 ID**：`pb-` 哈希只代表内容指纹，**不能当实体唯一标识**（同日同额同备注的多笔现金消费同哈希）。设计上只能标“疑似同额/重复”，**不得据此物理合并**；反之也不能因哈希不同就断言不同笔。

---

## 4. 推荐的有界容量（**待用户批准；当前不存在**）

> 以下仅为**建议值**，用于给决策提供具体尺度；**当前代码并未实现**，也不构成本任务批准。

- 融合**预览**上限：建议单一有界值（例如 **500 行**），并**同步**把 `MAX_ARRAY_LENGTH`（现 200）与该上限对齐，避免 JSON 层静默回落到 200。
- **单次确认选中**上限：建议与之配套的有界值（例如 **500 行**），覆盖 `MAX_OBJECT_KEYS`（现 100）→ 覆盖键上限同步放宽，或明确“每行至多一条覆盖、键数≤选中行数”。
- **同事务新建分类**：建议**每批 ≤20 个新分类**（人类一次可核对的量级），并强制“名称/类型/父级”校验 + 指纹纳入。
- 均需标注：**待用户批准后**才写入 design/implement；未批准前保持既有 200/100，不静默扩大。

---

## 5. 关键证据路径（当前 main 快照）

- 解析全量/ID/哈希：`packages/shared/src/platform-bills.ts:264-276,328-431`（尤 `:401-402`）
- portability 服务全量返回与写入：`packages/server/src/services/portability-service.ts:843,878-886,890-910,932,953-1040,1059,1102-1145`
- 助手卡 200 截断：`packages/server/src/services/assistant-tool-registry.ts:42,301-322,802,811,830-836`
- JSON 层 200/100 静默裁剪：`packages/server/src/services/assistant-types.ts:292-293,317-323`
- 编排与原子事务/100 守卫/AI 分片：`packages/server/src/services/assistant-orchestrator.ts:146-163,291-297,311-341`
- HTTP 层 100 守卫：`packages/server/src/routes/assistant.ts:463-505`（尤 `:473,479,486`）
- 分类规则与重名：`packages/server/src/services/master-data-service.ts:153-173,184-211`
- Schema：`packages/server/src/db/migrations/001-init.ts:40-51,71-85`；`packages/server/src/db/migrations/009-assistant.ts:33-45`
- 嵌套事务 SAVEPOINT：`packages/server/node_modules/better-sqlite3/lib/methods/transaction.js:52-77`

---

## 6. 验证说明

- 本轮仅读码取证，未安装依赖、未改代码、未调真实 provider、未做账务写入、未部署、未动设备、未 `task.py start`。
- 未运行测试（本报告不含行为断言需新测试的结论）；所有行号为当前工作区快照，CRLF 文件以函数名复核。
