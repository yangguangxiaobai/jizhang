# 最终独立跨层验收（只读源码审查）

日期：2026-10-17  
范围：按 `check.jsonl`、`prd.md`、`design.md`、`implement.md`、冻结协议及 `research/android-cross-layer-fixes.md`、`research/backend-live-view-review.md` 复核当前生产 DTO/workspace/repository/server。只检查本任务指定的跨层行为，不重复历史 review 中已修复的 findings。  
限制：本次未改产品代码、测试、spec、README；未跑编译/测试、未安装/部署、未用设备或真实 provider、未改配置/依赖/model/Git。以下均为当前源码静态证据；不能据此宣称真机/provider/生产记账闭环通过。

## 结论

后端 live-view stale 检测及 GET→review→confirm 重新读取路径已在当前源码中闭合；Android 对 500 条全量分页、类别建议用户审批、失败文件显式移除/替换、服务端 review 摘要主要字段及退款/日期值的显示接线也有实质实现。此前报告中的 live-view stale、候选类别自动选择、500 行嵌套滚动、`ai.include=null`、weak collision、建议自动批准等旧问题，本次复核未重报。

仍有 **2 项 P1 / 3 项 P2** 跨层验收缺口，详见下文。最重要的是 review DTO 新字段没有全部被 Android 实际读取/呈现；以及 Android 的 Long strict-reader 在 IEEE-754 边界可接受溢出值。`loadFullBatch` 的通常 500 行路径按五页可覆盖，但当前没有验证最终加载数等于服务端总数，意外短页/游标异常可提交不完整集合。

## Findings

### P1 — Review DTO 新增 categoryType / approvedNewCategoryName 没有 Android 对应字段与实际展示

- 后端生产 DTO 明确包含 `categoryName`、`categoryType`、`approvedNewCategoryName`、`note`，见 `packages/server/src/services/import-batch-types.ts:424-434`；组装处写入这些值，见 `packages/server/src/services/import-batch-service.ts:2515-2525`。其中 `approvedNewCategoryName` 用于明确标识最终计划新建的分类名称。
- Android `ReviewSelectedRow` 仅声明/读取 `categoryName`、`note`、兼容性字段 `resolvedNote`、`dateLabel`，没有 `categoryType` 或 `approvedNewCategoryName`，见 `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt:728-750`。审核面板只按 `categoryName` 选分类显示，`isIncome`（账单收支类型）决定方向/金额显示，见 `AssistantBatchImportWorkspace.kt:1547-1564`；并未读取“本条将新建分类名”字段或显示服务端类别类型。
- 用户所需的 resolved note 实际字段当前名为 `note`（不是 `resolvedNote`）：Android读取 `note` 并在 UI 优先用可空 `resolvedNote` 再回落 `note`，见 models `:746-749` 与 workspace `:1566-1570`，所以当前备注值/空备注显示链路可用；但把 `resolvedNote` 当兼容字段并没有弥补缺少的新分类计划字段。
- 复现：构造服务端 review 返回的 selected row：`{type:0, categoryName:"临时交通", categoryType:0, approvedNewCategoryName:"临时交通", note:"地铁"}`。当前弹窗显示“分类: 临时交通 / 备注: 地铁”，但 Android reader 中 `categoryType`、`approvedNewCategoryName` 不可访问，无法区别复用类别和需在确认时新建的类别，也不能按后端明示的类别类型渲染核对。用户在 review 后、入账前无法看到 frozen protocol 要求的每条类别创建/复用决策的完整字段。
- 范围建议：对齐 Kotlin DTO + 审核条目显示；不得推导创建计划只依赖字符串猜测。注意当前 `categoriesToCreate`/`categoriesToReuse` 汇总仍有呈现，可作为摘要，但不替代 row 对应的服务端字段。

### P1 — Android 严格 Long reader 对超出 Long 上界的 JSON 数值有 Double 精度绕过

- `parseStrictLong` 先将任何 `Number` 转为 `Double` 检查上下界，然后对原 Number 调 `toLong()`，见 `AssistantBatchModels.kt:14-38`。`Long.MAX_VALUE.toDouble()` 会舍入为 `2^63`，所以 JSON 数值 `9223372036854775808`（Long 上界外）可与上界 Double 表示相等，未满足 `>`，继而可能被 `toLong()` 饱和/转成 `Long.MAX_VALUE` 而接受。范围校验不是精确整数范围校验。
- 该 reader 用于账单 `amountCents`、版本、合计等核心字段（例如 row `:420`，review 汇总 `:827-839`）。异常的服务端值被静默改变而非 fail-close。已有 fractional/string 测试未覆盖此 2^63 边界；任务材料报告的 green helper 测试不能替代该边界源码核对。
- 复现建议：调用生产 DTO reader，输入 `amountCents: 9223372036854775808`（或可由 JSON parser 表示为浮点的上界外值），断言拒绝；另测 `Long.MAX_VALUE` 精确值及 `Long.MIN_VALUE` 边界。使用整数精确比较/BigInteger/BigDecimal 或等价方法，避免先经 Double。

### P2 — Review summary.counts 后端已返回，但 Android DTO 忽略，弹窗语义合并了独立维度

- 后端返回 `summary.counts`：`total/selected/notSelected/preexisting/ruleIgnored/conflictRows/userExcluded:null`，且注释明确后几项是可重叠属性；见 `import-batch-types.ts:438-450` 与 `import-batch-service.ts:2541-2551`。
- Android `ReviewSummary` 没有 `counts` 属性，解析只接 `selected/amount/expense/income/refund/categories/files/excluded/existing/conflicts`，见 `AssistantBatchModels.kt:766-840`。UI 将 `excluded` 显示为“未选入/排除账单”，并独立显示既存及冲突数，见 `AssistantBatchImportWorkspace.kt:1440-1502` 左右；没有办法准确显示规则忽略与用户主动未选的区别，且 server 明确 `userExcluded=null`，不是 0。
- 复现：审核包含一条规则忽略但用户仍选入的正金额行、一条用户未选择行和一条 preexisting 行。server 的重叠 counts 能表达维度；Android 只读旧总字段，界面无法说明“规则忽略”独立于用户排除、`excluded` 是所有未选项总数而非用户排除数。主账单选择行为仍可用；缺的是审核摘要语义/维度核对。
- 修复边界：接入可空 `userExcluded` 与各 count 字段，并按 frozen 语义标注重叠/未知，不能把 `ruleIgnored` 当成用户排除，也不能把 null 显示为 0。

### P2 — 全量分页循环达到五页后没有确认 rows 已完整，异常短页会静默提交部分集合

- `loadFullBatch` 最多请求 5 页，每页 100 条；结束条件是 `nextCursor` 为空、加载数达到 `b.summary.totalItems` 或空页，见 `AssistantBatchImportWorkspace.kt:154-185`。如果第五页返回后 `nextCursor` 仍非空、`loadedRows.size < totalItems`，循环自然结束，`allPagesConsistent` 仍 true，随后 `allRows = loadedRows` 原子提交（`AssistantBatchImportWorkspace.kt:200-205`），没有检查实际行数等于声明 total，也没有对游标尚未耗尽报错或重试。
- 正常服务端强制最多 500 materialized item，因此正常响应最多五页；这不是声称当前 server 会返回 >500。缺口在分页协议异常、短页/重复游标、server total 与 rows 不一致时客户端静默把残缺集合当成完整批次，并可能以残缺选择数发 review。全量路径需要显式完整性门，而不只是 revision 一致性。
- 复现：mock `summary.totalItems=500`，让前 5 页总共返回 450 条并在第五页仍返回非空 `nextCursor`；当前代码走到 atomic commit，不显示分页失败。应以 loaded count/终止 cursor 与 total 共同验证完整性，失败时 bounded retry，耗尽明确错误不提交。

### P2 — 版本一致性检查允许 viewRevision 缺失而绕过协议核对

- 类别和每个 rows page 的 guard 使用 `(b.viewRevision.isBlank() || catsResp.viewRevision.isBlank() || catsResp.viewRevision == b.viewRevision)` / rows 等价判断，见 `AssistantBatchImportWorkspace.kt:135-138,170-172`。只要任一 revision 空，就把 view consistency 当作成立；最终 `viewRevision` 还会 fallback 到另一响应字段（`:200-204`）。冻结协议的新 batch 三类 GET 均应携带同一非空 live `viewRevision`。
- 生产后端当前 `GET batch/categories/rows` 都生成 view revision（`import-batch-service.ts:992,1167,1217`），并且 review 在事务内验证 client revision 等于新计算 live view（`:2173-2185`），故这不是当前源码证明的必现 stale 写账漏洞；是客户端未 fail-close 的跨层契约退化缺口。若以后字段遗漏或代理/旧 DTO 让其中一个为空，客户端仍可能把 revision 不可比较的响应拼成“完整”快照。
- 建议：新协议 DTO 要求非空；任一快照缺失/不一致按不一致重试，最多两次，最终提示刷新，而非以 blank 作为 wildcard。此项与已闭合的 backend live-view finding 不同，不重复其原问题。

## 已验证关闭 / 不重复的旧问题

- **Live view stale→review→confirm**：当前 `review()` 在写入前 `computeViewRevision(batchId)` 并与提交的 revision 不等即抛 stale，见 `packages/server/src/services/import-batch-service.ts:2173-2185`；确认再次比较 token 绑定 revision（`:2643-2647`）。GET 不负责改持久化 revision；fresh GET→review 用 live view 刷新当前审阅基线，未见旧 revision 造成永久 stale loop 的路径。
- **Backend 新字段实际存在**：服务类型、review 组装均有 `categoryName/categoryType/approvedNewCategoryName/note` 和 `summary.counts`（上述行号）；问题是 Android 未消费全部字段，而不是 backend 尚未加字段。selected row 当前无 `dateLabel` DTO 字段，Android 可从已加载 batch row 回查日期（workspace `:1548-1551`），不把它误判成接口金额/日期被改写。
- **退款/强日期事实**：review totals 由 server 对已选行计算，支出/收入/退款收入分别累计（`import-batch-service.ts:2504-2508`）；现有日期标签展示 fallback 到原 batch row，不以 review response 重算/转换。当前源码没有发现 Android 改动退款身份或把时分秒改成账本日期的证据。本报告未执行账务写入。
- **新类别显式审批/候选选择/改名**：当前 workspace 状态明确保存 `approvedCategories`（`AssistantBatchImportWorkspace.kt:77-82`）；此前旧 `firstOrNull` finding 已修正：存在候选选择对话框及改名对话框 state（`:102-105`，相应 dialog 在文件后段），建议默认未批准，用户明确执行复用/改名新建后才写 review。未看到分析或初始加载自动批准动作。
- **文件失败与源文件绑定**：失败文件保持 null 行数（server `import-batch-service.ts:634-636`；Android `ImportBatchFile.rawRowCount/collectedRowCount` 为 nullable，models `:100-127`）；workspace 阻断 review（`:690,1393`），提供失败文件显式替换/移除（`:745-820`）。确认和 mutations 用当前内存中的所有原始 bytes；进程内原件丢失后通过多选文件 SHA-256 全匹配恢复（`:369-389`），文件 mismatch 时确认禁用（`:112,1635`）。client mutation 使用新 UUID requestId；后端操作幂等在 frozen 契约内已有实现。没有把原始内容写入批次消息的迹象。
- **草稿、review token、空备注**：selection/category/note drafts 都 keyed by batchId 的 Compose state（`:77-82`）；任何用户编辑调用 `invalidateLocalReview()` 清除本地 review response（`:118-120` 及调用点）；仅关闭 modal 的返回按钮/系统返回不会清空这些 draft（`:400-408,1620-1626`）。server 以 `noteOverrides.has(itemId)` 区分显式空串与无 override，review 返回 resolved `note`；Android空字符串显示“(空备注)”（`:1566-1570`、`:1578`附近）。未知确认结果按同批次 GET 查询 confirmed result（`:1645-1653`），未发现自动重新跑 AI/新建 batch 的逻辑。
- **500 行 modal 滚动及日期/退款**：审核 modal 使用单一有界 `LazyColumn(fillMaxHeight(0.88f))`，selectedRows 用 lazy `items`（`:1414-1424,1547-1549`），没有旧嵌套纵向滚动结构。退款金额、摘要计划和备注有生产读取/显示路径。
- **分析分批人工继续**：分析状态与 `batch.status` 分离，页面 `pending` 只受 prepared/reviewed 状态控制（`:688-690`），不因 analysis failed 禁用 review；用户可编辑类别/备注并继续人工 review。
- **polling 生命周期**：轮询对 running 状态每两秒 GET；只有 server 返回非 running 才 `loadFullBatch()` 一次（`:257-274`），不会每次 poll 都启动 full load 并自我 invalidate。poll GET 异常目前 break 并停止本轮轮询（`:275-284`），是可用性上可记录的局部限制，但本次未列为阻断 finding：手动 refresh/re-entry 可重新读批次，且不导致错误入账。

## 验收证据边界

- 本次以生产源码 + 既有 frozen protocol/研究记录交叉比对；没有重新运行 backend route tests、Android unit/lint/build，也没有设备/provider/部署证据。
- `android-cross-layer-fixes.md` 中“138 tests / build success / APK SHA”等均是既有记录，不是本轮执行证据，也不能单独证明后端与真实 Android runtime 完成端到端闭环。
- 交付只代表完成当前分支源码的最终静态跨层审阅。P1/P2 应先进入对应 owner 修复/复核，再以批准范围内的测试和设备/provider 证据分别验收。
