# Android Inventory & Catalogue Maintenance Report

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Role: Android Function Inventory & Catalogue Documentation Specialist
Date: 2026-10-17
Status: COMPLETE (Catalogued, audited against actual source, local verification confirmed, unverified boundaries noted for parent)

---

## 1. 任务背景与维护范围

根据 `AGENTS.md` 规范与本次任务指令要求，维护 `clients/android/README.md` 功能目录与审计基线，并生成本报告 `research/android-inventory-update.md`。

- **独占拥有文件**：
  - `clients/android/README.md`
  - `.trellis/tasks/10-17-ai-bill-import-improvements/research/android-inventory-update.md`
- **严守边界**：
  - 未修改任何源码、测试文件、spec 规范、协议文件、task phase 或 checklist。
  - 未执行生产部署、依赖安装、设备/模拟器运行、真实 Provider 联调、真实记账写入或 Git 暂存/提交。
  - 源码审计日期仅推进受影响小节（§6.1, §6.4, §6.5, §7, §8, §9.3, §11.0, §11.1, §11.2, §12.3），未全局推进未修改章节的审计日期。

---

## 2. 稳定功能 ID 维护与边界事实

### 2.1 稳定 ID 继承与新增
- **保持既有稳定 ID**：严格保留 `A015`–`A031` 及 `A101`–`A103` 的连续语义与既有功能，不重排、不篡改、不回收已分配 ID。
- **新增稳定 ID**：顺延分配 **`A104`**（多文件账单融合导入批次 Import Batch 全链路功能与约束），为当前域唯一未使用且顺延之 ID，严格禁止复用。

### 2.2 核心业务边界与限额区分（拒绝笼统重写）
- **单文件历史接口保留**：
  - 单文件 AI 账单导入（`POST /assistant/conversations/:id/messages`）保留单文件非空 CSV/XLSX、≤5 MiB、最多 200 行预览、显式非空 1–100 行确认入账的原有边界。
  - 通用助手 JSON 结构体保持 200/100 预算约束。
  - 旧版 pending action 卡片及二次确认/取消流程 100% 保持向后兼容。
- **多文件融合导入批次（Merged Import Batch）专属边界**：
  - **文件多选**：SAF `OpenMultipleDocuments()` 支持 1–5 个账单文件，单文件 ≤5 MiB，批次总字节 ≤8 MiB。
  - **网络限额**：Fastify 全局 body 维持 8 MiB，批次专属路由配置 `MERGED_BODY_LIMIT = 12 MiB`（以容纳多文件 Base64 膨胀）。原始字节仅保存在 Compose 内存中，不持久化保存到磁盘。
  - **批次规模**：支持全局融合最多 500 条待核对记录（超 500 条整批拒绝，不执行静默截断）。
  - **两阶段权威审核（Two-Stage Review-Confirm）**：
    - `POST .../review`：提交所选行（1–500）、分类指派（现有分类 ID 或建议 ID）、备注覆盖（支持显式空字符串清空）、已批准新分类数组及冲突决策；服务端返回权威财务总计（毛支出、毛收入、退款收入、净额）、文件分布、分类新建与复用计划、选入行清单（`selectedRows`），并颁发 15 分钟有效期的 `reviewToken`。
    - **逐行事实与空备注保留**：`selectedRows` 逐行携带服务端权威计算之 `categoryType`（0 支出 / 1 收入）与 `approvedNewCategoryName`（“拟新建”徽章）；当服务端返回空备注 `""` 时，客户端精确保留并展示为 `(空备注)`，不回退为草稿或占位符。
    - **独立统计维度与前端不自算**：`ReviewSummary.counts` 独立解码 typed `total`、`selected`、`notSelected`、`preexisting`、`ruleIgnored`、`conflictRows` 及可空的 `userExcluded`；严格分离 `ruleIgnored`（规则忽略）与 `userExcluded`（用户主动排除），`userExcluded` 为 null 时展示为“未提供”（绝不回退为 0）；直接呈现服务端权威金额，前端不执行任何重算。
    - `POST .../confirm`：重新上传批次中全部 1–5 个原始文件的内存字节，服务端在数据库写事务外校验 SHA-256 哈希与长度并重解析核验，随后在单一 SQLite 事务内原子创建已批准的新分类并写入账单流水；全成功或全回滚，绝无部分写入。
  - **严格长整型与整型解析（Fail-Close at 2^63 Boundary）**：
    - `parseStrictLong` 与 `parseStrictInt` 采用 `BigDecimal(raw.toString()).longValueExact()` / `intValueExact()` 精确解析；
    - 消除 `2^63` 边界处的 IEEE-754 Double 精度溢出；严格拒绝非数字对象、非有限浮点（NaN / Infinity）、小数（fractions）、字符串及越界溢出值，无客户端 32 位整型截断。
  - **分类建议与显式批准（Explicit Approval & No Auto-Approve）**：
    - AI 分片分析（最多 20 次顺序分片调用，全成或全败，GET 绝不调用模型）为每笔账单推荐现有活跃同类型叶分类或新分类建议（`suggestionId`）。
    - 确无合适分类时生成的“其他”兜底建议亦为新分类建议。
    - **无新分类自动批准（No Auto-Approve）**：新分类建议在界面上默认未批准，必须由用户显式点击“批准”或“改名新建”；匹配到多个同名同类型叶分类时弹出候选选择对话框显式选定，不盲目 `firstOrNull` 自动绑定。
    - **按需原子创建**：仅被最终选中行实际引用且用户显式批准的新分类才会创建；未批准或虽批准但未被选用的新分类（`categoriesSkippedUnused`）不予创建；取消或写入失败不残留新分类。
  - **选择、排除与硬锁定规则**：
    - 界面明确区分“已选”、“未选”与“用户排除”（userExcluded）。未选行点击“暂不导入”提供即时 UI 反馈并更新统计卡片，支持“重新选入”。
    - **硬锁定禁止选入条件**：金额非正（`amountCents <= 0`）、已在账本（`existing == true`）、账本碰撞（`ledger_collision`）及批次内弱冲突（`weak_collision`）。
    - **非硬阻断行保留选择权**：仅带有规则忽略原因（如 `状态非成功`、`status:*`）的正金额未入账行保持可选（`isEligible == true`），用户可自主选择是否入账。
  - **分页完整性与纯 Reducer 校验（Pagination Integrity & Pure Reducer）**：
    - 手机端采用 100 条/页的有界分页展示全局最多 500 条记录（最多 5 页），服务端支持 limit/cursor 游标。
    - `loadFullBatch` 接入纯函数校验器 `validateAndReduceBatchPages`，严格检验 5 页上限、`uniqueItemIds.size == declaredTotal == b.summary.totalItems` 总数一致性、游标耗尽、循环游标拒绝及异常空页拒绝；翻页与筛选期间完整保留勾选草稿、分类指派与备注草稿。
  - **视图版本一致性与有界重试（Revision Consistency & Bounded Retries）**：
    - 所有 GET DTO（`ImportBatch`、`ImportBatchRowsPage`、`ImportBatchCategoriesResponse`、`ReviewResponse`）均强制要求非空 `viewRevision`，移除空白通配回退；
    - `loadFullBatch` 校验 batch、categories 及所有 rows 分页的 `version`、`analysisRevision` 与 `viewRevision` 一致性；检测到并发代次变动整批丢弃并最多重试 2 次，重试耗尽时报错并完整保留用户手动草稿。
  - **Reader Identity 严格守卫与真实 Wire 契约验证（Reader Identity & Fastify Wire Fix）**：
    - `ImportBatchRow.fromJson` 正式对齐服务端权威枚举 `platform_order` 与 `occurrence`；严格 fail-close 拒绝任何未定义类型（包括 `legacy_order` 与任意未知字符串，抛出 `IllegalArgumentException`）。
    - **真实 Fastify Wire JSON 34 行初测与修复**：真实服务端生成的 34 行 fixture（`rows.json`）初测时因 `identityKind: "platform_order"` 触发前序解码器限制导致 1 个测试失败（155 测试中 154 成功，1 失败），经生产解码器修复后 34 行全量字段与边界断言全部通过（156/156 PASS）。
    - **空值语义安全**：`ImportRowAi.fromJson` 采用 `optCleanString("reason") ?: ""` 处理服务端的 `"reason": null`，防止字面 `"null"` 字符呈现到 UI。
    - **属性保持**：`note == ""`（空备注精确保留）、服务端权威 `categoryType` 0/1 映射、`approvedNewCategoryName` 拟新建徽章、`ReviewSummary.counts` 独立解析及 `userExcluded` 保持 nullable 行为全部通过真实 wire 数据严格核验。
    - **测试资源真实哈希**：5 份本地测试 fixture（`manifest.json`, `batch.json`, `rows.json`, `categories.json`, `review.json`）SHA-256 哈希全部一致可查，不含且不上传敏感私密数据。
    - **验证定级与范围**：仅证明本地源码与本地真实 route wire 格式对齐，生成的 fixture 不等同于真实 Provider 或真机环境；绝不能宣称“真实线上协议已验证”；无物理设备安装，无后端部署，真实海量导出 benchmark 缺口保留；稳定 ID 维持 314 项（包含 A104），不扩展到 316 IDs 或全仓 recount。
  - **文件运维**：
    - 批次内解析失败的文件提供单独的 `[替换]`（`/files/:fileIndex/replace`）与 `[移除]`（`/files/:fileIndex/remove`）端点，重新融合更新草稿，阻断未决文件被盲目导入。
  - **就地重复对比**：
    - 批次行专用只读对比端点 `GET .../rows/:itemId/duplicates`，弹窗展示候选账单及关键事实一致性徽章，不改变原有选择状态。

---

## 3. API 覆盖矩阵更新（Section 6.5 & Section 11.0）

### 3.1 新增 11 个批次端点
所有批次路由均位于 `packages/server/src/routes/import-batches.ts`，并通过 `assistant.ts` 插件以受保护方式挂载于 Fastify 会话守卫与 CSRF 拦截器下：

1. `POST /api/v1/assistant/conversations/:conversationId/import-batches`
2. `GET /api/v1/assistant/conversations/:conversationId/import-batches/:batchId`
3. `GET /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/rows`
4. `GET /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/rows/:itemId/duplicates`
5. `GET /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/categories`
6. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/review`
7. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/analyse`
8. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/files/:fileIndex/remove`
9. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/files/:fileIndex/replace`
10. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/confirm`
11. `POST /api/v1/assistant/conversations/:conversationId/import-batches/:batchId/cancel`

### 3.2 服务端注册接口统计对齐
- **历史基线**：13 个 route 文件 114 项 + `app.ts` 健康端点 1 项 = 115 项。
- **本轮新增**：`import-batches.ts`（第 14 个 route 文件）新增 11 项批次端点。
- **现行总数**：**14 个 route 文件 125 项 + app.ts 健康端点 1 项 = 共 126 项已注册服务端 API**。全量列入 Section 11.0，并保持实际 payload/状态说明。

---

## 4. Kotlin 源码目录覆盖更新（Section 11.1）

main Kotlin 文件总数由 49 个增至 **51 个**（均已实际收录于 Section 11.1 覆盖列表）：
1. `[app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt)`：融合导入批次 18 项强类型 DTO、BigDecimal 严格整型/长整型解析（2^63 边界 fail-close）、ReviewSummaryCounts 独立统计维度、纯函数分页校验器 validateAndReduceBatchPages 与非空 viewRevision 校验；收录于 A016/A022/A023/A024/A027/A104。
2. `[app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt)`：全屏多文件融合导入工作区（500有界分页、validateAndReduceBatchPages 5页完整性校验与有界重试、分类批准/改名弹窗、权威审核Sheet展示逐行类型与拟新建徽章、空备注精确保留、原子确认）；收录于 A021/A023/A026–A031/A104。

---

## 5. 本地质量验证基准事实

所有验证数据均基于工程当前实际输出与 XML 报告严格核对，真实反映当前工作台状态：

| 校验域 | 执行命令 / 证据源 | 实际测试数 / 结论 | 详细分解 |
|---|---|---|---|
| **后端单元与集成测试** | `pnpm --filter @jizhang/server test` | **30 test files / 684 tests PASS** (0 failures, 0 errors) | 包含 5 个批次专项测试套件与回归测试 |
| **共享层契约测试** | `pnpm --filter @jizhang/shared test` | **7 test files / 187 tests PASS** (0 failures, 0 errors) | 包含 CSV 分配预算、平台账单元数据测试 |
| **后端静态类型与风格** | `pnpm lint` / `pnpm typecheck` / `pnpm build` | **0 errors / 0 warnings** | shared 与 server 均 clean 通过 |
| **Android 单元测试** | `clients/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` | **12 test suites / 156 tests PASS** (0 failures, 0 errors) | 基线 10 套件 91 项 + 批次 2 套件 65 项（NetworkContract 20 + State 45）；初测 155 测 1 败（因 platform_order） -> 修复后 156 项全通过；前序里程碑 153 项与 138 项已覆盖 |
| **Android Lint 检查** | `clients/android/app/build/reports/lint-results-debug.txt` | **0 errors, 9 baseline warnings, 21 info** | 9 项均为 Compose modifier 参数顺序、allowBackup 建议与启动图标形状警告（均在未修改的历史基线文件中），0 项功能错误；不宣称 0 warnings |
| **Android 编译产物** | `clients/android/app/build/outputs/apk/debug/app-debug.apk` | **BUILD SUCCESSFUL** | 文件大小 **18,473,623 字节**（17.62 MB）；SHA-256 **`ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`**；**明确核实未在物理设备安装**（前序产物 19,580,136 字节 SHA-256 `0c956aacb1eba013ac064090f407de3253f9b09a20517fcea3fe7ec4017d696e` 及 `09dc...` 保留历史记录不可伪抹） |
| **内存与吞吐基准** | `import-batch-bench.ts` | **500 行测试 PASS** | 500 行 CSV 解析耗时 ~50ms，堆内存增量 ~11 MiB；超限 501 行与超限 XLSX 膨胀均精准拦截拒绝 |

---

## 6. 已知缺口与验证边界声明（Known Gaps for Parent）

按照“设计与事实分开、未测严禁标通过”之纪律，将以下尚未完成物理/生产验证的项作为明确缺口，如实向 parent 汇报，不夸大完工范围：

1. **未在物理真实设备安装与实机测试（UNTESTED ON DEVICE）**：
   - 当前工作区仅生成了本地最新 Debug APK（大小 18,473,623 字节，SHA-256 `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`；前序里程碑构建 19,580,136 字节 `0c956aac...` 留存历史），已完成字节哈希独立校核。
   - 明确**未**执行 `adb install`，未在华为 nova 7 Pro（HarmonyOS 4.2）或任何物理手机上运行，未进行多点触控、屏幕旋转、小屏适配、系统 IME 软键盘弹出、深色模式与动画流畅度的实机视觉交互核验。
2. **未部署至生产环境与未连接真实 Provider（UNTESTED IN PRODUCTION & LIVE PROVIDER）**：
   - 服务端容器镜像未构建发布，未部署上线到生产 Docker / Caddy 服务环境。
   - 未在生产数据库 `production.db` 执行任何物理写入操作。
   - 未调用真实外部 LLM API（如 OpenAI / New API 兼容中转站）执行 20 次顺序分片分析，流式网络延迟与弱网超时恢复未在公网链路上验证。
   - 不能宣称“真实线上协议已验证”（仅为本地源码与真实 Fastify wire 路由 mock/fixture 测试通过，生成 fixture 不等同于真实 Provider 或真机运行）。
3. **合成基准测试非真实海量导出账单跑分（BENCHMARK LIMITATION）**：
   - `import-batch-bench.ts` 呈现的 50ms / +11MiB 内存表现来自开发者工作站的单次合成数据校准，合成 benchmark 与本地隔离数据库迁移不能作为生产安全性或海量历史账单导出文件在弱网/低端手机内存受限环境下的安全性定论。真实海量导出基准跑分缺口保留，仍待后续专项测定。
4. **旧版卡片与归档流程兼容性**：
   - 前端状态机与 DTO 严格兼容旧版单文件 200/100 导入卡与取消流程；旧版 action 取消与归档逻辑保持不变；新融合批次采用独立 `import-batches` 路径。
5. **源码实施为当前状态但独立 Review 仍待最终读回（PENDING FINAL READBACK）**：
   - 源码实施与本地自动化测试（156 tests, Lint 0 errors / 9 baseline warnings, Debug APK）已全量就绪，但独立 review 仍处于最终读回阶段，不可过早宣称全链路完全闭环。

---

## 7. 结论

`clients/android/README.md` 功能目录已完成受影响小节的精确更新，稳定 ID 延续至 `A104`，API 覆盖与文件清单精准对齐，自动化构建与本地单元测试 100% 通过（server 684 / shared 187 / Android 156 项全绿，Gradle XML 真实核验：基线 91 + 批次 65 项；初测 155 测 1 败因 platform_order -> 修复后 156 项全绿；Lint 0 errors / 9 baseline warnings / 21 info；最新 APK 大小 18,473,623 字节，SHA-256 `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0` 独立核验；前序构建 153 tests / 19,580,136 字节 `0c956aacb1eba013ac064090f407de3253f9b09a20517fcea3fe7ec4017d696e` 历史记录保留不可伪抹）。所有未经验收的物理设备、生产部署与真实 Provider 运行边界已完整记录为缺口，不能称“真实线上协议已验证”，当前状态判定为 LOCAL VERIFIED / UNTESTED ON DEVICE & LIVE PROVIDER / PENDING FINAL READBACK，交付 parent 进行后续发版与专项验收决策。
