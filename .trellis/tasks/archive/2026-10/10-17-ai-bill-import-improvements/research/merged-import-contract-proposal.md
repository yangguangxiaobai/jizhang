# Merged Import Batch — API / Contract v3-final（DRAFT，待最终摘要审批；未批准）

- 任务：`.trellis/tasks/10-17-ai-bill-import-improvements`（planning）· 配套 `../design.md` v3-final（§ 引用之）。
- 性质：技术契约草案，供后端与 Android 对接。**未经最终摘要批准不得据此实现**。所有 `[FRP]` 数值/端点均待批。
- 错误形状沿用统一处理器：`{"error":{"code","message"}}`；4xx 透传 message。
- **相对 v3 的实际修正**：create/analyse **去掉客户端 payloadHash**（server 算 `requestHash`）；`categoryOverrides` → `categoryAssignments`（existing/suggestion 判别联合）；新增只读 `rows/:itemId/duplicates`；`categories` 回 `relatedItemCount`；`sourceTimestamp` 入金融等价；分析状态去 `pending`；collision 一律拒绝而非“可选 1”；result 去 `skipped`；remove/replace 给完整 body 例。

## 0. 冻结边界（legacy 全不变）

| 路径/常量 | 状态 |
|---|---|
| `POST /conversations/:id/messages`（单附件）、`platform-import.prepare` 卡（200 预览 / 1–100 确认）、`POST /actions/:id/confirm` | **不变** |
| `GET /actions/:id/rows/:rowId/duplicates`（`routes/assistant.ts:426`） | **不变**；批次用新路由 |
| `assistant-types.ts:292-293` 200/100 · `app.ts:63` 全局 8 MiB | **不变，不全局扩** |
| `ASSISTANT_TOOL_NAMES` / registry / `assistant_pending_actions` | **不新增工具名、不建 pending action** |
| 融合批次路由 + 批次/行/分类建议/操作幂等记录四张 additive 表（迁移 012，现最高 011） | 新增 |

## 1. 常量（feature-scoped `[FRP]`，全部 未benchmark）

```ts
MERGED_MAX_FILES = 5;              MERGED_MAX_FILE_BYTES = 5*1024*1024;
MERGED_MAX_TOTAL_BYTES = 8*1024*1024;    MERGED_BODY_LIMIT = 12*1024*1024;
MERGED_MAX_FILE_RAW_ROWS = 3000;   MERGED_MAX_TOTAL_RAW_ROWS = 5000;
MERGED_MAX_CSV_COLUMNS = 64;       MERGED_MAX_CELL_CHARS = 1000;
MERGED_MAX_INFLATE_ENTRY = 8*1024*1024;   MERGED_MAX_INFLATE_TOTAL = 16*1024*1024; // 整批共享累计
MERGED_MAX_ZIP_ENTRIES = 64;
MERGED_MAX_FILE_TEXT_BYTES = 6*1024*1024; MERGED_MAX_TOTAL_TEXT_BYTES = 16*1024*1024;
MERGED_PARSE_DEADLINE_MS = 3000;           // 协作式检查点，非硬抢占
MERGED_MAX_ITEMS = 500;                    // 用户已确认；含 ignored/existing/冲突行 [FRP]
MERGED_MAX_NEW_CATEGORIES = 20;            // 超限=显式失败，不截断
MERGED_MAX_SOURCES_RECORDS = 5000;         MERGED_PAGE_DEFAULT = 50; MERGED_PAGE_MAX = 100;
MERGED_REVIEW_TTL_SEC = 900;               MERGED_ANALYSIS_BUDGET_MS = 10*60*1000; // [FRP]
MERGED_ANALYSIS_MAX_CALLS = 20;            // 25 行/次；单次 provider 超时用既有配置，不改
```
`MERGED_BODY_LIMIT = 12 MiB` ≥ `ceil(8 MiB / 3) * 4`（base64 ≈10.67 MiB）+ 500 edits 元数据预算，两者在同一路由 options 内自洽。均**不替换** legacy 常量。

## 2. 端点

### 2.1 建批次 `POST /api/v1/assistant/conversations/:cid/import-batches`
```jsonc
{ "files": [ { "fileName": "wechat_202410.xlsx", "source": "auto", "fileBase64": "<base64>" } ],
  "clientRequestId": "opaque-<=120", "analyse": true }
```
- **client 不提供任何摘要**。校验顺序：`files` 1..5 → `fileName` 非空 ≤200 无 `[\\/\0]` 且扩展名与 `source` 配对 → strict base64 解码（单 ≤5 MiB、合计 ≤8 MiB）→ **server 算每文件 sha256** → **server 算 `requestHash = sha256(canonicalJsonArray([ [fileSha256,fileName,source,sizeBytes] 有序, optionsCanonical ]))`** → 幂等键 `(conversation_id, clientRequestId)`：同 key 同 `requestHash` → 返回前次结果；同 key 异 `requestHash` → `409 IMPORT_BATCH_IDEMPOTENCY_MISMATCH` → 同批内两文件 sha256 相同 → `400 IMPORT_BATCH_DUPLICATE_FILE` → 逐文件解析（行/列/单元格/解压/文本/deadline 预算，超限即时拒绝）→ 合并 → item>500 整批拒绝。
- **分析异步**：草稿落库后立即 `201`，分析在服务端后台按 25/批继续（≤20 次调用）；client GET 轮询。**GET 永不启动 provider**。响应同 §2.2 结构。
- **不提供 GET 隐式触发**建批次或分析。

### 2.2 汇总 `GET .../import-batches/:batchId` → `{ batch }`
```jsonc
{ "batch": { "batchId":"uuid","conversationId":"uuid","version":1,"status":"prepared",
  "files":[{"fileIndex":0,"fileName":"…","source":"wechat","sizeBytes":43008,"sha256":"…",
            "parseStatus":"ok|failed","rawRowCount":211,"collectedRowCount":200,"error":null}],
  "summary":{"totalItems":480,"importable":455,"existing":20,"ignored":25,"mergedGroups":6,
             "conflictGroups":1,"weakDuplicateGroups":3,"expenseCents":1234500,"incomeCents":200000,
             "dateFrom":"2024-08-01","dateTo":"2024-10-31","legacyLedgerMatches":0,
             "unparsedFiles":0,"notices":[{"code":"legacy_ledger_match","detail":"…"}]},
  "analysis":{"state":"idle|running|complete|failed","analysisRevision":1,"analysed":0,
              "providerCalls":0,"suggestedNewCategories":0,"message":null},
  "result": { /* 仅 status==='confirmed' 时返回已确认 result，用于未知结果查询 */ } } }
```
`status` 与 `analysis.state` **互相独立**；分析状态**无 `pending`**。卡片是消息 `content.importBatch` 的同构轻量子集（无行、无 token）。历史卡片若缓存旧状态，client 须 GET live batch 覆盖。

### 2.3 分页行 `GET .../rows?limit=&cursor=&filter=&includeVersion=`
`limit` 1..100（默认 50，越界 `400 VALIDATION`）；`cursor`=上一页末条 `itemId`（keyset）；`filter ∈ all|importable|existing|ignored|conflict|legacy_pb|weak_duplicate|suggestion:<suggestionId>`；`includeVersion` 为可选整型。
排序由 server `ordinal`（`compareItems`：`dateLabel` 降序 → `fileIndex` 升序 → `sourceRow` 升序 → `itemId` 字典序）。
```jsonc
{ "batchId":"uuid","version":1,"total":480,
  "items":[{ "itemId":"po:wechat:a1b2…32hex","identityKind":"platform_order","ordinal":12,
    "conflictGroup":null,"conflictKind":null,
    "dateLabel":"2024-10-15","sourceTimestamp":"2024-10-15 12:03:41","type":0,"amountCents":1850,
    "note":"瑞幸咖啡","noteAlternatives":[{"fileName":"wechat_202409.xlsx","note":"瑞幸咖啡（9月导出）"}],
    "isRefund":false,"refundWarning":null,"rawStatus":"支付成功",
    "ignored":false,"ignoreReason":null,"existing":false,
    "possibleDuplicate":false,"duplicateOfNote":null,"weakDuplicateGroup":null,"legacyLedgerMatch":false,
    "comparisonAccountId":"<live 微信/支付宝 账户 ID，尚无该平台活账户时为 null>",
    "sources":[{"fileName":"wechat_202410.xlsx","fileIndex":0,"sourceRow":12,"note":"瑞幸咖啡"}],
    "fallback":{"effectiveExistingId":null,"categoryName":"餐饮","source":"keyword","newOtherSuggestionId":null},
    "ai":{"status":"complete","include":true,"reason":"商户名匹配餐饮","categoryId":"builtin-expense-food","newSuggestionId":null} }],
  "nextCursor":"ch:3f9a…32hex:88","readAt":1760000000000 }
```
- **不返回 `ledgerId`**。`itemId` 由 server 重算；`note` 为 parser 已有 ≤200 字 sourceNote。
- `fallback.effectiveExistingId` = server 当时解析出的既有同型活叶 ID（可为 `null`）；`newOtherSuggestionId` 指向 §2.4 的 `origin='server-fallback'` 建议。AI 字段**只作非财务默认展示，非权威**，不构成 assignment。
- `includeVersion` 与当前 `version` 不符 → `409 IMPORT_BATCH_STALE_VERSION`（session/conv/page gate 一致：任何 session、会话或分页游标过期均拒绝，不静默重排）。

### 2.3.1 行内重复对比 `GET .../rows/:itemId/duplicates?limit=&cursor=`
新批次没有旧 `actionId`，**不能**沿用 `GET /actions/:id/rows/:rowId/duplicates`（`routes/assistant.ts:426`）。新增只读路由，复用既有历史台账对比查询域（`portability-service.ts:226-246` `duplicateCandidates`：同平台账户、server 本地同日、同类型、同金额）：
- **不接受 client 传入 amount/date**；事实一律取 server 已存 batch row（`comparison_account_id`、`date_label`、`type`、`amount_cents`）。
- `limit` 1..50（默认 20）；分页同既有 `cursor`。
- 响应同既有 `duplicateCandidates` 形状：`{source,total,items,nextCursor,readAt,rationale}`。纯读、零写、不调 provider。

### 2.4 新分类建议 `GET .../categories?includeVersion=`
```jsonc
{ "items":[{"suggestionId":"nc-1","origin":"ai|server-fallback","name":"潮玩手办","type":0,"parentId":null,
            "relatedItemCount":3,"relatedItemIds":["po:wechat:…","ch:…:88"],
            "candidates":[{"categoryId":"builtin-expense-food","name":"餐饮","type":0,"parentId":null,"isLeaf":true}]}],
  "notice":null }
```
- `candidates` 仅在“同名/同类型/同父已有 ≥1 活分类”时非空，供用户选择 `reuseCategoryId`；分类 ID 形态为真实值（内置 `builtin-expense-*` / `builtin-income-*`，用户新建 `randomUUID()`），**不假设全是 UUID**。
- `relatedItemCount`/`relatedItemIds` 在此GET中表示全部受该建议影响的批次行（服务端尚不知道客户端未发送的选择）；review响应另提供按submitted selectedAssignments统计的选中笔数/拟创建类列表，供二次确认。`relatedItemIds` ≤500，建议详情不进入通用助手消息卡片。
- `origin='server-fallback'` 供“AI 失败/兜底目标无同型活叶”场景——**仍需用户 approve**。纯读，零分类写。

### 2.5 移除/替换文件 `POST .../files/:fileIndex/remove` · `.../replace`
body 均含 `expectedVersion` + `clientRequestId`（**该字段即幂等键**，不另设 `idempotencyKey`）+ **变更后剩余全部文件**原始字节：
```jsonc
{ "expectedVersion": 1, "clientRequestId": "opaque-1",
  "targetFileIndex": 0,                                  // remove 必填；replace 用路径 :fileIndex
  "files": [ { "source": "wechat", "fileName": "wechat_202410.xlsx", "fileBase64": "<base64>" } ] }
```
```jsonc
{ "batch":{ /* §2.2 结构，version+1，base_fingerprint 与 summary 已重算 */ },
  "idRemap":{ "po:wechat:old32hex":"po:wechat:new32hex" },
  "droppedDraftItemIds":["ch:3f9a…32hex:88"],
  "identityUnchangedItemIds":["po:wechat:new32hex"],
  "replacedWithIdenticalDigest":false,
  "notices":[{"code":"identity_facts_changed","itemId":"po:wechat:…","detail":"订单号未变但金额/日期/退款事实变化，已清除草稿，请重新核对"}] }
```
- **原字节不落盘**：任何重建（含 replace 单文件）都必须**重传全量 files**；不接受局部补丁。`fileIndex` 重排**不改变** itemId/ledgerId（identity 不含 fileIndex，只含 `fullFileSha256`+`sourceRow`）。
- **no-op 判定**：只有完整 canonical 输入（文件 digest + `fileName` + `source` **+ 顺序**）全等才是 no-op（`version` 不变、无 remap）。同 digest 但 name/source 变化 → `version+1` 并重算指纹 + `replacedWithIdenticalDigest:true`。
- 草稿保留条件**不只是** `itemId` 不变：`itemId` 不变**且** `financialEqual` 成立 → `identityUnchangedItemIds`；`itemId` 不变但金融事实变化 → 清该 itemId 草稿 + `droppedDraftItemIds` + notice。**同一旧 itemId 在 `idRemap` 与 `droppedDraftItemIds` 中互斥**（不得两处同 ID）。
- 移除最后一个文件 → `400 ASSISTANT_INVALID`；终态 → `409`。

### 2.6 显式重试分析 `POST .../analyse`
```jsonc
{ "files":[{"fileIndex":0,"fileBase64":"…"}],"clientRequestId":"opaque-2" }
```
**必须重传全部剩余文件**（`fileIndex` 0..n-1 连续、长度与 sha256 全等，否则 `409 ASSISTANT_ACTION_STALE`）。server 用同一 `requestHash` 规则做幂等判据。`analysisRevision+1`，`reviewed → prepared`。成功 `complete`（`ai_*` 全量重写，`version` 不变）；失败 `failed` + `message`，`ai_*` **清零**，绝不伪成功。已有 `reviewToken` 因 revision/建议变化失效。**不提供 GET 隐式触发**。
- `clientRequestId` 1..120字符，操作幂等先查已接受请求再校验当前版本；服务端对真实文件字节摘要与选项计算请求hash，不信任客户端hash。批次创建返回201、相同请求回放200；analyse首次接受202、相同请求回放200，均不等待provider；running再次使用不同请求ID时409 `ASSISTANT_GENERATION_ACTIVE`。GET、review、confirm不得触发分析。
- **与 legacy generation 的互斥**：批次 AI 分析属“实际 AI 调用”，与 v1 generation 通过**既有会话 active lock**（`assistant-generation-service.ts:519-561` `hasActive` + `routes/assistant.ts:244-257` `beginLegacyTurn`）互斥：同一 conversation 不允许 generation provider 与批次 AI 并发。**GET 恒允许**；review/confirm **不触发** provider，故不受此互斥限制。

### 2.7 审核集 `POST .../review` `[FRP]`
```jsonc
{ "version":1, "analysisRevision":1,
  "viewRevision":"<server GET view revision>", "selectedItemIds":["po:wechat:a1b2…32hex","ch:3f9a…32hex:88"],
  "categoryAssignments":{
    "po:wechat:a1b2…32hex":{"kind":"existing","categoryId":"builtin-expense-food"},
    "ch:3f9a…32hex:88":{"kind":"suggestion","suggestionId":"nc-1"} },
  "noteOverrides":{"<itemId>":"≤200 字符，\"\"=显式清空"},
  "approvedCategories":[{"suggestionId":"nc-1","resolution":"create","reuseCategoryId":null,
                         "name":"潮玩手办","type":0,"parentId":null}],
  "conflictDecisions":[{"conflictGroup":"g1","chosenItemId":"po:wechat:a1b2…32hex|null"}] }
```
- **`categoryAssignments` 取代 string-map 的 `categoryOverrides`**：判别联合 `{kind:'existing',categoryId}` 或 `{kind:'suggestion',suggestionId}`，可明确表达“用既有分类”与“用/新建建议”，不再是无法区分 newOther 的 string→string。
- **每个 selected itemId 必须有客户端显式 assignment**，并解析为已有同型活叶或已批准的本批建议；缺少则 `400 IMPORT_BATCH_CATEGORY_REQUIRED`。有效AI建议与确定性fallback只帮助初始化客户端审核草稿，不由服务端隐式代填，也不构成用户已批准。
- `approvedCategories` 只接受 server 已发布（本批 categories 表内）的 `suggestionId` + `name/type/parentId`；用户改写 `name`（trim 非空 ≤40）须通过既有分类唯一性校验。`relatedItemCount` 由 `selectedAssignments` 服务端重算，client 不提交。
- 服务端校验：batch 非终态；`analysis.state!=='running'`（否则 `409`）；存在 `parseStatus='failed'` → `400 IMPORT_BATCH_FILE_FAILED`；itemId 属本批、不重复、≤500；`fact_conflict`/`ledger_collision` 组选 0 或 1（**`ledger_collision` 选中任一成员即拒绝**）；`weak_collision` 成员不得同选；`weak_dup_group` 无约束；assignment 键 ⊆ 选中集。
- 返回：
```jsonc
{ "reviewToken":"<base64url(randomBytes(32))>", "version":1, "analysisRevision":1,
  "expiresInSec":900, "summary":{"selected":455,"amountCents":1234500,"categoriesToCreate":2} }
```
- `review_json` 落库 = `{reviewToken, expiresAt, version, analysisRevision, reviewSetDigest, baseFingerprint, categorySetHash, normalized{selectedItemIds[],selectedAssignments{},noteOverrides{},approvedCategories[],conflictDecisions[]}, financialSummary, serverSummaryDigest}`（**全量审核集**，仅 `editDigest` 无法 confirm）。**client 不计算也不提交 fingerprint**。**新 review 覆盖旧 token**；任何 server 侧 edit/analyse/remove/replace/cancel 后旧 token 立即失效；**client 本地未发送的 edit 只由 client 丢弃 token 并重新 review**，server 不声称自动感知。

### 2.8 确认 `POST .../confirm`
```jsonc
{ "reviewToken":"…", "expectedVersion":1,
  "files":[{"fileIndex":0,"fileBase64":"…"}] }   // 全部剩余文件原始字节
```
单事务（无 provider）：重传字节的**解码/sha256/预算/解析/merge 候选全部在事务外完成**（不持 DB 写锁跑 5000 行）；进入事务后只做存储事实校验与同步写：归属/状态 → files 数量/顺序/sha256 全等 → `expectedVersion` → 失败文件校验 → 比 `baseFingerprint`/merge 摘要 → **先重读 catalog** 再比 `categorySetHash` → 校验 `reviewToken`（存在/未过期/`analysisRevision` 一致/`reviewSetDigest` 一致）→ 重读 `existingIds`；**「审核时可选、现在 existing」→ 抛 stale 整体回滚**（绝不静默 skip）→ 账户解析 → `approvedCategories` create/reuse → 逐行 INSERT(`id=ledgerId`) → `confirmed` + provenance + result 消息。事务内**无 await、无 provider、无网络**；任一步失败整体回滚。
```jsonc
{ "batch":{"batchId":"uuid","status":"confirmed"},
  "result":{"inserted":455,"selected":455,"excluded":25,"preexisting":20,
            "expenseCents":1234500,"incomeCents":200000,
            "accountsCreated":1,"categoriesCreated":2,"categoriesReused":0,"categoriesSkippedUnused":1,
            "warnings":["…"]} }
```
- result **只给 `inserted/selected/excluded/preexisting`**（无 `skipped`）：`selected` = 用户确认的 `selectedItemIds` 数（审计口径，== `inserted`，因任何选中不可写即整批拒绝）；`inserted` = 实际写入行数；`excluded` = 用户显式排除或规则 ignored；`preexisting` = 硬 `alreadyExists`（本就存在，从未入选）。**不把未选中的 existing 讲成“selected 被静默 skip”**。
- 幂等：已 `confirmed` 且同 `reviewToken` + 原 files 摘要一致 → 200 返回原 result（即使 catalog 事后变化）；否则 `409 IMPORT_BATCH_ALREADY_CONFIRMED`。
- **rebase**：catalog/账户资格/existing集合变更时confirm返回409 stale；响应仅使用既有 `{error:{code,message}}` 形状，客户端按 `ASSISTANT_ACTION_STALE` 获取当前视图，不能依赖未定义额外error字段。GET rows/categories只读返回当前 `viewRevision`（server hash）与动态资格，不改DB；用户重新核对后POST review带 `viewRevision`，server事务中校验所见revision并刷新base/catalog快照、签发新token。期间再变化则409，不让旧base永久阻断；源文件事实变化只能通过版本化remove/replace，不借rebase悄悄改账单。
- 存在 failed 文件 → `400 IMPORT_BATCH_FILE_FAILED`（review 与 confirm 同时阻断）。

### 2.9 取消 `POST .../cancel`
```jsonc
{ "expectedVersion":1, "clientRequestId":"opaque-3" }
```
→ `{ "batch":{"status":"cancelled"} }`。**零财务写**：**先在同一事务同步写 metadata fence**（置 `cancelled` + 清 `review_json`/lease）**再** abort 在途分析 reader（in-process `batchId→AbortController`，形态同 `assistant-generation-runner.ts:299`）。终态后 confirm → `409`。workspace 仍可查看既有数据。`archive()` 内对非终态批次同样“先同步 fence 再 abort”。

## 3. 错误码

| code | HTTP | 触发 |
|---|---|---|
| `ASSISTANT_INVALID` | 400 | 形状/长度/类型/base64/移除最后一个文件/选择为空或含未知 itemId |
| `IMPORT_BATCH_LIMIT_EXCEEDED` | 400 | 文件数/字节/行/列/单元格/解压/文本/deadline/item>500/sources>5000 超限 |
| `IMPORT_BATCH_DUPLICATE_FILE` | 400 | 同批内两个文件 sha256 相同 |
| `IMPORT_BATCH_FILE_FAILED` | 400 | 存在 `parseStatus='failed'` 仍尝试 review/confirm |
| `IMPORT_BATCH_IDENTITY_CONFLICT` | 400 | `fact_conflict` 多选；`ledger_collision` 任选一；`weak_collision` 同选；itemId 同 id 异 origin |
| `IMPORT_BATCH_CATEGORY_REQUIRED` | 400 | selected itemId 既无 explicit assignment 也无 `effectiveExistingId` |
| `IMPORT_BATCH_CATEGORY_CONFLICT` | 400 | 同名同类型同父活分类 ≥2 且未给 `reuseCategoryId`；或命中非叶；用户改名不唯一 |
| `IMPORT_BATCH_STALE_VERSION` | 409 | `expectedVersion`/`includeVersion` 与库中不一致 |
| `IMPORT_BATCH_IDEMPOTENCY_MISMATCH` | 409 | 同 `clientRequestId` 但 server 算出 `requestHash` 不同 |
| `ASSISTANT_ACTION_STALE` | 409 | 归属/摘要/reviewToken/重算 merge 变化；review→confirm 间 selection 变 existing；未传全量原字节；需 `rebaseRequired` |
| `IMPORT_BATCH_ALREADY_CONFIRMED` | 409 | 已确认批次收到不同 token/files |
| `ASSISTANT_NOT_FOUND` | 404 | 批次不存在或不属于该对话 |

`>20` 新分类在分析阶段以 `analysis.state='failed'` + `message` 呈现，**不截断**。错误码均新增，不改既有 `ASSISTANT_*`/`VALIDATION` 语义。

## 4. identity / itemId 规范（前端必读）

```
canonicalOrigin = (fullFileSha256, sourceRow)          // 行出身，server 计算
强 identity（externalId 非空）：
  groupKey = "po:{wechat|alipay}:{完整 externalId}"
  itemId   = "po:{platform}:" + sha256(canonicalJsonArray([groupKey, …financialFacts])).slice(0,32)
  ledgerId = "{wx|ali}-{externalId}".slice(0,64)
  ledger_collision：两个不同完整 externalId 落同一 ledgerId → 该组任选一即拒绝，可整组全排除
弱 identity（无单号）：
  rowSha   = sha256(canonicalJsonArray([source, fullFileSha256, sourceRow, dateLabel, type, amountCents, note, rawStatus, ""]))
  itemId   = "ch:{fullFileSha256[0:32]}:{sourceRow}"
  ledgerId = "pb-{source}-{rowSha[0:32]}"                 // ≥128 bit
  weak_collision：按 ledgerId 分组出现 >1 不同 itemId → 两成员均不得写入（禁止恰选 1）
  精确重传：同 fullFileSha256 + sourceRow ⇒ 同 ledgerId ⇒ 命中 existingIds ⇒ 硬 alreadyExists（第二来源）
  legacyLedgerId = "pb-{source}-{simpleHash(`${dateLabel}|${type}|${amount}|${note}`)}"  // 复刻 platform-bills.ts:402
                  命中仅 possibleDuplicate + notice，永不硬锁
硬 alreadyExists 仅两来源：强 identity 命中 / occurrence ledgerId 命中
itemId 碰撞守卫：弱标识比较未截断文件摘要+源行；强标识比较完整平台订单号+金融事实语义键。不同来源但强标识和事实相同应融合，不能因此报碰撞。仅同itemId对应不同完整语义键拒绝。
financialEqual = source, comparisonAccountId, type, 完整 sourceTimestamp, amountCents, isRefund, ledgerStatus, 完整 externalId
                 显式忽略：note / 展示型 rawStatus 文案 / sourceCategory / counterparty / goods
```
- `itemId` 字符集 `[A-Za-z0-9:_#-]`，长度 ≤100。client **禁止**构造/改写 `itemId`/`ledgerId`/`rowSha`/任何 digest，**禁止**假设 `itemId == transactions.id`。
- `dateLabel` 为 parser 本地日期标签，不由 epoch 反推、不做时区换算；`sourceTimestamp` 为 `交易时间` 原值（含时分秒），**仅用于**强 identity 的 `financialEqual` 与冲突判定，不改变 `transactions.date`（仍日粒度，`portability-service.ts:977-980`）。
- 弱 id 的 legacy 输入精确复刻 `platform-bills.ts:402`：`${dateLabel}|${type}|${amount}|${note}`，`amount = amountCents ?? 0`，`dateLabel`/`note` 取 parser 现值（note 已在 `:387-390` 裁到 ≤200），**不猜字段、不补全**。

## 5. 客户端时序

```
1 POST import-batches(files[1..5], analyse, clientRequestId)          // 无 payloadHash
  ├─ 4xx IMPORT_BATCH_LIMIT_EXCEEDED / DUPLICATE_FILE → 提示调整，结束
  └─ 201 → 存 batchId/version；轮询 GET §2.2（analysis.state 独立）
2 GET rows 分页（≤500，每页 ≤100），client 按 itemId 维护跨页选择
3 files[].parseStatus=='failed' → 横幅 + [移除]/[替换]（§2.5，version+1，按 idRemap/dropped 迁移草稿）
   ⚠ 失败文件阻断 review/confirm，但 workspace 不锁入口
4 GET categories → 建议审阅（create | reuseCategoryId | 暂不导入）
5 本地草稿（键=itemId）：选择 / assignment（existing|suggestion）/ 备注（含 "" 清空）
6 冲突：fact_conflict/ledger_collision 选 0 或 1（collision 选中即拒）；weak_collision 不得同选
7 POST review → reviewToken（任何改动后必须重新 review；analysis running 时 409）
8 POST confirm(files 全量 + reviewToken + expectedVersion) → 200 result / 409 stale(+rebaseRequired)
   超时结果未知 → GET §2.2 读 result（status==='confirmed'），不盲目重发
```

## 6. 兼容 / 迁移 / 鉴权

- 迁移012：4张additive表，批次/行/分类建议三表与`assistant_import_batch_operations`幂等操作记录表。创建幂等由批次表唯一(conversation_id,client_request_id)保存；analyse/remove/replace/cancel使用唯一(batch_id,operation,client_request_id)保存server请求摘要和有界结果引用。重复请求先于版本校验回放，异摘要409，操作不覆盖创建记录。无既有表变更，不迁移历史pending。
- **不追加 `ASSISTANT_TOOL_NAMES`** ⇒ 无 `registerAll()` 启动抛错风险（`assistant-tool-registry.ts:431-450`）；批次不在 `assistant_pending_actions` ⇒ legacy `/actions/:id/confirm` 物理不可写批次。
- **批次卡用 `kind='text'` + additive `content.importBatch`**（轻量 allowlist，`assistant-types.ts:116-131` 加分支 + `:497-505` hasPayload 计入）；**不放宽** `kind='tool-card'` 的 `card` 必填。卡内数组 ≤20（files≤5、notices≤20、suggestions≤20），result 有界。
- 上述四表中的操作记录也只写审核元数据，原始bytes不落盘。分析全轮失败只清AI来源建议，不清server-fallback Other建议。预算/类别上限拒绝原因必须明确，禁止将无效模型输出改标有效AI分类。
- **`reviewToken` 绝不出现在助手消息 JSON**（`FORBIDDEN_KEYS :285` 含 `token`）；只存批次表 `review_json`，专用序列化路径。
- **鉴权**：新路由必须注册进 `app.ts:147-187` `extraRoutes`（与 auth guard 同 plugin 上下文），否则静默脱离鉴权；所有 mutating 路由受既有 CSRF 校验；每次访问校验 `batch.conversation_id === path cid`；落库段走既有 `createConversationWriteLock()` + 单个 `db.transaction`（better-sqlite3，严禁 Prisma/Postgres/createMany）。
- 回滚：新路由/服务/迁移/纯函数均为独立文件，可整体 revert；legacy 测试应全绿。

## 7. 待批准（`[FRP]`，一次呈现，均未批准）

1. §1 容量集合（含整批共享累计 16 MiB inflate、3000+5000 行、deadline 3000 ms、sources ≤5000）与 500 含 ignored/existing/冲突行；全部 未benchmark。
2. 失败文件 `201 + parseStatus='failed'`（推荐）vs 整批 400；失败文件阻断 review 与 confirm、但不锁 workspace。
3. 强 identity 事实冲突 / `ledger_collision`：选 0 或 1（collision 选中即拒）；弱 identity 只标候选；itemId 碰撞显式守卫。
4. `categoryAssignments` 判别联合 + `IMPORT_BATCH_CATEGORY_REQUIRED`（每个 selected 必须完整解析，不默默套用 AI）。
5. 同名同类型同父：恰 1 条活叶 reuse；≥2 条要求改名或显式 `reuseCategoryId`；非叶不可 reuse；approved 但未使用不创建。
6. `POST review` + 随机 opaque `reviewToken`（TTL 拟 15 min）+ 全量审核集 + rebase 机制。
7. 迁移 012；`confirmed` 与批次记录保留、不做自动清理。
8. 工具注册策略：不新增 `ASSISTANT_TOOL_NAMES`、无 pending action；批次卡 `kind='text'` + additive `content.importBatch`。
9. 归档/取消围栏：先同步 fence 再 abort；metadata fence 非 cascade delete；cancel 端点零财务写。
10. AI 全或无、>20 显式失败不截断、`server-fallback` newOther 建议仍需 approve；generation 与批次 AI 共享会话 active lock 互斥（GET/review/confirm 不受限）。
11. 预算需过 **benchmark 质量门**；未标定前不得声称达标，不得借现网 160 MiB 声称已 safe。

## 8. 验证说明（含本轮实际读码确认）

- `platform-bills.ts:401-402`：`{wx|ali}-{orderId}.slice(0,64)` 与 `pb-{source}-{simpleHash(dateLabel|type|amount|note)}`（`amount = amountCents ?? 0`，`:392`）——§4 弱 id / legacyId 据此。`note` 已在 `:387-390` 裁到 ≤200。
- `parseDateLabel`（`platform-bills.ts:235-246`，正则只取 `YYYY-MM-DD` 前缀、**丢弃时分秒**）产日粒度 `dateLabel`；`portability-service.ts:977-980` 据此写 `transactions.date`——即 `sourceTimestamp` 只进等价键，不改变账本 JSON；也证实“同单号同日异时刻”确实会被日粒度键吞掉。
- `portability-service.ts:226-246` `duplicateCandidates` 只读同账户/同日/同类型/同金额——§2.3.1 复用其查询域且不接受 client amount/date。
- `db/migrations/` 现最高 `011` ⇒ 迁移 `012` 正确；`seed-data.ts:92-110` 内置分类为 `builtin-expense-*`/`builtin-income-*`（非 UUID）。
- `assistant-types.ts:285,292-293`：`FORBIDDEN_KEYS` 含 `token`，`MAX_ARRAY_LENGTH=200`/`MAX_OBJECT_KEYS=100`；`app.ts:63` 全局 8 MiB；`xlsx-lite.ts:32-53` 解压无界——§0/§6 保持 legacy 不变。
- `assistant-generation-service.ts:519-561` `hasActive` + `routes/assistant.ts:244-257` `beginLegacyTurn` = 会话 active lock；§2.6 互斥据此。

本文件为读码 + 契约设计产出：未改产品/测试/spec/PRD/implement/代码，未装依赖、未部署、未调 provider、未写账本、未动设备、未 `task.py start`、未 stage/commit。行号与代码结论来自当前工作区快照（CRLF 文件以函数名复核，如 `duplicateCandidates`）；预算值来自 160 MiB 堆假设下的保守推理（非实测）。状态为**待最终摘要审批**，不代表已批准。
