# 最终规划纠偏评审（只读核查，未批准任何实现）

- 任务：`.trellis/tasks/10-17-ai-bill-import-improvements`（planning）。本文件为**评审产出**：未改 prd/design/implement/契约/代码/spec，未 start，未 provider/设备/部署/安装依赖，未 git stage/commit。
- 读码基线（当前工作区快照）：`packages/shared/src/platform-bills.ts`、`packages/server/src/{app.ts,routes/assistant.ts}`、`packages/server/src/services/{assistant-types,assistant-tool-registry,assistant-orchestrator,assistant-conversation-service,portability-service,bill-import-analysis,xlsx-lite}.ts`、`packages/server/src/db/{index.ts,migrations/*}`、`Dockerfile`、`docker-compose.yml`、`artifacts/*env*.json`、`clients/android/app/src/main/java/com/yansuu1/jizhang/**`。
- 结论口径：**Blocking = 与已确认需求（R3/AC3 等）直接冲突或会丢账/误合并/自失效**；Risk = 冻结前必须定值但可带方案推进。**500 条融合上限为用户已确认，本评审不重开该决策。**

## A. Blocking（阻断，必须改设计后才能冻结）

**B1 弱 identity 同哈希强制“恰选 1”= 静默吞掉真实多笔，违反 R3/AC3。**
证据：`platform-bills.ts:402` 无单号 ledgerId = `pb-{source}-{simpleHash(date|type|amount|note)}`；`simpleHash`（`:264-276`）为 FNV-1a×2 16 hex，注释自认“非加密”。同日 + 同额 + 同备注的两笔真实现金支出**按构造即同 id**（不是碰撞概率问题）。`design.md:167` 却把同 `pb-` id 的多个 item 归为 `weak_collision`“恰选 1”，`design.md:243` 又把它们当审核期派生态；`transactions.id` 是 PK（`001-init.ts:72`），选 2 → 整事务回滚，选 1 → 另一笔永久不入账，且**不产生任何 alreadyExists 记录**（legacy `existingIds` 只在库内已有该 id 时为真，`portability-service.ts:805,844,878-886`）。
最小修正：弱 identity 改为「**独立 row SHA256 occurrence id** + occurrence ledger id」。草拟：`rowSha = sha256(source|fileDigest|rowNumber|dateLabel|type|amountCents|note|rawStatus|orderId)`；`occurrenceLedgerId = pb-{source}-{sha256(...)[0:16]}-o{n}`（同内容第 n 次出现，n≥2 才加后缀，n=1 保持**无后缀 legacy 形态**以便与已存在的历史 `pb-` 行命中 `alreadyExists`）。语义：① legacy 命中 → 该 occurrence 标 `alreadyExists`（硬锁，不入账）；② 同 `pb-` 但**不同 occurrence**的合法多笔 → 全部可导入、各自独立 itemId/ledgerId，只标 `possibleDuplicate` 并列出 `duplicateOfNote`；③ **禁止**把冲突组降级成“恰选 1”。AC3“不同有效交易不能仅因同金额同日被自动合并”由此落地。
`itemId` 同步：`ch:{fileDigest[0:16]}:{rowNumber}:{rowSha[0:8]}`（固定长度，避免 itemId 与 ledgerId 语义混淆）。

**B2 `po:`（强 identity）ledgerId 被 `slice(0, 64)` 截断，不同完整 orderId 会撞同一 ledgerId，而设计未定义该情形。**
证据：`platform-bills.ts:401` `\`${wx|ali}-${orderId}\`.slice(0, 64)` → 有效保留 orderId 前 61 字符；`design.md:150-154` 按**完整** `orderId` 分组并生成 `po:{platform}:{orderId}(#c{n})`；`design.md:163-168` 的 `Map<ledgerId,itemId>` 收敛规则只覆盖“强 identity 事实一致/冲突”“弱 identity 撞 pb-”，**没有覆盖两种不同 orderId 落同一截断 ledgerId**。该分支既不满足 `conflictGroup` 也非 `ch:` → 实现只能二选一：误判为 weak_collision 强制选 1（丢账），或 INSERT 撞 PK 整批回滚（用户不可解）。附：`po:` itemId 无长度上界校验，而契约 §3 要求 itemId ≤100，`#c{n}` 后缀还会叠加。
最小修正：① 建批阶段显式计算 `ledgerId` 与 `fullOrderId` 双值，任何 `ledgerId` 组内出现 **>1 个不同 `itemId`** → 新 `conflict_kind='ledger_collision'`，**confirm 一律拒绝**（`IMPORT_BATCH_IDENTITY_CONFLICT`），禁止合并、禁止取首、禁止降级 weak_collision；② 若要求可导入，则仅对该碰撞组使用 `wx-{orderId[0:40]}-{sha256(orderId)[0:16]}` 形态（**只对新批次启用**，不改 legacy 无碰撞路径）；③ 冻结前明确 itemId 生成式对**任意长度 orderId** 都 ≤100（超长时 `po:{platform}:{sha256(orderId)[0:32]}`），并把 itemId 生成写成可单测纯函数。证据强度说明：夹具 orderId 实测 21/33 字符（`packages/server/test/fixtures/alipay-bill-sample.csv`），**未发现 >61 的真实样本**；因此这是“设计无守卫的未验证假设”，不是已复现故障，但必须按碰撞处理而不是假设不会发生。

**B3 强 identity 合并键把 `note` 当事实，导致“只差备注”被判金额级事实冲突。**
证据：`design.md:150` 合并条件 `(type, amountCents, dateLabel, isRefund, note)` 全一致；`design.md:290` fingerprint 的 items 也含 `note`。而 `note` 由解析期拼接产生并截断：`platform-bills.ts:387-390` `[goods, counterparty, remark]` 去重后 `join(' · ').slice(0,200)` —— 同一真实交易的两次导出/两个文件**完全可以只是 remark 文案或长度不同**，于是被升级为 `#c{n}` 事实冲突，强制人工二选一，另一笔的备注永久丢失。
最小修正：定义**金融等价** `financialEqual(a,b) = type, dateLabel, amountCents, isRefund, platform/account ref, ledger-relevant rawStatus(成功/退款判定位) 一致`，显式声明**忽略** note / 展示型 rawStatus 文案 / sourceCategory / counterparty / goods。强 identity 合并键 = `(platform, orderId)` + `financialEqual`；合并后 `sources[]` 逐条保留**各自完整 note/rawStatus/ignoreReason**，行级默认 note = 首来源完整 note，其余挂 `sources[].note` 供人工选择；`note` 变化**不得**产生 conflictGroup（也就不得进 `IMPORT_BATCH_IDENTITY_CONFLICT`）。`isRefund` 必须留在等价键内（退款事实不可被合并抹平）。

**B4 `ON DELETE CASCADE` 不会随“归档”清理批次；批次缺生命周期与取消/围栏语义。**
证据：`assistant-conversation-service.ts:274-286` `archive()` 只做 `archived=1` + 把 `pending` action 置 `expired`；全仓库**不存在** `DELETE FROM assistant_conversations`（`routes/assistant.ts:516-526` 的 `DELETE` 也只调 `archive`）。故 `design.md:244`“`ON DELETE CASCADE` 挂到 `assistant_conversations`，对话归档即回收”**事实错误**，级联永不触发。`design.md:243` 又只把清理写成 PROPOSAL（保留）。且 `assistant_import_batches.status` 声明了 `cancelled`，但 `routes/assistant.ts:508-514` 的 cancel 只改 pending action，**没有**任何代码把批次置 `cancelled`；批表将无界增长。
最小修正：① `archive(id)` 内追加「把该对话非终态批次置 `cancelled`」并与 action expire 同一处（沿用 `archive` 的单点收口，不新开路径）；② 新增批次取消端点（`POST .../import-batches/:batchId/cancel`）只写 `status='cancelled'`，**绝不触碰账本/分类/账户**，并断言 archived 对话不可再 confirm；③ 明确保留/回收策略（含对话硬删或按 `archived=1 且 updated_at < now-X` 懒清理），把它从 PROPOSAL 升级为冻结项，否则“审计保留”= 无界增长。④ `category_set_hash`/`fingerprint`/`version` 的失效与批次状态迁移写成状态机（prepared→confirmed 单向；cancelled/expired 不可再 confirm）。

**B5 AI 失败/上限语义在 design、契约、legacy 三处互相矛盾，且 `>20 新分类`是静默丢弃。**
证据：`design.md:274`“任一批 throw → `analysis.status='failed'`、清空**该批** recommendations”；契约 `:75`“任一批失败 → `analysis.status='failed'`”；真实 legacy 是**整轮 all-or-nothing**：`assistant-orchestrator.ts:149-162` 的 catch 覆盖整个 25/批循环，失败即 `{status:'failed', analysed:0, recommendations:[]}`，且 `bill-import-analysis.ts:13-14` 对**任一**非法项直接 `throw AiResponseInvalidError`。`design.md:273` 又规定 distinct 建议 >20 时“保留前 20、其余置 null + notice”，这是**静默丢弃**，与同段“不是静默成功”自相矛盾；契约 `:274` 还把 `>20` 挪到 confirm 才报 `IMPORT_BATCH_CATEGORY_CONFLICT`。
最小修正：明确写死「**AI 建议全或无**」——任一 shard 失败 ⇒ `analysis.status='failed'`、清零**所有** `batch_rows.ai_*`、不写任何 suggestion、不降级为确定性“其他”，响应/卡片不得出现任何伪成功标记（并保留 legacy 文案：可核对、可显式重试）。`>20` 改为**显式失败**：`analysis.status='failed'` + 用户可读原因「AI 建议新分类数超上限（N>20），请手动分类后重试」，或“建议全部可见、只有创建数受限”，二者择一，**禁止截断前 20**。分片序号、已成功 shard 的处置必须写成显式契约（保留 or 丢弃），不能停在“该批”这种含糊措辞。

**B6 confirm 协议自失效：客户端必须回传 prepare 指纹，而指纹输入又包含客户端新增的 edits。**
证据：`design.md:286-295` 指纹输入含 `selection/categoryOverrides/noteOverrides/approvedCategories`，且“prepare 与 confirm **各自**重算并比对”；契约 `:236` 要求 body 带 `"fingerprint": "<prepare 返回的 sha256>"`、`:252` 步 4“重算 merge + fingerprint → 比对”。prepare 阶段不存在这些 edits（pending action 里的 `selectedIds` 在无 AI 预选时为 `null`），因此**任何一次“改了选择再确认”都必然指纹不等 → `ASSISTANT_ACTION_STALE`**。legacy 之所以不炸，是因为它由**服务端**在 confirm 内部重跑 prepare 并把结果指纹写进 arguments（`assistant-orchestrator.ts:291-305` 的 `editedPreview.fingerprint`→`argumentsForConfirm`），客户端从不回传“已编辑指纹”。
最小修正（择一，推荐 ①）：① confirm **不接收客户端 fingerprint**：body 只带 `version` + 全量 `files[].sha256` + edit set + 可选 `idempotencyKey`；服务端在事务内重算 **base** fingerprint（files + merge + version + categorySetHash，与 prepare 存库值比对）并对 edit set 做结构性校验（itemId 属于本批/组内恰选 1/键数≤选中数）。② 若坚持“先 review 再确认”，新增 `POST .../review`：服务端校验 edit set 后**签发** `reviewToken`（= 含 edits 的批次指纹，服务端存储、version 绑定），confirm 只回传 `reviewToken`；禁止让客户端自己拼指纹。无论哪种，`noteOverrides` 的 `""` 清空语义必须保留。

**B7 implement.md 基于不存在的技术栈与路径（不可执行）。**
证据与事实对照：`implement.md:61`“开启 Prisma/SQL 事务”——仓库无 prisma/pg 依赖（`packages/server/package.json` 只有 `better-sqlite3`，事务走 `db.transaction`，`portability-service.ts:953`、`assistant-orchestrator.ts:311`）。`implement.md:39` `packages/shared/src/models/assistant-import.ts`——`packages/shared/src` 是**扁平文件 + `index.ts` barrel**，无 `models/` 目录。`implement.md:31` Android 路径 `com/jizhang/app/ui/assistant/`——实际为 `com.yansuu1.jizhang`（`clients/android/app/build.gradle.kts:43,48`），assistant UI 在 `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/`，网络层在 `.../repo/AssistantRepository.kt`。`implement.md:200` “状态提升至 `ViewModel`”——仓库内**不存在任何 ViewModel 类**（`grep -rln ViewModel clients/android --include=*.kt` 为空），现有形态是 `AssistantImportState.kt` 的 pure function + Compose state（如 `reconcileImportSelection`）。另 `implement.md:44-46` 错误码 `BATCH_LIMIT_EXCEEDED / FILE_PARSING_FAILED / FACT_CONFLICT_DETECTED` 与契约的 `IMPORT_BATCH_*` 冲突；`implement.md:40` DTO `{name,size,sha256,mimeType}` 与契约 `{fileName,source,fileBase64}` 冲突（且 sha256 必须由服务端算，见 `routes/assistant.ts:171-190` 与 `parseAttachment` 惯例）。
最小修正：重写 implement.md 到真实栈与路径；DTO/错误码**唯一真源取契约草案**（`{error:{code,message}}` + `IMPORT_BATCH_*` + `ASSISTANT_*`）；若确需跨端共享纯逻辑，只允许新增 `packages/shared/src/import-batch.ts` 并从 `index.ts` 导出，不新建 `models/` 目录。补充：新路由必须注册进 `packages/server/src/app.ts:147-187` 的 `extraRoutes`（否则脱离 auth guard），`migrate.ts:48-53` 追加 012（现最高 11，编号 012 正确）。

**B8 资源预算与 live 堆上限量级不匹配（会 OOM，而不是“稍慢”）。**
证据：设计给 xlsx 解压上限 单 entry **64 MiB**、合计 **128 MiB**（`design.md:103-104`）、解码后文本 **32 MiB**（`:105`）；而 live 容器生效值为 `NODE_OPTIONS=--max-old-space-size=160`（`artifacts/live-stream-diagnosis-deploy-before-env.json:1`、`.trellis/tasks/archive/2026-10/10-15-ai-streaming-interactive-dialogue/deploy-status.md:41`、`deploy/CUTOVER-KNOWN-SERVER.md` 的 runtime override；源码默认 256 见 `Dockerfile:47`/`docker-compose.yml:27`，无 bump）。叠加峰值还包括：请求体 base64（20 MiB 原始 → 约 26.67 MiB 字符串）+ 解码 bytes 20 MiB + inflate 结果（可达 128 MiB）+ UTF-16 文本（GBK/中文按 2 B/char，32 MiB 文本 ≈ 64 MiB 常驻）+ `parseCsv` 单元格数组。128 MiB inflate 单独就已逼近 160 MiB 堆。且“10000 行安全”的依据是**夹具密度外推**（`design.md:99-102`，55–120 B/行），未测真实多年导出，也未给解析 CPU/延迟边界。
最小修正：预算改为**feature-scoped 且以 live 160 MiB 为上限假设**（见 C 节），并同时约束 **bytes × inflate × rows × 解析墙钟**四维；xlsx 侧要加的不止 `maxOutputLength`：`xlsx-lite.ts:32-53` 的 EOCD entry `count`、`compSize`、`localOffset`、`dataStart+compSize` **均无边界校验**，需补 entry 数上限、偏移/长度越界拒绝、解压后长度与声明一致性校验。数值必须在并入实现前用**真实导出样本**标定（benchmark 记录进 research），不得由夹具密度推 10000 可安全。

**B9 新工具名注册与批次取消/确认路径未验证，属于“加一个名字就炸/双写入口”风险。**
证据：`assistant-tool-registry.ts:431-450` 的 `registerAll()`：allowlist 名字缺 definition → 构造期 `throw`；definition 不在 allowlist → `throw`；`:953-956` 注册数与 allowlist 长度不等 → `throw`。`AssistantToolRegistry` 构造即 `registerAll()`（`:363-366`），而 registry 在 `buildAssistantContext` 中实例化 ⇒ **只加名字不注册会让服务启动即失败**（不是运行时提示）。同时 `:392-425` 要求 write 工具有 `prepare` **且** `confirm`，`:417-423` 的 `confirmInTransaction` **拒绝 Promise**（“必须同步”），即批次 confirm 若走 registry 就不能是 async；但批次 confirm 需要重算 merge/建类/写账——与 legacy `portability` 同步写入同构可行，前提是**同步实现**并把 provider 调用留在 prepare 阶段。另：批次若要 `pendingActionId`，`assistant_pending_actions.source_message_id` 为 `NOT NULL REFERENCES assistant_messages(id)`（`009-assistant.ts:34`），批次路由必须先有一条消息再建 action；且 legacy `POST /actions/:id/confirm`（`routes/assistant.ts:464-506`）对任何 pending action 都会走 `prepareConfirmation` 的 ≤100 分支（`assistant-orchestrator.ts:292-305`），所以**新工具名必须同时从 legacy confirm 通路显式拒绝**，否则出现第二写入口。
最小修正：冻结三件套——① `ASSISTANT_TOOL_NAMES`（`assistant-types.ts:23-55`）与 definition 与 handlers **必须同改**，并加一个“allowlist ⊇ 实际定义 ⊇ handler 齐备（write 必含 prepare+confirm）”的启动自检（扩 `:431-450` 既有循环）；② 批次 confirm 若不复用 registry，`confirmInTransaction`/`/actions/:id/confirm` 必须对批次工具名返回明确 4xx 并断言“批次只能走 `/import-batches/:batchId/confirm`”；③ 批次取消只改批次状态，**零财务写**，并断言取消后 confirm 返回终态错误、无 `transactions/categories/accounts` 变更。

## B. Risk（冻结前定值，不阻断当前评审）

**R1 批次卡仍受 `normalizeAssistantJson` 静默裁剪。** 卡片经 `conversations.appendMessage`→`normalizeAssistantContent`→`normalizeAssistantJson`，数组 >200 静默 `slice`、对象 >100 键 `throw`（`assistant-types.ts:292-323`；`assistant-tool-registry.ts:186-192` 的 `hashJson` 同样走该规范化，故 design §8 说的“不复用 hashJson”必须**真的不复用**，否则 500 行会被静默切到 200 后再算指纹）。建议：批次卡内所有数组硬性 ≤200（`files`≤5、`notices`≤20、suggestions≤20），行数据只走分页 GET；加一条测试断言“卡片 JSON 里任何数组长度 == 输入长度”。

**R2 分页/排序与 `#c{n}`/`idRemap` 的确定性未闭环。** `design.md:302-304` 只给原则，未给可测规则（`ordinal` 的 tie-break、冲突消除后 itemId 归一、`ch:` 换文件后 `droppedDraftItemIds` 与 `idRemap` 互斥）。建议把 itemId 生成 + ordinal 排序 + remap 计算做成 `packages/shared/src/import-batch.ts` 的纯函数并单测（唯一允许新增 shared 文件）。

**R3 `>500` 与 `ignored/existing` 计入仍写在 PROPOSAL（`design.md:379`）。** 用户已确认“每批最多 500 条融合交易”，但**未**确认 ignored/existing 是否占额。建议按用户口径最小解释：500 = **materialized item 总数**（含 ignored/existing，因为它们同样出现在审核清单与分页），并在同一处写明；这不是重开 500 决策，只是把已确认口径写清。若用户另有口径，再单独调整。

**R4 legacy 200/100 与批次限额的边界冲突点清单必须落成代码守卫表。** 已核实的独立落点：`assistant-tool-registry.ts:42,43,154,297,302`、`assistant-types.ts:292-293`、`routes/assistant.ts:17,159,166,473,479,486`、`assistant-orchestrator.ts:296`、`portability-service.ts:890-902`。批次路径**不得**借这些常量；建议在 implement 里逐条写明“批次不走该处”，并加回归测试证明 legacy 仍为 200/100。

## C. Engineering proposal：边界数值（拟值，待批准；用于替换 `design.md:95-127`）

前提假设：live 堆 160 MiB（R/B8 证据）。目标：单请求解码峰值 ≤ 约 48 MiB，且与 rest-of-app 共存。全部为 **feature-scoped**，不动 `app.ts:63` 全局 8 MiB、不动 legacy 5 MiB 单附件常量。

| 预算 | 现草案 | 拟值 | 理由 |
|---|---|---|---|
| 文件数 | 5 | **5**（不变） | 已验证多文件场景足够 |
| 单文件字节 | 5 MiB | **3 MiB** | 真实月/季导出远小于此；与 legacy 5 MiB 解耦（legacy 常量不动） |
| 合计字节 | 20 MiB | **8 MiB** | base64 ≈10.7 MiB，留出 JSON 包裹余量 |
| 路由 bodyLimit | 32 MiB | **12 MiB** | = ceil(8/3)*4 + 余量；仅 4 条新路由 |
| 解压：单 entry | 64 MiB | **8 MiB** | 覆盖 sharedStrings + sheet1 真实量级 |
| 解压：整批合计 | 128 MiB | **24 MiB** | ≤3× 原始字节，防 zip bomb |
| 解压：entry 数 | 未定 | **≤64** | `xlsx-lite.ts:32-53` 现无任何校验 |
| 解码后文本（单文件/整批） | 32 MiB | **6 MiB / 16 MiB** | 中文按 UTF-16 约 2 B/char，仍需 32 MiB 常驻 |
| 原始数据行：合计 | 10000 | **5000** | 该维度是 **CPU/延迟**边界，不是内存边界；`design.md:99-102` 的密度外推不成立为安全证明 |
| 原始数据行：单文件 | 5000 | **3000** | 防单文件吃满 |
| 解析墙钟（每文件/整批） | 未定 | **800 ms / 2000 ms** | 新增维度；超时→整批 4xx，不截断 |
| 融合 item 上限 | 500 | **500（用户已确认，不动）** | — |
| 新分类上限 | 20 | **20（但超限=显式失败，禁止截断，见 B5）** | — |

标定要求（并入实现前）：用真实微信/支付宝导出样本（多年、含退款、含同额同日同备注、含 GBK CSV 与 xlsx）跑峰值 RSS 与耗时记录，写回本目录 research；数值未标定前不得写成已批准。

## D. 最小修正映射（供下一步改草案，不在本文件执行）

- `design.md`：§5.2 合并键改金融等价（B3）+ 弱 identity occurrence id（B1）；§5.3 增 `ledger_collision` 分支（B2）；§6 删“归档即回收”并加批次状态机/取消/保留（B4）；§7.2 改 AI 全或无 + `>20` 显式失败（B5）；§8 指纹拆 `base` 与 `edits`（B6）；§3/§4 换 C 节预算；§11 工具名注册/自检/双入口拒绝（B9）。
- `research/merged-import-contract-proposal.md`：`confirm` body 去掉客户端 `fingerprint`（或引入 `reviewToken`）；`itemId` 形态与长度上界按 B1/B2 重写；错误码增 `IMPORT_BATCH_LEDGER_COLLISION`（或复用 `IMPORT_BATCH_IDENTITY_CONFLICT` + `conflictKind`）；补批次 cancel/archive 端点。
- `implement.md`：按 B7 全量重写技术栈/路径/DTO/错误码；
- `clients/android/README.md`：仅在实现落地时更新（本评审不动）。

## E. 本评审不能断言的部分

- 未发现 orderId >61 字符的真实样本（B2 为设计守卫缺失，非已复现碰撞）。
- 未跑任何测试/基准；C 节数值是**推理 + 夹具观测**所得，不是实测结论（`design.md:99-102` 的密度数据为唯一实测输入）。
- live `NODE_OPTIONS=160` 来自 artifacts/归档记录，非本轮直连容器读取。

## F. 验证说明

- 命令级证据：`grep` 定位 `platform-bills.ts:264-276,401-402`、`design.md:150-168,243-244,273-274,286-297`、`contract:75,236,252,274`、`assistant-orchestrator.ts:149-162,291-305`、`assistant-conversation-service.ts:274-286`、`assistant-tool-registry.ts:42-43,186-192,297-302,431-450,953-956`、`xlsx-lite.ts:32-53`、`Dockerfile:47`、`docker-compose.yml:27`、`artifacts/live-stream-diagnosis-deploy-before-env.json:1`、`clients/android/app/build.gradle.kts:43,48`、`AssistantImportState.kt`；`grep -rln ViewModel clients/android --include=*.kt` = 0 命中；`packages/shared/src` 无 `models/`。
- 本文件为唯一改动；未 start、未改代码/规范/PRD/implement、未装依赖、未部署、未调 provider、未动设备、未 git stage/commit。
