# AI Assistant 当前功能与合同审计

## 完成清单与证据边界
- [x] 解析 active task：`.trellis/tasks/10-10-android-ui-redesign`（session source）。
- [x] 核对 Android README 稳定 ID、UI、Repository、服务端 DTO/路由/领域写入合同。
- [x] 追踪 preview 200、selectedIds 边界/null/[]、分类覆盖、确认与会话竞态。
- [x] 保存源码 SHA-256 基线并复核研究输出。

本轮只读源码，只写本任务 `research/`。未修改代码/README/spec、未构建、未运行测试、未递归派代理、未调用真实 AI/生产 API。工作区已有大量其他改动；本文依据工作树而非 HEAD。基线见 [ai-assistant-hash-baseline.md](ai-assistant-hash-baseline.md)。源代码事实不等同设备验证，也不以 `ui-redesign/README.md` 作实现证据。

## 1. 当前功能与稳定 ID

| README ID | 当前源码行为 | 主要证据（仓库根相对路径） |
|---|---|---|
| A001–A006 | AI 底部一级入口；配置状态文案；历史列表默认首项、创建、切换、刷新/失败重试。4 欢迎快捷仅填草稿，不写账。 | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt:315`；`ui/AssistantTab.kt:168–293,935–1040`（下文 ui 路径同前） |
| A007–A014 | 对话 ID 分组内存草稿；单附件；UUID 去重；完整响应非流式；失败保留草稿/requestId；阅读旧内容时提供跳到最新。 | `ui/AssistantTab.kt:98–156,224–280,744–800`；`packages/server/src/routes/assistant.ts:104–136` |
| A015–A017 | GetContent 文件选择、文件名/大小、移除；5 MiB；服务端 CSV/XLSX，客户端 source 固定 auto。无音频/照片/PDF分析。 | `ui/DocumentFiles.kt:23–42`；`ui/AssistantTab.kt:346–361,675–738`；`packages/server/src/routes/assistant.ts:26–58` |
| A018–A022 | 用户/助理/工具消息、progress/error/attachment/result/card；最多6白名单摘要字段、对象深度≤2、整数分格式化；pending/confirmed/cancelled/expired，未知状态不开放执行。 | `ui/AssistantTab.kt:1140–1250,1449–1534`；`packages/server/src/services/assistant-types.ts:1–16,82–120` |
| A023–A025 | 二次确认摘要/影响数/选择数/warnings；actionId单操作锁；失败刷新核对而不自动重试；取消；发送/操作进行中 UI 禁止归档。 | `ui/AssistantTab.kt:623–646,318–343,831–919`；Repository confirm/cancel |
| A026–A031 | 最多200个服务端预览行；默认排除已存在/ignored/≤0金额/疑似重复；逐行选择与自由文本分类覆盖；原件长度+SHA-256核对；终态清理本地选择/附件/覆盖。 | `ui/AssistantTab.kt:234–259,346–394,1320–1388`；registry `boundedRows` |
| A032–A035 | 归档二次确认、清草稿、无恢复列表；各流程独立busy/error；401统一登录回退。 | `ui/AssistantTab.kt:301–343,810–829`；`MainActivity.kt:66–70` |
| A060–A089 / A090–A100 | 服务端30工具白名单，读工具直接查询、写工具先pending再confirm。无完整工具目录浏览 UI。金额/预算事实来自领域服务。 | `packages/server/src/services/assistant-types.ts:23–54`；`assistant-tool-registry.ts:365–421`；`assistant-orchestrator.ts:112–228,231–301` |

Android Repository **没有专门 Assistant DTO 层**：以 `JSONObject` / `JSONArray` 传递数据，UI以 opt*读取；本地只有 ComposerDraft/ActionConfirmationRequest/SelectedDocument。服务端 DTO 和 normalize 在 `assistant-types.ts`，持久化映射在 conversation-service。字段错配必须同时核查服务端投影与 UI，不能凭类型编译通过判一致。

API直连覆盖：GET/POST conversations、GET/POST conversations/:id/messages、DELETE conversations/:id、POST actions/:id/confirm、POST actions/:id/cancel；GET ai/config用于状态。Repository另含PUT ai/config与POST ai/test供Provider设置；GET assistant/tools只有后端能力，聊天页未调用。

## 2. 导入边界：200 展示、100 参数、null 与 []

### 2.1 各层真实边界

| 层 | 实际规则 | 证据 |
|---|---|---|
| Android预览 | 遍历所有返回 preview.rows，无本地200/100限制；首次装载创建默认选择Set；空集仍能按确认。 | `AssistantTab.kt:243–249,873–878,1320–1388` |
| route | selectedIds可省略、null或数组≤200；每项string长度≤100，未禁止空串/重复；overrides≤200 keys、key≤100，value仅要求string。 | `routes/assistant.ts:151–166` |
| registry prepare参数 | MAX_RESULT_ITEMS=100。selectedIds trim、去空、去重后slice100；null/省略归一null。分类覆盖去空值、slice100、key截100、value trim截80。 | `assistant-tool-registry.ts:43,148–155,274–296` |
| registry预览 | boundedRows只给文件前200行；affected.ids最多100；summary/count/金额来自完整文件计算。 | 同文件 `299–314,779–802` |
| orchestrator | edits中所有显式ID/override key都必须属于 refreshed.preview.rows（前200行）；重预览旧参数指纹、再计算编辑参数预览指纹。 | `assistant-orchestrator.ts:231–260` |
| 领域服务 | selectedIds=null/undefined表示所有可导入行（全文件，不仅前200）；[]表示没有交易候选。疑似重复仅提示，显式选入或null仍可导入；ignored/非正金额/已存在仍过滤。 | `portability-service.ts:796–852` |

### 2.2 关键纠正：不能简单断言“确认200会成功导入前100”

完整链路：`prepareConfirmation` 将 **未归一化 editedArguments** 与 **registry.prepare归一化后生成的 editedPreview.fingerprint** 放在一起；事务中 `confirmInTransaction` **不调用parseArguments**，直接进入import confirm；confirm用原始selectedIds/overrides重新计算指纹。

因此，101–200个不重复有效选中ID会在prepare截100，但confirm仍用原始101–200个ID，通常因指纹不同触发409 stale，route把action置expired；**不是可靠地只导入100，更不是支持200**。101–200分类覆盖也有同类问题；value首尾空格、>80字符、空值、selectedIds重复/归一差异也应针对具体输入验证指纹一致性。正常Android Set不含重复，分类UI只去blank不trim，因此分类首尾空格风险可经正常UI触达。

README A098及§9.3第4点捕获100/200不一致，但“实际后端参数截断”不足以描述事务确认效果。建议后续维护README明确“边界不一致导致确认失败/卡片过期的风险”，先用集成测试核实，不宣称已运行复现。

### 2.3 null/省略/[]的产品语义

- Repository `selectedIds: List<String>?` 的null意味着**不写字段**，不能发送显式JSON null；[]会写显式空数组。
- 正常Android platform卡装载后创建选择Set，即使空集也是[]，避免把“全不选”误当全文件。
- HTTP显式null可以绕过显式ID前200成员检查，领域层导入全文件可导入行；省略则沿用pending.arguments，附件默认准备参数null。因此非Android调用者/异常缺失选择状态可能导入未展示的第201行以后。
- []应是0条交易，不是all；但领域 `resolve()`仍会ensure平台账户，即使0候选也可能新建/恢复平台账户（`portability-service.ts:854–907`）。不可把空选择承诺为完全无写入。
- 疑似重复默认不选只由Android实现；null服务端不排除possibleDuplicate。保持区别：硬重复阻止、软重复提示，不写成服务端自动去重。

## 3. 分类覆盖与预览忠实度

1. **确认预览未呈现实际分类副作用**：领域effectiveCategory决定真实写入分类；同名同type活分类复用、软删分类恢复，否则创建新分类（`portability-service.ts:829–866,1033–1077`）。UI自由文本不是分类ID选择，可能新建/恢复分类。
2. **预览行仍为原解析分类**：previewRows.categoryName来自row.categoryName而非effectiveCategory。Android本地override输入能显示用户编辑值，但服务端重算card/通用摘要不能当作有效分类已逐行反映；确认框没有新建/恢复分类清单。
3. **已确认的日期字段错配**：registry投影提供`dateLabel`，Android行文字读`row.optString("date")`（AssistantTab约1351）；日期可能空白。README A026“日期读取”不等于日期正确显示。
4. **通用确认不足**：JsonSummaryFields最多6字段、深度2、未知字段不画；update前后值、整理应用/撤销的完整影响不会展示。写操作仍可执行，需按tool补齐可核对详情，不能把有限摘要当完整确认合同。

## 4. 确认、取消与认证边界

- 服务端写入权威：provider白名单/参数解析→服务器prepare/pending→用户confirm→新鲜指纹复核→SQLite事务领域写入+pending confirmed+卡片状态+结果消息。不是仅依赖客户端布尔判断；未从本次静态研究证明CWE-602授权绕过。
- confirm route以actionId Promise Map合并同进程并发；事务再读status，重复confirmed不重写。附件长度/hash服务器再校验；错误原件、越界ID、变化预览走stale→expired。
- cancel只让pending进入cancelled；已confirmed不可取消。并发confirm/cancel应以事务内最终status为准，不能把UI“取消”当撤销已经完成的账务。
- archive把所属pending置expired，正常UI拒绝本地发送/执行中归档；另一客户端仍可归档，服务端异步生成/确认期间须测试此交错。归档没有恢复入口，也不会删账本。
- route归属authenticated plugin（`packages/server/src/app.ts:134–181`）；单用户应用无多租户owner字段，不能将其直接作为BFLA证据。
- ApiClient每次调用读取当前base；换地址清Cookie，401 interceptor清session，MainActivity移除signedIn子树。同步OkHttp execute没有协程取消→Call.cancel桥接；离开UI不等于服务端请求撤销。需单独验证晚401清新session、退出后旧写入完成等竞态，本文不判为已复現漏洞。

## 5. 会话/草稿竞态与README差异

| 优先级 | 发现 | 静态依据与判断 |
|---|---|---|
| P1 | 底部Tab切换不保留Assistant本地状态 | MainShell `when(tab)` 仅Assistant分支compose AssistantTab；无SaveableStateHolder/保活/提升草稿；其状态均remember。README入口表“切换Tab保留同一会话与未发送草稿（内存级）”与当前结构矛盾。仅聊天内部切换conversation支持分组草稿。 |
| P1 | 同对话旧请求可能覆盖新快照 | installMessages只检targetId==conversationId，没有request generation。A→B→A旧A结果仍可安装；手动GET与send/confirm刷新并发时旧GET可覆盖新的终态卡。服务端status仍防重复写，但客户端选择/提示可回退。 |
| P1 | 旧send返回给所有pending导入卡绑定同一新附件 | send成功遍历incoming所有platform pending卡，将original放入每个actionFiles，未先按attachment hash匹配。旧卡可被错误文件覆盖并显示sourceReady；confirm哈希会阻止写入并清文件，但交互会误导。 |
| P2 | 文件选择器回调可复活过期草稿 | composerPicker捕获conversationId，读取完未检查对话是否仍存在/已归档/正在send，也不校验草稿generation；归档或发送清草稿后旧picker可写回内存。actionPicker用captured expectedCard pending判定，未用当前card status；终态清理后可写回旧file状态，服务器仍复核。 |
| P2 | 刷新/晚响应提示覆盖 | refreshConversations无generation；installMessages成功无条件clear notice。错误分支提示“结果待核对”随后refresh成功会清掉，核对意义未必保留。 |
| P2 | 待处理服务端状态非实时 | send等待完整结果，无流式/poll/cancel；首次响应前UI仅本地busy，不能承诺实时工具进度。未运行模型能力验收。 |

README A005/A013“目标身份核对”是真实但仅防不同当前ID，不代表同ID请求排序隔离；A010去重仅同一requestId，用户改草稿重置ID后仍可能重复提交业务意图。不要在修复前增强这些条目的保证。

## 6. 建议后续验证矩阵（本轮未执行）

| 场景 | 要核对的可观察结果 |
|---|---|
| 文件201+行，选100/101/200/201个ID | 预览≤200；route拒>200；100应一致；101/200检查409/expired和0交易写入，记录准确非“导入100”。 |
| null / omitted / [] | null与omitted沿用全文件语义；[]零交易；核查空选择平台账户副作用；第201+行不可悄然称为已预览。 |
| 100/101/200分类覆盖、空白/首尾空格/>80字符 | editedPreview fingerprint与confirm归一化一致；明确失败码、卡片终态、原子无部分写入。 |
| 假ID/非前200行ID/hash或长度不符 | stale/expired，不写账；原件匹配才能执行。 |
| 软重复/硬重复/ignored/0金额 | UI默认选择与领域候选边界分开；手动软重复是明确选择，不宣称自动排重。 |
| confirm×2、confirm/cancel、confirm/archive跨客户端 | exactly once、终态一致、错误不遗留账务部分写入。 |
| A→B→A、send与GET倒序、pending变terminal | 老响应不复活待执行按钮，不覆盖终态或清错误；draft/selection不丢失。 |
| 底部Tab切换、进程重启、旧文件picker返回 | 当前实现可能丢草稿；界面文案/README承诺须一致；hash正确且不把新文件绑定所有旧卡。 |
| 登出/401/换地址后晚响应 | 不展示旧身份数据、不污染新session、不可自动重试旧写账。 |
| 日期/分类/通用update前后值 | 日期dateLabel正确；有效分类及新建/恢复副作用可核对；完整关键字段不被摘要截断。 |

已有测试源码：`packages/server/test/assistant.test.ts:102–179`覆盖确认前零写入、并发/重复确认一次、未知工具、附件摘要不符、伪造ID、正常单行导入与不持久化fileBase64；`assistant-contracts.test.ts`覆盖JSON/工具白名单。未见本次核心101/200、null-vs[]、大量分类覆盖、UI请求排序测试；已有测试存在不代表本轮已通过。

## 7. 后续文档/规范候选（本轮不改）

- `clients/android/README.md`：入口表Tab草稿保留承诺、A005/A013隔离强度、A026日期、A028覆盖副作用、A098/§9.3的100/200真实确认后果。
- `.trellis/spec/backend/ai-provider.md`：独立draft advisory合同仍适用，但其“不写账”范围不可错误套到全部assistant；assistant白名单pending/confirm事务合同宜独立补齐。
- 无需外部文档才能确认本次仓库合同；未作外网资料引用。修复前优先建立隔离集成测试，避免以手工参数归一化推断替代实际事务结果。

输出复核：研究正文与哈希基线均存在；哈希复核全部未变。 未运行产品测试。
