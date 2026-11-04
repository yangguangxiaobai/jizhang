# 技术设计冻结候选 v3-final（DRAFT — 待最终摘要审批；未批准前禁止 start/实施）

- 任务：`.trellis/tasks/10-17-ai-bill-import-improvements`（planning）· 角色：后端设计（yansuu1）。
- 只产出草案：**不改** prd/implement/product/tests/spec/代码，不 start、不部署、不碰设备、不调 provider、不装依赖、不 stage/commit。API 明细以同步更新的 `research/merged-import-contract-proposal.md` 为准。
- 基线：`prd.md`、`implement.md`（主代理已收敛）、`research/{final-planning-review,backend-import-investigation,android-import-investigation,merged-import-final-ux}.md` + 本轮对 main 快照源码再读取。
- **本版目标**：把 v2/v3 与评审之间仍存的矛盾**实际统一**（非标注“已修”），并收口为 §10 单一待批清单。`[FRP]` 均**未批准**。

## 0. 口径

- **已确认（用户批准）**：每批 ≤500 条融合；统一审核、一次确认；整批成功或整批回滚；>500 整批拒绝提示拆分（不截断）；新分类仅在最终确认时与选中账单**同一事务**写入；取消或任意写入失败整体回滚、零残留。
- `[FRP]`=待最终批准的提案；`未benchmark`=数值为保守推理、须实现质量门用真实样本标定后回写 `research/`。
- 500 上限为已确认产品决策，本文件不复重开；其余容量值均为 `[FRP]`。

### 0.1 v3 → 冻结候选：八项矛盾的实际统一

| # | 矛盾 | 统一结论 |
|---|---|---|
| 1 | create/analyse 客户端传 `payloadHash`，双端各自算摘要 | **客户端只传 `clientRequestId`**（=唯一幂等键）；**server** 从实际解码字节 SHA + 文件元数据 + options canonical 算 `requestHash` 作判据。同 key 同 hash→回放前次；同 key 异 hash→409。client 不提供、不校验、不信任任何摘要；响应 file sha 只 server 算 |
| 2 | `categoryOverrides` 为 string→string，无法表达 newOther/新分类建议 | 改统一 `categoryAssignments: itemId→{kind:'existing',categoryId}\|{kind:'suggestion',suggestionId}`；`normalized.selectedAssignments` 每个 selected 必须**完整**（缺则 400，**绝不默默套用 AI**）；`approvedCategories` 只接受 server 已发布 suggestionId + name/type/parent（用户改名校验唯一）；`relatedItemCount` 由 selectedAssignments 服务端计；row fallback 回 `effectiveExistingId` 或 `newOtherSuggestionId`；AI 只做非财务默认值、不权威 |
| 3 | 金融等价用日粒度 `dateLabel`，同单号异时刻被吞 | parser 追加 optional **完整 `sourceTimestamp`**（`交易时间` 原值含时分秒）；强 identity 的 `financialEqual` 用完整 timestamp；`transactions.date` 仍按现有 `parseDateLabel`（日粒度，`portability-service.ts:977-980`）不变；源 note 是 parser `platform-bills.ts:387-390` 的 ≤200 现值，不称完整；legacy 弱 id 精确复刻 `:402` 输入；`itemId` 用**未截断** digest 建 `Map<itemId,canonicalOrigin>`，异 origin 同 id→拒绝 |
| 4 | `pending` 与 `running` 两套分析状态；失效语义含糊 | 分析状态统一 `idle\|running\|complete\|failed`；`analyse` 后 `reviewed→prepared`；**client 本地未发送 edit 只由 client 丢 token**，server 不声称感知；review 新 token **替旧**；`analyse`/`cancel`/`archive` **先同步写 metadata fence 再 abort** reader，防 late write |
| 5 | weak/ledger collision “选 1”；existing 被静默当 skip | `weak_collision`/`ledger_collision` 选中**任一成员即拒绝**（非“可选 1”）；`fact_conflict` 只 0 或 1（显式 resolution）；任何**不 eligible** 的 selected 一律拒绝（existing 不是 skip）；result 只给 `inserted/selected/excluded/preexisting`，不用 `skipped` 掩盖 |
| 6 | remove/replace 无完整 body；remap/dropped 混淆 | 给完整 body 例（全量 files 元数据 + `expectedVersion` + `clientRequestId`）；新 `fileIndex` 重排不改变 identity（itemId/ledgerId 不含 fileIndex）；同一旧 itemId 在 `idRemap` 与 `droppedDraftItemIds` **互斥**；原字节不落盘，重建必传全量 files；partial failed 文件必须显式 remove |
| 7 | 新批次无 actionId，旧 duplicates 路由不可达；建议关联交易塞卡片 | 新增**只读** `GET .../rows/:itemId/duplicates`（复用既有 ledger compare 查询域，不接受 client amount/date）；`GET .../categories` 回 `relatedItemCount`（+≤500 `relatedItemIds`）；rows 支持 `filter=suggestion:<id>` + `includeVersion`；UI 来源筛选/分页 version 不符→409；审阅合计 server 计 |
| 8 | 资源/卡/接驳边界分散 | body 12 MiB 与 8 MiB base64（≈10.67 MiB）+500 edits 预算一致；shared 只收已算 digest、**不引 node:crypto**；deadline 是**协作检查点非硬抢占**；新卡 `kind='text'`+`content.importBatch`；历史需 GET live batch 覆盖缓存；卡 result 有界、**token 不进 messages**；generation 与批次 AI **共享现有会话 active lock** 互斥（仅实际 AI/changes），GET 恒允许，review/confirm 不触发 provider |

## 1. 架构 / 范围 / 鉴权

- 不新增 `ASSISTANT_TOOL_NAMES`、不注册 registry entry、不建 `assistant_pending_actions`（`assistant-tool-registry.ts:431-450` 构造期 throw；legacy `/actions/:id/confirm` 保持唯一旧写入口，批次物理不可达）。
- 路由（全部挂 `app.ts:147-187` `extraRoutes`，与 auth guard 同 plugin 上下文）：
  `POST .../import-batches`、`GET .../:bid`、`GET .../rows`、`GET .../rows/:itemId/duplicates`、`GET .../categories`、`POST .../review`、`POST .../confirm`、`POST .../analyse`、`POST .../files/:i/remove|replace`、`POST .../cancel`。
- 鉴权/CSRF/归属/锁：mutating 路由受既有 CSRF 校验；每次校验 `batch.conversation_id === path cid`（否则 404）；写用 `createConversationWriteLock()`；落库段在**单个** `db.transaction`（better-sqlite3 同步，禁 Prisma/Postgres/createMany）。
- 批次卡：`kind='text'` 的 additive `content.importBatch`（`assistant-types.ts:116-131` 加白名单分支 + `:497-505` hasPayload 计入），不含行、不含 reviewToken（`FORBIDDEN_KEYS :285` 含 token）；不放宽 `kind='tool-card'` 的 card 必填。卡仅展示态，`status!=='confirmed'` 绝不暗示已入账。
- Android `isHistoricalCompleteProgress`/`isProgressOnlyMessage` 需把 `importBatch` 列入“永不隐藏”。

## 2. 存储 / 迁移 012 / 状态机

- 迁移 **012**（`db/migrations` 现最高 011）：批次/行/分类建议三表及操作幂等记录表（共4张）均为 additive，无既有表 `ADD COLUMN`，回滚代码后旧库仍可读。
  `assistant_import_batches(id PK, conversation_id, status, version, analysis_revision, base_fingerprint, category_set_hash, request_hash, files_json, summary_json, suggestions_json, review_json, provenance_json, analyse_state, analyse_owner, analyse_lease_until, analyse_message, result_json, created_at, updated_at)`
  `assistant_import_batch_rows(batch_id, item_id, ordinal, ledger_id, identity_kind, canonical_origin, conflict_group, conflict_kind, type, amount_cents, source_timestamp, date_label, note, note_alternatives_json, is_refund, refund_warning, raw_status, ignored, ignore_reason, existing, possible_duplicate, duplicate_of_note, comparison_account_id, sources_json, weak_dup_group, legacy_ledger_id, fallback_effective_existing_id, fallback_category_name, fallback_source, fallback_new_other_suggestion_id, ai_status, ai_include, ai_reason, ai_category_id, ai_new_suggestion_id, PRIMARY KEY(batch_id,item_id))`
  `assistant_import_batch_categories(batch_id, suggestion_id, origin, name, type, parent_id, related_item_count, PRIMARY KEY(batch_id,suggestion_id))`
- 5 个 JSON 列走**专用序列化**，**不走** `normalizeAssistantJson`（否则数组裁 200 / 对象 100 抛错，`assistant-types.ts:292-293,317-323`）。不落盘原文件字节。
- **批次状态机（单向）**：`draft → prepared → reviewed → confirmed`（`reviewed → prepared` 可由 `analyse` 或文件重建触发）；`prepared|reviewed → cancelled|expired|failed`。终态不可再 review/confirm（409）。`confirmed` 记录与行**保留**（历史与幂等短路所需），本任务不做自动清理。
- **分析状态机（独立）**：`idle → running → complete|failed`（**无 `pending`**）。`analysis_revision` 每次显式 analyse +1；`version` 仅在**实际文件集/元数据**变化时 +1。
- 创建幂等键 = `(conversation_id, clientRequestId)`，批次表保存创建 requestId 与 request_hash。analyse/remove/replace/cancel 的请求记录另存 additive `assistant_import_batch_operations`，唯一键 `(batch_id, operation, client_request_id)`，保存服务端载荷摘要、接受时版本/分析revision及有界结果引用。先查幂等记录再检查已消费版本，同请求不重复分析/重建，异载荷409；不把新操作覆盖创建幂等记录。

## 3. 解析 / 预算 / shared 范围

### 3.1 预算（全部 `[FRP]`，未benchmark）

文件数 5；单文件 5 MiB；合计 8 MiB；带字节路由 `bodyLimit` 12 MiB（**不动** `app.ts:63` 全局 8 MiB）；parser 原始数据行 3000/文件、5000/批；列 64；单元格 1000 字符；inflate 单 entry 8 MiB、**整批共享累计 16 MiB**（一个跨文件累加器，禁 per-file 相乘）；zip entry ≤64；解码文本 6 MiB/文件、16 MiB/批；解析 deadline 3000 ms **协作式检查点（非硬抢占）**；materialized item 500；新分类建议 20；sources 记录 ≤5000；review TTL 900 s。
- xlsx（`xlsx-lite.ts:32-53` 现无界）：解压**前**校验 EOCD `count`/`compSize`/`localOffset`/`dataStart+compSize` 越界 → 拒绝；每 entry 传 `maxOutputLength`；解压后长度与声明一致；累计超 16 MiB 立即中止。
- CSV：`maxRows/maxColumns/maxCellChars` 作为 `parsePlatformBills` 的**可选**参数（缺省=现行为，legacy 不变）。
- CPU 只承诺“操作量上限 + 文件边界/每 N 行/每 entry 的 `Date.now()` 检查点”，不承诺硬 CPU 上限，不用假可中断定时器。
- **live 160 MiB 只是上限假设**：`[FRP]` 数值须实现阶段真实样本测峰值 RSS/耗时并回写 `research/`；未标定前不得声称达标。

### 3.2 shared 变更范围（最小）

- `packages/shared/src/platform-bills.ts`：①可选预算参数；②追加 **optional** `sourceRow: number`（1-based 数据行）、`fullExternalId: string|null`（=现有 externalId 显式化）、`sourceTimestamp: string|null`（`交易时间` 原值规范化，含时分秒）；③纯函数 `canonicalJsonArray()` / `buildCanonicalOrigin()`，**只接收已算 digest**，自身不引 `node:crypto`。
- **不新增** shared `import-batch.ts`；`compareItems`/`diffItemIds`/remap 落 `packages/server/src/services/import-batch-identity.ts`（纯函数、可单测）。Android **不得**自算 id/排序，只用 server 的 `ordinal`/`itemId`。

## 4. Identity / 合并 / 冲突（含时间事实）

- 全部标识 server 计算，client **不得提交或改写**。`canonicalOrigin = (fullFileSha256, sourceRow)`；同批内两文件 sha256 相同 → 400 `IMPORT_BATCH_DUPLICATE_FILE`。
- **强 identity（externalId 非空）**：`groupKey = po:{platform}:{完整 externalId}`（比较用完整值，不先截断）。
  `itemId = po:{platform}:{sha256(canonicalJsonArray([groupKey,…financialFacts]))[0:32]}`（**无 `#c{n}`**，删一成员不改其余 itemId）。
  `financialEqual` = `source, comparisonAccountId, type, 完整 sourceTimestamp, amountCents, isRefund, ledgerStatus 语义值, 完整 externalId`；**显式忽略** `note`、展示型 `rawStatus` 文案、sourceCategory、counterparty、goods。
  合并 = 同 groupKey **且** financialEqual；note 差异不产生 conflictGroup；`sources[]` 逐条保留 `{fileName,fileIndex,sourceRow,note,rawStatus,ignoreReason}`，行默认 note=首来源 note（parser ≤200 现值）。
  `ledgerId = {wx|ali}-{externalId}.slice(0,64)`；两个**不同完整 externalId** 落同一 ledgerId → `conflict_kind='ledger_collision'`。
- **弱 identity（无单号）**：`rowSha = sha256(canonicalJsonArray([source, fullFileSha256, sourceRow, dateLabel, type, amountCents, note, rawStatus, '']))`。
  `itemId = ch:{fullFileSha256[0:32]}:{sourceRow}`；`ledgerId = pb-{source}-{rowSha[0:32]}`（≥128 bit）；不跨文件自动合并。
  精确重传（同 fullFileSha256+sourceRow）⇒ 同 ledgerId ⇒ 命中 existingIds ⇒ 硬 `alreadyExists`（**第二来源**）。
  按 ledgerId 分组出现 **>1 个不同 itemId** → `weak_collision`：**两成员均不得写入**，禁止恰选 1。
  `legacyLedgerId = pb-{source}-{simpleHash(`` `${dateLabel}|${type}|${amount}|${note}` ``)}`（精确复刻 `platform-bills.ts:402`，`amount = amountCents ?? 0`，`simpleHash` 同 `:264-276`，`dateLabel`/`note` 取 parser 现值，不猜字段）；命中仅 `possibleDuplicate` + notice，永不硬锁。
- **硬 `alreadyExists` 仅两来源**：强 identity 命中 / occurrence ledgerId 命中。
- **itemId 碰撞守卫**：弱标识比较未截断文件摘要+源行；强标识比较完整平台订单号+规范化金融事实。相同强标识且金融事实一致的不同文件来源是正常融合，不能以来源不同误判碰撞；只有同 itemId 对应不同完整语义键时拒绝，不假设截断摘要绝无碰撞。
- **时间**：`dateLabel` 为 parser 本地日期标签，不由 epoch 反推、不做时区换算；`sourceTimestamp` 保留完整时刻，仅用于强 identity 等价与冲突判定；`transactions.date` 仍按 `parseDateLabel`（日粒度）写入，不改账本语义。金额/日期/订单号/退款事实绝不重算；`isRefund` 不可被合并抹平，不自动排除原支出。

## 5. review / confirm 协议

- **server 指纹（client 不回传）**：`baseFingerprint = sha256(canonicalJsonArray([version, categorySetHash, files[], items[]]))`，`items[]` 含 identity、`financialEqual` 全字段（含 sourceTimestamp）、`sources[].note`、ignored/ignoreReason、existing 资格、comparisonAccountId、fallback 值——**专用序列化，不裁剪**（禁 `hashJson`）。
  `categorySetHash` = 对 `importCategories` 投影 hash（`assistant-tool-registry.ts:275-277`，只含**既有活叶**，不含本批将建分类，保证自建类不自我 stale）。
- **审核集 `POST .../review`**：接收 `{version, analysisRevision, selectedItemIds, categoryAssignments, noteOverrides, approvedCategories, conflictDecisions}`。服务端校验后签发 `reviewToken = base64url(randomBytes(32))`（随机 opaque，非 edits 派生），新 token **替换**旧 token 写入 `review_json`。
  `review_json = {reviewToken, expiresAt(拟 now+900s), version, analysisRevision, reviewSetDigest, baseFingerprint, categorySetHash, normalized{selectedItemIds[], selectedAssignments{}, noteOverrides{}, approvedCategories[], conflictDecisions[]}, financialSummary, serverSummaryDigest}`（全量审核集；只存 editDigest 无法 confirm）。
- **assignment 规范化**：每个 selected itemId 必须解析为 `{kind:'existing',categoryId}` 或 `{kind:'suggestion',suggestionId}`：显式 assignment，或行 `effectiveExistingId`（server 当时解析出的既有同型活叶）；两者皆无 → 400 `IMPORT_BATCH_CATEGORY_REQUIRED`。**绝不把 `ai_*` 建议当已批准默认值套用**。`selectedAssignments` 落库；`approvedCategories` 的 `relatedItemCount` 由 selectedAssignments 重算；用户改写的建议 name（trim ≤40）需通过既有分类唯一性校验。
- **失效规则**：server 观测到 `analyse`/`remove`/`replace`/`cancel` → 立即失效旧 token；新 review 覆盖旧 token。**client 本地未发送 edit 由 client 自行丢 token 并重新 review**，server 不声称自动感知。`analysis.state==='running'` 时 review → 409。
- **`POST .../confirm`** body `{reviewToken, expectedVersion, files[]}`（files = 全部剩余文件原始字节）。
  - 已 `confirmed`：同 `reviewToken` + 原 files 摘要一致 → 返回原 `result`（即使 catalog 事后变化）；否则 409 `IMPORT_BATCH_ALREADY_CONFIRMED`。
  - review→confirm 间**新插入账单**导致“审核时可选、现在 existing” → 409 stale（`rebaseRequired`），要求重新 review；**绝不静默 skip**。
  - 存在 `parseStatus='failed'` 文件 → 400 `IMPORT_BATCH_FILE_FAILED`（同时阻断 review 与 confirm；workspace 仍可查看）。
- **rebase**：confirm 检测 catalog、账户资格或已入账集合变化时返回409。GET rows/categories只读展示当前资格及viewRevision，不修改持久化状态；客户端重新核对后，POST review携带所读viewRevision，由服务端在事务内核对相同当前视图、刷新本批base/catalog快照并签发绑定该视图的新token。期间又变化则再次409，不保留旧base造成永久stale；原始文件/源事实变化仍必须remove/replace重建版本。

## 6. confirm 事务 / 新分类

- **事务边界（避免长持 DB 写锁）**：重传字节的**解码 + sha256 + 预算校验 + 解析 + merge 候选**全部在**事务外**完成（CPU/内存密集，不得在持写锁时跑 5000 行解析）；进入 `db.transaction` 后只做：重读 `version`/`categorySetHash`/`existingIds`/merge 摘要等**存储事实校验**，然后**立即同步写库**（`better-sqlite3` 同步事务，**无 await、无 provider、无网络**）。分类“先验证后写”仍在该单事务内，保持原子。

单事务、无 provider：①归属/状态 ②files 数量/顺序/sha256 全等且重传全部原字节 ③`expectedVersion` ④比 baseFingerprint 与事务外重算的 merge ⑤**先重读 catalog** 再比 categorySetHash ⑥校验 reviewToken（存在/未过期/analysisRevision 一致/reviewSetDigest 一致）与 selectedItemIds/selectedAssignments（非空、≤500、去重、属本批、`amountCents>0`、eligible；**不 eligible 一律拒绝**；fact_conflict 组 0 或 1；weak_collision/ledger_collision 任一选中即拒）⑦重读 existingIds（“审核时可选、现在 existing”→ 抛 stale 回滚）⑧账户解析 ⑨approvedCategories create/reuse ⑩逐行 INSERT(`id=ledgerId`) ⑪`confirmed`+provenance+result 消息。任一步失败**整体回滚**。

- **新分类（同事务，创建前重读 catalog）**：`(name.trim 非空 ≤40, type, parentId)` 查 `categories WHERE deleted=0`：恰 1 条**活叶**（无子、未删、同 type）→ reuse；0 条 → INSERT（`randomUUID()`、`is_builtin=0`、`deleted=0`、`nextSortOrder`）；≥2 条 → `IMPORT_BATCH_CATEGORY_CONFLICT`（要求手选既有 ID 或改名，不取 sort_order 首项）；命中非叶 → 不可 reuse；与创建前 catalog 相比同名/同类型/同父竞态变化 → stale。用户改写 name 复校唯一性。
- `approvedCategories` 中未被任何 selected row 使用的建议不创建（计 `categoriesSkippedUnused`）；未批准的建议不创建。父级校验复用 `master-data-service.ts:153-173`（仅支出可父、父须支出一级、禁自环）；不 restore 软删行；分析/预览/review 阶段**零分类写**。
- 既有分类 ID 形态：内置为 `builtin-expense-*`/`builtin-income-*`（`seed-data.ts:92-110`），用户新建为 `randomUUID()`；示例用真实形态，**不假设 UUID**。`comparisonAccountId` 取自活账户（名为 微信/支付宝，首导时创建，`portability-service.ts:805-822`），**该平台尚无活账户时为 `null`**。

## 7. AI 分析生命周期

- schema v2：每行**恰一个** `existing|new|null`（互斥）；校验失败整轮AI建议失败。AI来源建议全或无发布；确定性的server-fallback建议独立保留，不能因清理AI结果一并丢失。
- **全或无**：任一分片失败（throw/`AiResponseInvalidError`）⇒ `state='failed'`，清零全部 `ai_*`，不写任何 suggestion，不保留部分结果，**不降级确定性兜底冒充 AI**；确定性兜底走独立 `fallback_*`。
- **>20 建议 = 显式失败**（`failed` + 可读原因），禁止截断前 20；仍可手动分类导入。
- **兜底 Other 有新建途径**：关键词匹配优先尝试同型活叶；无匹配时复用同型“其他/其他收入”。该Other不存在或不是同型活叶时，server 生成 `origin='server-fallback'` 的 `newOther` 建议进 `assistant_import_batch_categories`，**仍需用户在 review 中 approve** 才在 confirm 事务内创建。
- **执行**：同进程后台，**不引外部 queue/worker**。整轮分析 ≤**20 次** provider 调用（25 行/次）；单次超时用既有配置值；新增总预算拟 10 min `未benchmark`。建批次落库后立即 201，client GET 轮询。
- **fence 顺序**：启动前**先在同一事务同步写** `analyse_state='running', analyse_owner, analysis_revision, analyse_lease_until`，**再** abort 旧 reader；所有写回校验 owner/version/revision 三值，不符即丢。`cancel`/`archive` 同样**先同步 fence（置状态 + 清 review_json/lease）再 abort**。
- **重启**：进程启动立即把 `running` 置 `failed`（`analyse_message='服务重启，分析已中止，请显式重试'`），不等 lease 过期，不自动重跑。
- **取消/归档**：in-process `batchId→AbortController` 注册表（形态同 `assistant-generation-runner.ts:299`）；**顺序固定为“先同步写 fence（事务内置状态 + 清 review_json/lease）→ 再按注册表 abort 在途 provider 读”**，防 late write 回报到已取消批次。
- **缺 provider/未配置**：同样 `failed`；手动分类与 review/confirm 仍可用。
- **`GET` 永不启动 provider/分析**（测试断言）；GET 返回 analysis 状态，`confirmed` 时返回 `result`。

## 8. 幂等 / 文件失败 / 资源失败

- **create 与 analyse 幂等**：各带 `clientRequestId`（=idempotency key），**无 payloadHash**；server 算 `requestHash`（解码字节 sha256 有序 + fileName/source/size + options canonical）。同 key 同 hash → 回放前次；同 key 异 hash → 409 `IMPORT_BATCH_IDEMPOTENCY_MISMATCH`；不提供 GET 隐式触发。
- **remove/replace**：body 含 `{expectedVersion, clientRequestId, targetFileIndex?, files[]}`（`clientRequestId` 即幂等键，**不另设 `idempotencyKey` 字段名**），`files[]`=变更后**剩余全部文件**原始字节 + `{source,fileName,fileBase64}`；**replace 也只接受全量**。no-op 需**完整 canonical 输入**（digest+fileName+source+顺序）全等；同 digest 异 name/source → `version+1` 并重算指纹。identity（itemId/ledgerId）不含 fileIndex，重排稳定；`idRemap` 与 `droppedDraftItemIds` 对同一旧 itemId **互斥**。移除最后一个文件 → 400 `ASSISTANT_INVALID`；终态 → 409。
- **文件失败持久化**：`files[].parseStatus='failed'`+`error` 存库；阻断 review/confirm，不锁 workspace 入口（可查看其余、可 remove/replace）。
- **资源失败整批拒绝**：文件数/字节/行/列/单元格/解压/文本/deadline/item>500/sources>5000 任一超限 → 整批 4xx “请拆分后重试”，**不截断**；summary 显式标出未解析文件，不得用 0 或估算冒充完整行数。行分页 ≤100（默认 50，keyset `cursor`）。
- **500 口径**：`500`=materialized item 总数，**含** ignored/existing/conflict 行（同占审核清单、分页、内存）`[FRP]`。

## 9. 与 legacy 的隔离

| 位置 | 处理 |
|---|---|
| `assistant-tool-registry.ts:42` / `:301-322` 200 预览 | 批次**不走**；legacy 保持 |
| `assistant-types.ts:292-293` 200/100 | **不动**；批次走分页 GET，卡片数组 ≤20 |
| `portability-service.ts:890,892` strict `visible`/≤100 | 批次不复用 strict 通路 |
| `assistant-orchestrator.ts:296`、`routes/assistant.ts:473,479,486` | 批次不经过 |
| `POST /actions/:id/confirm`、`assistant_pending_actions` | 批次不可达（无 pending action） |
| `GET /actions/:id/rows/:rowId/duplicates`（`routes/assistant.ts:426`） | 批次用新 `GET .../rows/:itemId/duplicates`，复用同一 `duplicateCandidates` 查询域 |
| `app.ts:63` 8 MiB / `extraRoutes:147-187` | 不动；新路由必须注册其中并被 e2e 断言 |

批次**不**使用 `MAX_RESULT_ITEMS`/`stringArrayArg` 的静默 `slice`；不把 legacy 200/100 施加到新批次。

## 10. `[FRP]` 待最终摘要审批清单（一次呈现，均未批准）

1. 容量集合 §3.1（含整批共享 16 MiB inflate、3000/5000 行、deadline 3000 ms）+ 500 含 ignored/existing/conflict。
2. 失败文件 `201 + parseStatus='failed'` 后显式 remove/replace 继续；存在失败文件阻断 review 与 confirm。
3. `fact_conflict` 0/1；`ledger_collision`/`weak_collision` 任一选中即拒；不 eligible selected 一律拒；result 用 `inserted/selected/excluded/preexisting`（无选中项静默 skipped；`selected`=`inserted`，仅作审计双口径）。
4. 弱 identity 只标候选；legacy `pb-` 命中仅提示；硬 alreadyExists 仅两来源；itemId 碰撞显式守卫。
5. 同名/同类型/同父：恰 1 活叶 reuse；≥2 须改名或显式 `reuseCategoryId`；非叶不可 reuse；approved 未使用不创建。
6. 新增 `POST .../review` + 随机 opaque token + 全量审核集（TTL 拟 15 min）+ rebase 机制。
7. 迁移012四张additive表（含操作幂等记录）；`confirmed` 与批次记录保留、本任务不自动清理。
8. 工具注册策略：不新增 allowlist/无 pending action；批次卡 `kind='text'`+additive `content.importBatch`（**不放宽** tool-card）。
9. 归档/取消围栏：先同步 fence 再 abort；metadata fence，非 cascade delete；cancel 零财务写。
10. AI 全或无；>20 显式失败不截断；`server-fallback` newOther 建议仍需 approve；generation 与批次 AI **共享会话 active lock** 互斥（仅实际 AI/changes），GET 恒允许，review/confirm 不触发 provider。
11. 预算需过 **benchmark 质量门**；未标定前不得声称达标，不得借现网 160 MiB 声称已 safe。

## 11. 自检（本轮实际读码确认）与验证说明

- `platform-bills.ts:401-402`：`wx-/ali-{orderId}.slice(0,64)` 与 `pb-{source}-{simpleHash(dateLabel|type|amount|note)}`；`amount = amountCents ?? 0`（`:392`）——legacy 弱 id 规则据此复刻。
- `platform-bills.ts:387-390`：`note = [goods,counterparty,remark].join(' · ').slice(0,200)`；`parseDateLabel`（`:235-246`）**只用日期前缀、丢弃时分秒**，`transactions.date` 由 `portability-service.ts:977-980` 以日粒度写入，故 `sourceTimestamp` 只进等价键、不改账本语义。
- `portability-service.ts:226-246` `duplicateCandidates`（同账户/同日/同类型/同金额、只读）——新 `rows/:itemId/duplicates` 复用该查询域。
- `db/migrations/` 现最高 `011` ⇒ 迁移编号 `012` 正确。`seed-data.ts:92-110` 内置分类为 `builtin-expense-*`/`builtin-income-*`（非 UUID）；`randomUUID()` 仅用于用户新建分类。
- `assistant-types.ts:285,292-293`：`FORBIDDEN_KEYS` 含 `token`、`MAX_ARRAY_LENGTH=200`/`MAX_OBJECT_KEYS=100`；`app.ts:63` 全局 8 MiB；`xlsx-lite.ts:32-53` 解压无界——均按 §9 保持 legacy 不变。
- `assistant-generation-service.ts:519-561` `hasActive` + `routes/assistant.ts:244-257` `beginLegacyTurn` 即“会话 active lock”，§7/§2.6 的互斥据此描述。

本文件为读码+设计产出：未改 prd/implement/product/tests/spec/代码，未装依赖、未部署、未调真实 provider、未写账本、未动设备、未 `task.py start`、未 stage/commit。行号基于当前工作区快照；CRLF 文件以函数名复核；live 160 MiB 来自 `artifacts/` 记录（非本轮直连容器读取）。`[FRP]`/`未benchmark` 条目在用户明确批准前**不得**作为实施依据。本文档状态为**待最终摘要审批**，**不代表已批准**。
