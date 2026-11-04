# Backend Investigation: AI Bill Import Improvements (READ-ONLY)

Status: DONE (investigation only; no product/test/spec/PRD change, no provider/device/deploy)
Owner: yansuu1 (backend scope) | Frontend/Android parallel: see §7
Task: `.trellis/tasks/10-17-ai-bill-import-improvements` (planning)
PRD constraints honored: R1–R5, “预览200/确认100上限不静默扩大”, “AI不改金额/日期/订单号/退款事实、不自动财务确认”, “R4人工确认点必须用户决策”.

## 1. 当前分类建议完整链 (生成->持久化->预览->确认)

1. 生成 (advisory-only, 无写权限):
   - `packages/server/src/services/assistant-orchestrator.ts:143-158`: 先 `registry.prepare(...,'platform-import.prepare',...)` 做确定性干跑预览, 再取 `prepared.preview.rows` (bounded 200) + `prepared.preview.categories`, 按每批25行调 `provider.complete(..., feature:'bill-import', responseSchema: BILL_ANALYSIS_SCHEMA)`.
   - Prompt: `packages/server/src/services/ai-provider-service.ts:182-185` (`systemPrompt` bill-import分支): 要求“每已知行恰一条 `{id,include,reason,categoryId}`; `categoryId` 为有效现有同类型ID或null; 含排除行; 无额外字段; 硬拦截仍权威; 不编造退款”.
   - 校验: `packages/server/src/services/bill-import-analysis.ts:17-31` (`normalizeBillRecommendations`): 顶层恰一键`recommendations`; 长度必须`==rows.length`; 每项恰4键; `id`必须命中本批且去重; `include`布尔; `reason`非空且`<=300`; `categoryId`为null或“同`row.type`的已知分类ID”. 任一失败抛 `AiResponseInvalidError`.
2. 持久化 (只存已验证建议, 不存原始provider输出):
   - 成功: `assistant-orchestrator.ts:158` -> `analysis={status:'complete',analysed:rows.length,recommendations}`.
   - 失败: `assistant-orchestrator.ts:159-161` catch-all -> `analysis={status:'failed',analysed:0,recommendations:[],message:'AI分析失败或未配置…'}`. 不存prompt/密钥/附件字节/原始响应 (注释同处; 存储边界见 `assistant-types.ts: normalizeAssistantJson` + `assistant-conversation-service.ts: PendingRow/attachment_*` 单附件列).
   - `assistant-orchestrator.ts:163-172`: `analysedPreview=jsonObject({...prepared.preview, analysis})`, `createPendingAction({arguments: prepared.arguments, preview: analysedPreview, fingerprint: prepared.fingerprint, attachment})`. 注意 `arguments` 此时是 `{source,fileName,selectedIds:null,categoryOverrides:{},noteOverrides:{}}`, **不含AI推荐**; 指纹 `hashJson({digest,source,fileName,selectedIds,categoryOverrides,noteOverrides,categories,rows})` 见 `assistant-tool-registry.ts:811` (prepare) / `:833` (confirm重算).
3. 预览 (确定性事实 + AI建议并列, AI不改事实):
   - 分类投影: `assistant-tool-registry.ts:275-277` (`importCategories`): 读 `masterData.listCategories()`, 过滤掉“有活子类的支出父类” (不可记账父), 只给 `{id,name,type}`. 这就是AI可见的全部候选 + stale-hash输入 + Android分类编辑器的数据源 (与Android A028“仅现有活跃同类型可记账ID”同源).
   - 干跑: `assistant-tool-registry.ts:800-811`: `portability.importPlatformBills(bytes,{dryRun:true,strictCategories:true,categoryIds:categoryOverrides,noteOverrides})`, 再 `boundedRows` (`:301-322`) 截断到200行并裁剪字段 (`note`原文, `counterparty<=120`, `sourceCategory/categoryName/accountName<=80`, `ignoreReason/duplicateOfNote<=160`, `alreadyExists/possibleDuplicate/ignored` 布尔).
   - 行事实来自共享解析, 见§3.
4. 确认 (从不重跑AI; 重验事实+指纹+附件, 原子写入):
   - 路由: `packages/server/src/routes/assistant.ts:434-461` (`POST /actions/:id/analyse` 显式重试: 要求原字节size/SHA匹配pending附件, 调 `orchestrator.handleMessage` 生成替换卡并关闭旧卡) ; `:463-504` (`POST /actions/:id/confirm`: 解析 `fileBase64(<=5MB)`, `selectedIds(1-100显式, 不接受null/省略, Android A024)`, `categoryOverrides/noteOverrides(各<=100项,备注值<=200)`, 并发同action复用Promise).
   - 编排: `assistant-orchestrator.ts:275-308` (`prepareConfirmation`): 附件摘要必验; `registry.prepare(pending.arguments)` 指纹比对; `edits.selectedIds/categoryOverrides/noteOverrides` 的每个ID必须属于当前200预览 (`validIds`), 否则 `ASSISTANT_ACTION_STALE`; 非空1–100强制; 用编辑后参数再 `prepare` 求 `__fingerprint`; `assistant-orchestrator.ts:311-341` (`confirmAction`+`db.transaction`+`confirmInTransaction`): 同事务内写账+置`confirmed`+追加result消息, 已确认重复返回既有结果 (幂等).
   - 执行: `assistant-tool-registry.ts:820-837` (platform-import confirm): `selectedIds`空/>100拒绝; 重算 `categories=importCategories`; dryRun重跑求 `currentFingerprint` 与 `__fingerprint` 比对, 不等则 `ASSISTANT_ACTION_STALE`; 再 `dryRun:false` 真写. 真写见 `portability-service.ts:760-1070`, 严格校验见 `:887-910` (同下).

## 2. “为何可能只到其他” — 已证实 vs 待复现

已证实 (读码可断言, 无需真机):

- A. 确定性兜底先行, 与AI无关: `packages/shared/src/platform-bills.ts: categorizeExpense()` 未命中关键词即返 `'其他'`; `categorizeIncome()` 未命中即返 `'其他收入'`. 关键词表很小 (`EXPENSE_KEYWORDS`餐饮/交通/住房/购物/娱乐; `INCOME_KEYWORDS`工资/薪资/奖金/退款). `portability-service.ts: effectiveCategory()` 无覆盖即用该名. 因此**预览`categoryName=其他`是解析层默认值, 不是AI结论**.
- B. AI建议从未自动成为确认输入: 确认读的是 `categoryOverrides (rowId->categoryId)`, 不是 `preview.analysis.recommendations[].categoryId`. 后端无任何“把recommendation回填为override”代码 (`grep recommendations` 仅 orchestrator组装 + provider prompt + organization语义, 无回填). 用户若只看AI建议而不逐行选分类并发送覆盖, 严格确认必按 `:904-910` 逐行要求 `options.categoryIds[row.id]` 为“存在、未删除、同type、支出叶 (无活子)”ID, 缺失/错型/父类直接 `400/ValidationError('请为所选账单选择有效的同类型现有叶分类')`, 不会静默用“其他”入账. 反之若走非严格遗留路径 (`strict=false`, 仅数据管理CSV/旧路由) 才会 `ensureNamedCategory('其他')` 自动建/复用, 但助手链恒 `strictCategories:true` (`registry.ts:801,832,836`).
- C. `categoryId:null` 是合法AI输出 (prompt与schema均允许). `normalize` 接受null; 前端应理解为“无可用分类/需人工处理” (PRD R1/AC1), 而非缺陷. 若模型对所有行返null, 预览将全行无建议, 属模型/候选投影问题, 不是解析失败.
- D. 部分批次失败即整体丢弃: `orchestrator.ts:149-161` 任一批 `normalize` 抛错即整单 `failed+recommendations:[]` (测试 `assistant.test.ts:354-358 'discards earlier recommendations when a later batch fails'` 已锁定). 用户看到的“全其他”此时实际是“AI失败 + 确定性其他”, 不是“AI全判其他”.

待复现 (需用户提供脱敏样本/日志, 后端无法单方定论):

- T1. AI是否真被调用: `failed` 统一文案掩盖了“未配置/超时/non-2xx/超长/坏JSON/行数不对/错型ID”全部原因. 区分需服务端日志 + `GET /api/v1/ai/config` (`hasSecret/encryptionKeyConfigured`, 不返密钥) + `POST /api/v1/ai/test`, 不能靠预览文案. 后端测试用 `billScenario=valid|invalid|failure|partial-failure` + `assistantProviderFailure` 模拟, 但生产排障必须看日志 (不外传原始账单).
- T2. Android是否把 `recommendation.categoryId` 预填为编辑器初始值/初始选择: 后端A027/A029只管“完成建议最多100初始选择; 失败不选; 草稿保留已编辑未选中”, 分类草稿是否回填是Android侧 (`AssistantImportWorkspace/AssistantImportState`), 需前端owner确认. 若前端未回填, 用户体感即“AI说了但还要一个个手选”.
- T3. 候选投影是否缺用户期望分类: `importCategories` 排除“有子支出父”与已软删除; 若用户期望的分类恰是父类/已删除/跨类型, AI依法不能返它 (返即整批失败), 只能null. 需对照 `GET /api/v1/categories` 活表复核.

AI失败分辨 (给支持/测试的最小动作):

- `analysis.status==failed` 一律按“规则预览可用、AI不可信”处理, 必须显式 `analyse` 重试 (需原文件字节, 新卡、旧卡cancelled、人工编辑重置 — 路由 `:434-461`, spec ai-provider.md “Human-reviewed assistant bill import” 段).
- 坏JSON/错ID/错型/超长reason/多余财务字段 -> `bill-import-analysis.test.ts:14-24` 全拒; provider层超时/non-2xx/超大 -> `AI_PROVIDER_TIMEOUT/ERROR` 安全错误, 不进持久化. 两者在客户端预览上同形, 服务端日志才可分. **不要把 `failed` 当“AI已判其他”**.

## 3. 解析/去重/退款事实 (AI无权改)

- 微信/支付宝判定与表头: `platform-bills.ts: detectPlatformBillSource / locatePlatformHeaderRow (前80行, 需time+amount+direction+orderId等>=3分)`.
- 忽略 (软性, 非AI决定): `ignoreReasonFor` — 金额无效/不计收支/中性/`失败|关闭|异常`/非成功状态/投资理财-充值提现-账户转存-信用借还 (支出侧)/资金划转理财. 收入侧平台标收入即放行 (即使含提现字样). `ignored+ignoreReason` 进预览, 但**14任务R7后助手内“规则原因仅信息标签”, 只要 `amountCents>0 && !alreadyExists` 且在200预览内即有资格被显式选中** ( microbiology: `portability-service.ts:881-884`候选集 + `:891-893`严格选择校验 `!existingIds && amount>0`; `ignored` 不再是硬拦截 — 与遗留数据管理路径语义不同, 回归需覆盖).
- ID/去重: 有单号 -> `wx-{orderId}/ali-{orderId} (<=64)`; 无单号 -> `pb-{source}-{simpleHash(date|type|amount|note)}`. 硬拦截 `alreadyExists=existingIds.has(id)` (全表transactions.id); 软提示 `possibleDuplicate+duplicateOfNote` 仅“同平台账户(微信/支付宝按名找活账户)+服务端本地同日+同type+同分”首命中 (`portability-service.ts:809-849`, comparison详情见 `assistant-import-comparison-service.ts`, 只读分页 `limit 1-50 default20`). 确认时已选重复计 `skipped`, 不写 (`:966-973`).
- 退款: `isRefund = isIncome && /退款/.test(tradeType+sourceCategory)`; 支出侧退款状态只给 `refundWarning` (“原支出保留…不自动关联”), 不另生收入、不链. 终态退款词 (`已退款/全额退款/部分退款`) 外的状态 (`退款中/待退款/退款审核中`) 不算完成. 确认保留 `isRefund` 与 `noteOverrides[""]==清空` 精确语义 (测试 `assistant.test.ts:317-330`, `platform-import.test.ts:284-296`).

## 4. 多文件现状与最小可行组织策略

现状 (单附件契约, 改多文件即破契约):

- 单值: `assistant-types.ts: AssistantAttachmentMetadata{source,fileName,sizeBytes,sha256}` 单对象; `assistant.ts: parseAttachment (:171-190)` 单文件 (`xlsx/csv`, wechat<->xlsx/alipay<->csv配对, `b64Bytes<=5MB`); 消息 `content.attachment` 单个; `registry.ts: AssistantToolContext{attachmentBytes?,attachment?}` 单份; `assistant-conversation-service.ts: PendingRow attachment_sha256/name/size` 单组列 (`toAttachment`缺任一即500).
- 限额: 预览 `MAX_IMPORT_PREVIEW_ROWS=200` (`registry.ts:42,301-302`; 服务端 `portability-service.ts:890 visible=slice(0,200)`, 超出行的override直接 `400`); 选择 `selectedIds 1-100显式` (`registry importArgs :290-298`, confirm `:830`; orchestrator `:296`; 路由 `:463-504`; `stringArrayArg slice(0,100)` + 显式 `>100` 拒绝, 不静默截断); 覆盖各 `<=100项`.
- 一致性: `size+sha256` 全链比对 (发送/analyse/prepareConfirmation/confirm); 跨请求需重传原字节, 进程/切页丢附件需重选 (Android A030-A031).
- 跨文件: 后端无合并预览. 第二文件 = 第二次 `handleMessage(attachment)` = 新pending+新卡. 未确认文件互不可见; 稳定ID跨文件去重仅在前一文件**已确认入库**后通过 `existingIds` 生效; 同批多pending并发确认受 `confirmingActions` 单action锁 + 事务/幂等保护, 但无“跨action原子” . 同一 `orderId` 在两文件即同 `wx-/ali-` ID, 后确认者计 `skipped`.

最小组织策略 (不猜产品, 给选项, 需用户拍板见§6):

- S0 零后端改 (推荐默认): 逐文件顺序“上传->AI分析->审核->确认”, 前一文件确认后再传下一文件. 跨文件重自动变 `alreadyExists/skipped`, 失败重试按文件隔离. 前端只需多文件队列UI (逐文件状态/失败重试/已确认文件不再重选).
- S1 前端合并选择、后端不动: 仍逐文件pending/确认, 但前端把多文件选择队列化, 禁止跨文件单卡确认. 100/200语义保持“每文件”, 最简单且不破指纹/审计.
- S2 后端合并预览 (破契约, 需新PRD/design): 新 `attachments[]`/多pending合并/合并指纹/合并200与100语义重定义 (是“每文件”还是“合计”?)/审计事件扩展. **PRD已写“明确多文件策略前不静默扩大200/100”, 故S2必须先决策再设计, 本次不做.**

## 5. 新分类边界 (现有CRUD + 与导入确认的兼容)

现有:

- `POST /api/v1/categories` 创建, `PATCH /:id` 改名/图标/色/排序/父, `DELETE /:id` 软删 (内置拒删、可改名), `GET /:id/usage` 影响预览 (`routes/master-data.ts:82-107,177-…`).
- `master-data-service.ts:184-211 createCategory`: `name(非空,<=40)`, `type 0|1`, `icon<=32 default other`, `color ARGB`, `parentId` 经 `requireParentId(:153-173)`: 仅支出可有父、父须同类型支出一级 (无父之父)、禁自环; 无同名唯一约束 (migration `001-init.ts` categories无UNIQUE; `ensureNamedCategory` 同名同类型“活的按sort_order取首个”, 软删可复活, dryRun可虚ID). 同名跨类型/同类型重复名在技术上允许, 语义靠调用方保证 — 这正是导入必须用ID而非名的理由.
- 助手 `category.create/update/delete` 为独立写工具, 各自pending+指纹+确认 (`registry.ts` category段; 测试 `assistant.test.ts:273-293`), 与 `platform-import.prepare` 不在同一事务.

兼容边界:

- 助手导入确认恒 `strictCategories:true`, `categoryIds` 必须全是“存在、未删、同type、叶”ID (`portability-service.ts:904-910`); 通过 `ensureNamedCategory` 的“按名自动建/复活”是**遗留非严格路径** (`resolve()`仅 `strict?[]:categoryPlan`), 助手链不走. 因此今天**AI/用户都不能在导入确认一步顺手建类**: 传名无效 (要ID), 传未知ID直接整单 `400` 无部分写 (测试 `:296-308` 断言无创建/无恢复/无部分导入).
- 若R4确认为“允许AI建类”, 最小兼容二选一 (需用户决策, 不在本轮实施):
  (a) 两步式 (推荐, 原子性清晰): AI只给 `newCategory建议{name,type,parentId,evidence}` (如organization语义预览), 用户在导入工作区外先 `category.create` 确认, 再回导入选新ID. 取消不写 (pending过期/cancel即无写, `assistant.ts cancel`).
  (b) 导入事务内建类 (破边界): 需把建类纳入 `importPlatformBills` 同事务 + 指纹覆盖新类 + 重名/跨类型/越权 (删父/内置) 规则 + 取消回滚语义, 并与遗留“名自动建”契约切割. 设计与审计成本大, 不建议默认.

## 6. 必须用户决策 (不猜“运行爱创建分类”原意)

1. R4原句是否为“允许AI创建分类”? 若是: (i) AI可否主动建, 还是仅建议+人工点创建? (ii) 创建时点 (导入确认前独立确认 vs 导入同单原子)? (iii) 重名 (同名同类型已有活类) 是复用首个、报错改名, 还是允许重复? (iv) 父类/类型越权 (收入建父、跨类型) 一律拒, 是否接受? 在用户书面确认前, 后端保持“仅选现有叶ID”.
2. AI建议是否自动回填为 `categoryOverrides`? 选项: 保持现状 (建议仅供看, 必须人工逐行选; 最安全) vs 前端预填可改 (需定义null/失败/101+编辑保留语义, Android A029“不静默丢弃101st编辑”边界). 后端无需改, 但需明确归属以免重复实现.
3. 多文件语义: S0/S1 (每文件200预览/100选择, 顺序确认) 还是 S2 (合并卡+合计限额)? S2需新PRD/design/审计, 且不得静默扩限.
4. 排除按钮逐项定义 (R2): “查看排除原因 (只读`ignoreReason`/`rawStatus`/`refundWarning`)” / “筛选排除项 (前端filter, 不改选择)” / “选择不导入 (从`selectedIds`省略, 草稿保留)” — 后端契约已支持 (省略即排除, 草稿不清除), 前端按此映射即可, 硬拦截 (`alreadyExists/amount<=0/>100/指纹`) 文案不得弱化为普通排除.

## 7. 测试缺口与可并行owner建议

后端已锁定 (勿重测): `bill-import-analysis.test.ts` (一比一行/错ID/错型/超长/多余字段全拒); `assistant.test.ts: reviewed bill import` (200预览/100选择/备注清空/退款身份/失败重试/部分批失败全弃/错类400/原子无部分写/并发幂等); `platform-import.test.ts: strict compatibility + duplicate heuristic + legacy facts 400`.

缺口 (按owner并行, 均需脱敏夹具, 禁原始账单外传/真provider记账):

- B1 (backend): “全其他率”归因测试 — 构造无关键词行, 断言 `categoryName==其他` 且 `analysis.recommendations[].categoryId` 可为有效叶ID, 证明两层独立. 另加同名同类型重复类时 `ensureNamedCategory取首个` 的歧义测试 (当前无).
- B2 (backend): `failed` 原因可观测性 — 现有 `invalid/failure/partial-failure` 均收敛为同形 `failed`, 建议只加日志/测试断言 (不改变客户端契约), 区分“未配置/超时/坏JSON”.
- B3 (backend): 跨文件稳定ID — 两文件同orderId, 第一文件确认后第二文件预览 `alreadyExists`, 第二文件先预览 (未确认) 则仍可选, 确认第二单时第一单若已入库则 `skipped`. 当前无双pending夹具.
- F1 (frontend/Android owner): AI建议回填/初始选择/101st编辑保留/排除三按钮文案与可用条件 (A023-A030), 多文件队列 (S0/S1) 的逐文件状态与失败重试, 大字/弱网/200行滚动 (现有Android README证据等级为源码审计, 设备验收另行).
- 协作点: 若定S2或R4建类, 必须先由主代理合拢前后端契约 (附件数组、合并指纹、建类事务边界) 再进实现; 本报告不预设方案.

## 8. 验证说明

- 本轮仅读码 + 现有测试清单核对; 未安装依赖/未改代码/未调真实provider/未做账务写入/未部署/未动设备. (`android-import-investigation.md` 为前端并行文件, 本报告不代写.)
- 关键证据路径 (行号为当前main快照, CRLF文件用函数名复核): `assistant-orchestrator.ts:136-190,275-341`; `assistant-tool-registry.ts:42-43,154,275-322,786-837`; `bill-import-analysis.ts:全文件(37行)`; `ai-provider-service.ts:182-185`; `routes/assistant.ts:171-190,390-411,434-504`; `portability-service.ts:760-1070 (尤:809-910,966-973)`; `shared/platform-bills.ts:79-…(关键词),270-443(忽略/分类/ID)`; `master-data-service.ts:153-211,280-…`; `routes/master-data.ts:82-107`; spec: `.trellis/spec/backend/{index,ai-provider,database-guidelines,error-handling,native-delivery}.md`; `clients/android/README.md` A015-A017,A023-A030,A086,A094-A098,A101; 前序任务只读: `10-13 prd/design`, `10-14 prd/design`.
