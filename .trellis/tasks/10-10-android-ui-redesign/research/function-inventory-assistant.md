# Research: Android AI 助理与 Provider 功能清单

- Query: 按实际源码逐项探查 AI 助理、配置、工具、独立 AI API、异常和 Android 展示缺口，供维护型 README 汇总。
- Scope: internal；Android UI / Repository 与后端 AI / assistant services。
- Date: 2026-10-10
- Evidence level: 源码已探查；本次未构建、未运行测试、未连接真实 AI、未进行设备验收。本文不把可调用的服务端能力当作完整的 Android 页面。

## Files found / Related specs

下列路径均为仓库相对路径；本文链接从 research 目录回到仓库根目录。

| 文件 | 作用 |
|---|---|
| [AssistantTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt) | 对话、草稿、附件、确认卡、导入行选择、状态和摘要 |
| [ProviderSettings.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt) | Provider 字段、认证、保存、连接测试 |
| [AssistantRepository.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt) | Android 实际调用的 assistant / AI API |
| [DocumentFiles.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt) | 读取系统文件选择器文档、限制字节数 |
| [MyTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt) | assistant / provider 二级页面入口，127–128 行 |
| [assistant.ts](../../../../packages/server/src/routes/assistant.ts) | 对话、消息、附件、确认、取消、归档 API |
| [ai.ts](../../../../packages/server/src/routes/ai.ts) | Provider、草稿、月评、整理 API |
| [assistant-tool-registry.ts](../../../../packages/server/src/services/assistant-tool-registry.ts) | 30 个工具的白名单、参数、读写适配与指纹 |
| [assistant-orchestrator.ts](../../../../packages/server/src/services/assistant-orchestrator.ts) | 模型选择工具、写入前预览、确认后事务 |
| [assistant-conversation-service.ts](../../../../packages/server/src/services/assistant-conversation-service.ts) | SQLite 对话、消息、请求去重、归档、卡状态 |
| [assistant-types.ts](../../../../packages/server/src/services/assistant-types.ts) | DTO、消息规范化、状态、工具白名单 |
| [ai-config-service.ts](../../../../packages/server/src/services/ai-config-service.ts) | 配置校验、摘要脱敏、保留/设置/清除密钥 |
| [ai-crypto.ts](../../../../packages/server/src/services/ai-crypto.ts) | AES-256-GCM 加密密钥 |
| [ai-provider-service.ts](../../../../packages/server/src/services/ai-provider-service.ts) | 三种请求模式、模板、响应路径、超时、响应大小 |
| [ai-transaction-service.ts](../../../../packages/server/src/services/ai-transaction-service.ts) | 不写账本的记账草稿生成、连接测试 |
| [monthly-evaluation-service.ts](../../../../packages/server/src/services/monthly-evaluation-service.ts) | 当前自然月的事实与带证据评价 |
| [ai-organization-service.ts](../../../../packages/server/src/services/ai-organization-service.ts) | 分类/标签合并、语义建议、审计、条件撤销 |
| [AI spec](../../../spec/backend/ai-provider.md) | Provider 契约；实际能力仍以源码为准 |

额外检索 `LedgerRepository.kt` / `AdminRepository.kt` 与整个 Android `src/main`：没有 `/ai/transaction-draft`、`/ai/monthly-evaluation` 或 `/ai/organization-*` 调用。Android AI 调用全部在 AssistantRepository。

## Findings

### Android 可见功能（A001–A037）

| ID | 功能与实际规则 | 证据文件:行 |
|---|---|---|
| A001 | “我的”可打开 AI 助理和 AI 接口设置两个独立页面 | MyTab.kt:127–128 |
| A002 | 显示 AI 尚未配置、已配置但关闭、已启用、读取失败；启用状态不等于连接已测试 | AssistantTab.kt:160–176 |
| A003 | 加载服务器对话列表；默认选择返回列表第一项；展示最近对话横向列表和当前对话标题 | AssistantTab.kt:179–190、464–540 |
| A004 | 新建对话，请求不带自定义标题；服务器返回 ID 后选中；列表重取 | AssistantTab.kt:276–296；AssistantRepository.kt:20 |
| A005 | 切换对话，清空旧消息显示，重读目标消息；目标身份核对防止晚响应覆盖当前页 | AssistantTab.kt:150–158、199–205、397–405 |
| A006 | 刷新当前对话、列表加载失败重试、消息读取失败重试；保留服务器可重读数据 | AssistantTab.kt:256–273、446–593 |
| A007 | 多个对话各自保留未发送文本、一个附件和发送 requestId，均为当前 Compose 内存状态 | AssistantTab.kt:81–85、111、137 |
| A008 | 用户文本输入最多显示 4 行；无客户端长度阻止，服务端限制 2,000 字符 | AssistantTab.kt:712–740；assistant.ts:14、103 |
| A009 | 文本非空或附有文件即可发送；发送中禁止该对话重复发送/改草稿/附件操作 | AssistantTab.kt:738–780 |
| A010 | UUID clientRequestId 随相同草稿保留；编辑文本或更换附件会重置；服务端依请求 ID 去重 | AssistantTab.kt:349–354、731–749；assistant.ts:105–108 |
| A011 | 等待完整响应，不模拟逐字输出；无 SSE/流式响应、无取消模型请求按钮 | AssistantTab.kt:777–785；AssistantRepository.kt:50 |
| A012 | 返回后安装服务器消息列表，清空成功草稿，刷新对话；失败保留草稿并提示先刷新核对 | AssistantTab.kt:750–777 |
| A013 | 只有当前对话仍匹配才安装消息；阅读旧内容时不自动拉到底，出现“有新消息，跳到最新” | AssistantTab.kt:199–254、669–687 |
| A014 | 首次载入/位于底部时滚到底；手动跳到最新按减少动态状态决定滚动是否动画 | AssistantTab.kt:238–249、670–681 |
| A015 | 系统文件选择器添加附件，显示原文件名与 KB，可移除；取消选择保留草稿；读取错误保留原选择 | AssistantTab.kt:346–359、688–718 |
| A016 | 文件最大 5 MiB；服务端只支持微信 XLSX / 支付宝 CSV，source 可 auto/wechat/alipay；Android 发送 source 固定 auto，无来源选择 UI | DocumentFiles.kt:26–42；AssistantTab.kt:757；assistant.ts:39–54 |
| A017 | 每次只附一个文件；无相机、照片、音频、PDF、通用文档 AI 分析入口 | AssistantComposerDraft:81–85；assistant.ts:49 |
| A018 | 消息区显示用户/助理/工具的内容，文本、progress、error、attachment、result、tool-card；文本按普通 Text 显示 | AssistantTab.kt:1020–1111 |
| A019 | progress 显示服务器处理中/已完成，error 显示安全错误消息，附件显示文件名 | AssistantTab.kt:1050–1090 |
| A020 | 结果卡显示服务端 summary 和最多 6 个白名单摘要字段，递归对象最多深度 2；金额格式化为元；不渲染任意 JSON | AssistantTab.kt:1115–1131、1343–1399 |
| A021 | 操作卡显示操作名、toolName、摘要、影响条数、values 的有限摘要、warnings | AssistantTab.kt:1147–1201、1317–1321 |
| A022 | 操作状态有 pending / confirmed / cancelled / expired，未知状态提示刷新；终态关闭执行按钮 | AssistantTab.kt:1150、1290–1315、1402–1409 |
| A023 | 点击确认操作再次弹窗核对摘要、影响条数、导入选中条数、警告；可“再核对”退出 | AssistantTab.kt:815–908 |
| A024 | 确认发送 actionId 与可选 fileBase64 / selectedIds / categoryOverrides；成功后重读消息；请求失败提示刷新核对而非自动重发 | AssistantTab.kt:851–896；AssistantRepository.kt:53–70 |
| A025 | 待确认操作可取消；请求中锁单个 action；失败刷新核对；对话发送/执行中禁止归档 | AssistantTab.kt:312–315、627–647 |
| A026 | 平台账单卡显示最多 200 个服务端预览行，行备注/交易对方、金额、日期读取、状态、分类文本输入和复选框 | AssistantTab.kt:1225–1287；assistant-tool-registry.ts:300–317 |
| A027 | 新预览默认选中：非 ignored、非 alreadyExists、金额大于 0、非 possibleDuplicate；疑似重复默认不选；已存在/忽略行锁定 | AssistantTab.kt:223–227、1235–1275 |
| A028 | 每行可人工覆盖分类名称；空白移除覆盖；无账户覆盖、批量全选/取消、分类树选择器 | AssistantTab.kt:606–611、1269–1275；AssistantRepository.kt:57 |
| A029 | 导入选中数量显示在卡片和二次确认框；Android 传显式选中 ID 数组 | AssistantTab.kt:1283–1287、824–826、876 |
| A030 | 原件仍在进程时可直接确认；重进页面/进程丢附件则要求重新选原文件；按长度+SHA-256 验证与预览一致 | AssistantTab.kt:338–343、362–388、858–873、1204–1222 |
| A031 | 原件不一致不执行；可重新核对原文件；操作终态后清理本地行选择/附件/分类覆盖 | AssistantTab.kt:217–236、375–381 |
| A032 | 归档有二次确认，说明无恢复列表、清草稿、不删除账本；成功移出列表选下一对话 | AssistantTab.kt:299–335、788–813 |
| A033 | 对话存储在服务器，未发送草稿和附件字节只在内存；切换对话保留，页面被移除或进程销毁不承诺恢复 | AssistantTab.kt:108–118；AssistantRepository.kt:8–12 |
| A034 | 加载列表/消息、创建、归档、发送、action 执行都有各自 busy 状态与错误提示 | AssistantTab.kt:117–134 |
| A035 | 所有 Repository/UI 操作捕获 AuthExpiredException 后调用统一重新登录流程 | AssistantTab.kt:169、191、266、289、328、764、888 |
| A036 | 消息追加位置有 motion.quickMillis 动画；“跳到最新”适配 reduced；无动画模拟账务变化 | AssistantTab.kt:590–594、676–679 |
| A037 | 归档会使服务端 pending actions expired；无归档列表、取消归档、删除单消息、编辑旧消息、重命名对话 API/UI | assistant-conversation-service.ts:230–247；assistant.ts:API 清单 |

### Provider 设置（A038–A062）

| ID | 选项 / 行为 | 证据文件:行 |
|---|---|---|
| A038 | 初始先加载保存配置；未成功加载时禁止保存空配置并给重试按钮 | ProviderSettings.kt:114–159、170–196 |
| A039 | 启用 AI 服务开关；关闭不调用模型；开关只在保存后改变服务端状态 | ProviderSettings.kt:215–229 |
| A040 | 三种模式：chat-completions / responses / custom；切换保留其他字段，不自动重写响应路径和模板 | ProviderSettings.kt:236–261 |
| A041 | 基础字段：配置名称、完整请求地址、模型名称 | ProviderSettings.kt:264–291 |
| A042 | 认证 none / bearer / header（自定义请求头） | ProviderSettings.kt:293–308 |
| A043 | 新密钥为遮罩密码输入框、留空保留；已保存密钥只展示 hasSecret，不回显明文 | ProviderSettings.kt:310–334 |
| A044 | 已有密钥但认证改为 none 时仍保留密钥，提示当前不使用 | ProviderSettings.kt:325 |
| A045 | 清除已保存密钥必须弹窗；只先标记，保存后才清除；可撤销标记；输入新密钥取消清除标记 | ProviderSettings.kt:336–368、603–628 |
| A046 | 高级区可展开/收起，按统一 motion tokens 动画、减少动态无 transition | ProviderSettings.kt:371–403 |
| A047 | HTTP 方法 GET / POST / PUT / PATCH；非 custom 启用时服务端要求 POST | ProviderSettings.kt:405–419；ai-config-service.ts:331 |
| A048 | timeoutMs 默认 20,000，客户端和服务端校验整数 3,000–60,000 | ProviderSettings.kt:54、421–435、510–515 |
| A049 | 额外请求头 JSON 多行输入；本地必须能解析为 JSON 对象，服务端限制 20 个头、名称和字符串值，不允许敏感认证头 | ProviderSettings.kt:436–451、516–522；ai-config-service.ts:145–166 |
| A050 | 自定义 JSON bodyTemplate 多行；可引用 input/categories/accounts/model/today/responseSchema/facts，禁止 secret 和未知变量 | ProviderSettings.kt:452–466；ai-config-service.ts:25–33、131–143 |
| A051 | responsePath 可手填；非 custom 有“填入当前模式常用路径”按钮：Chat=choices[0].message.content，Responses=output_text | ProviderSettings.kt responsePath 输入与 defaultResponsePath（652–656） |
| A052 | header 认证显示自定义认证头名称；客户端阻止空名称；服务端校验有效名称并禁 Cookie/Set-Cookie | ProviderSettings.kt:492–501、523–528；ai-config-service.ts:170–189 |
| A053 | 保存按钮提交全部草稿和 clearSecret，secret 仅非空时发送；成功后清空本地 secret / 清除标记 | ProviderSettings.kt:532–581 |
| A054 | 配置任意未保存变化或新密钥/清除标记存在则提示并禁“测试已保存配置” | ProviderSettings.kt:109–112、504–509、590 |
| A055 | 测试只请求服务器已保存配置，不测试当前未保存草稿；有测试中/成功/失败反馈 | ProviderSettings.kt:589–621；AssistantRepository.kt:87–88 |
| A056 | 保存/测试互斥，过程中锁字段，失败保留当前可修改内容 | ProviderSettings.kt:112、584–587、618–620 |
| A057 | 不自动测试、不提供品牌 Provider 预设/URL 自动补全/模型列表下载；模式选择不是品牌预设 | ProviderSettings.kt:完整表单；AssistantRepository.kt:实际 API |
| A058 | 当前 bodyTemplate 读取限制：后端非 custom 模式摘要返回 null；Android 不把不可读字段当清空，未编辑时省略保存该字段 | ProviderSettings.kt:131–137、467–473、547–549；ai-config-service.ts:284 |
| A059 | 保存后 local 草稿作为 savedDraft；密钥保存在 Compose 普通内存，不写 rememberSaveable；没有离开页面未保存确认 | ProviderSettings.kt:75–80、573；文件未使用 BackHandler |
| A060 | 服务端启用配置要求有效 URL/非空 model；生产 HTTPS、禁止 URL 用户密码；custom 非 GET 需要 JSON 模板，custom 需要响应路径 | ai-config-service.ts:105–127、326–339 |
| A061 | 服务端 AES-256-GCM 保存密钥，随机 12 字节 IV；环境密钥为 64 hex=32 字节；保存/使用密钥需要环境密钥，环境密钥不存数据库 | ai-crypto.ts:8–53；ai-config-service.ts:345–351 |
| A062 | server config summary 还有 configured/encryptionKeyConfigured/updatedAt；Android provider 页面未展示 encryptionKeyConfigured 与更新时间，只使用 hasSecret 及表单字段 | ai-config-service.ts:268–288；ProviderSettings.kt:114–144 |

### 助理工具 30 项（A063–A092）

所有工具由后端白名单控制（assistant-tool-registry.ts:319–350），通过 Android 对话**间接**请求。读工具自动读；写工具只能生成待确认卡，确认后执行。工具 catalog 在服务器存在，Android 没有工具目录 UI。模型能否正确选中每个工具尚未真实 Provider 验证。以下每项为独立功能，勿把“可聊天”概括掉。

| ID | 工具 | 具体能力 / 限制 | 适配器源码行 |
|---|---|---|---|
| A063 | transactions.recent | 最近账单、类型或备注查询，默认 10 / 最多 50 | assistant-tool-registry.ts:449 |
| A064 | accounts.balances | 服务端账户余额 | :470 |
| A065 | budget.overview | 当前/指定 periodStart 的预算概览、模块、结余池 | :474 |
| A066 | stats.monthly | 1–12 个月月度收入与净支出趋势 | :483 |
| A067 | recurring.pending | 待确认周期账单，结果最多 100 项 | :491 |
| A068 | monthly.evaluate | 当前自然月评价：收入、净支出、分类、6 月趋势、当前预算事实；评价使用事实证据 ID | :495；monthly-evaluation-service.ts:179–255 |
| A069 | organization.preview | 预览安全分类/标签合并动作；语义交易重分类/分类建议仅建议；采样最多 200 笔 | :502；ai-organization-service.ts:914–930 |
| A070 | backups.list | 备份文件名列表，适配器未截断列表 | :506 |
| A071 | backup.export-links | 返回 transactions/salaries/recurring/transfers 四类相对 CSV 导出地址 /api/v1/export/{what}.csv | :510 |
| A072 | transaction.create | 准备收入/支出、金额、日期、分类、账户、备注、tags、isRefund、refundLinkedTxIds 的新账单 | :514；:232–272 |
| A073 | transaction.update | 指定账单 ID + changes；保留服务器校验、准备变更前后指纹 | :540 |
| A074 | transaction.delete | 将账单移入回收站 | :583 |
| A075 | transaction.restore | 从回收站恢复账单 | :599 |
| A076 | transfer.create | 创建指定转出/转入账户、金额、日期、备注的转账 | :616 |
| A077 | salary.create | 新建工资并生成预算分配快照；账户、日期、金额、备注、可选模板/分配 | :634 |
| A078 | category.create | 创建分类，name/type/icon/color/sortOrder/parentId | :655 |
| A079 | category.update | 修改指定分类 changes | :676 |
| A080 | category.delete | 分类软删除 | :703 |
| A081 | account.create | 创建账户、type、initialBalanceCents | :718 |
| A082 | account.update | 修改指定账户 changes | :732 |
| A083 | account.delete | 账户软删除 | :749 |
| A084 | budget.template.apply | 将指定模板应用到当前周期 | :759 |
| A085 | backup.create | 服务端创建数据库备份 | :770 |
| A086 | platform-import.prepare | 账单干跑预览；确认后按所选行/分类覆盖导入；原件摘要校验 | :779 |
| A087 | organization.apply | 准备应用指定 actionIds 或默认 ready 动作，重新取 previewHash；确认审计写入 | :829 |
| A088 | organization.undo | 根据 operationId 条件撤销审计操作；有后续变更则拒绝 | :850；ai-organization-service.ts:1123 |
| A089 | recurring.confirm | 确认指定 occurrenceId | :864 |
| A090 | recurring.ignore | 忽略指定 occurrenceId | :881 |
| A091 | tag.rename | 指定 from/to 重命名标签，标签集合指纹防过期 | :898 |
| A092 | tag.delete | 指定 name 删除账单中的标签，指纹防过期 | :920 |

助理没有：创建/编辑周期规则、删除转账、编辑/删除工资、编辑预算分配、模板 CRUD、物品/照片/抠图、设置主题/周期日、更改密码、备份恢复工具；这些只能走各自客户端功能或服务端管理途径。工具访问与 UI 是否有专门页面需要分开记录。

### 服务端流程与约束（A093–A100）

| ID | 能力 / 边界 | 证据 |
|---|---|---|
| A093 | 不含附件时模型最多 3 步工具调用；历史 context 最多 20 条（每条文本 2,000），input 最近 12 条；回复文本截断 4,000 | assistant-orchestrator.ts:154–169、225；assistant-conversation-service.ts:24–26、335 |
| A094 | 有附件时直接准备平台导入，不调用模型；正文不会走一般对话工具选择，所以附账单并不等于多模态对话 | assistant-orchestrator.ts:114–146 |
| A095 | 写操作预览记录参数、fingerprint、附件元信息；确认时重跑预览比较指纹、原件大小/hash； stale 被置 expired | assistant-orchestrator.ts:231–262；assistant.ts:145–150 |
| A096 | 确认操作同 action ID 的并发请求复用 Promise；写入 + 状态 + 消息在 SQLite 事务；已确认重复请求返回既有结果 | assistant.ts:123–124、151–162；assistant-orchestrator.ts:265–297 |
| A097 | 附件正文永不持久化；对话/消息/pending 卡持久化；归档为 archived=1，pending -> expired | assistant.ts:首行；assistant-conversation-service.ts:230–247、343–385 |
| A098 | 确认选择最多 200 行；分类覆盖最多 200 entries；registry 通用字符串数组截到 100（平台参数重解析也采用该 helper） | assistant.ts:131–140；assistant-tool-registry.ts:144–151、284–293 |
| A099 | Provider 自定义模板支持有限变量和点/数组下标响应路径；不运行 JS/任意代码；拒绝重定向、2 MiB 响应大小限制 | ai-provider-service.ts:11–33、129–161、281–314 |
| A100 | Chat 模式固定 JSON object + temperature 0，Responses 模式固定 JSON object + temperature 0；测试只是成功调用并提取响应，并不验证正常记账完整草稿或所有工具 | ai-provider-service.ts:224–243；ai-transaction-service.ts:241–255 |

### API 覆盖矩阵

| API | Android 实际入口 | 可用程度 |
|---|---|---|
| GET /assistant/tools | 无 Repository 方法/UI | 仅后端 catalog |
| GET /assistant/conversations | 对话列表 | 已接入 |
| POST /assistant/conversations | 新对话 | 已接入；不发送 title |
| GET /assistant/conversations/:id/messages | 切换/刷新 | 已接入；全量返回，无分页 |
| POST /assistant/conversations/:id/messages | 文本/账单附件发送 | 已接入；完整响应非流式 |
| DELETE /assistant/conversations/:id | 归档弹窗 | 已接入；无恢复 |
| POST /assistant/actions/:id/confirm | 卡片二次确认 | 已接入 |
| POST /assistant/actions/:id/cancel | 卡片取消 | 已接入 |
| GET /ai/config | AI 状态/设置加载 | 已接入，但 encryptionKeyConfigured/updatedAt 未显示 |
| PUT /ai/config | 保存设置 | 已接入，secret 写入/保留/清除 |
| POST /ai/test | 测试已保存配置 | 已接入 |
| POST /ai/transaction-draft | 无直接 Android 入口 | 服务端草稿接口存在；Assistant transaction.create 是不同写入流程 |
| POST /ai/monthly-evaluation | 无直接 Android 入口 | 可经 monthly.evaluate 间接调用，结果展示有限 |
| POST /ai/organization-preview | 无直接 Android 入口 | 可经 organization.preview 间接调用，不能完整浏览建议/动作 |
| POST /ai/organization-apply | 无直接 Android 入口 | 可经 organization.apply 间接调用，无整理动作 checkbox UI |
| POST /ai/organization-undo | 无直接 Android 入口 | 可经 organization.undo 间接调用，无 operationId 历史列表 |

服务端独立草稿返回 type/amountCents/categoryId/accountId/date/note/tags/confidence/reason/missing，只规范化，不写入账本；来源 live 分类和账户，不能猜未知 ID。独立月评有 summary 及 highlights/risks/suggestions 三个列表，每个列表最多 6 条，evidenceIds 每条 1–8 个有效且不重复证据，文本最多 500；当前自然月不是可选预算周期。独立整理 actions 的可执行范围为 tag-merge/category-merge；transaction-reclassify/category-suggestion 是建议，未做自动账务写入。apply 校验 previewHash、不重复的 actionIds（最多 100）、阻塞原因及当前投影；undo 要求数据仍等于应用后的审计快照。

## Caveats / Not Found

1. **导入日期源码不匹配**：后端 boundedRows 输出 `dateLabel`，AssistantTab.kt:1265 读取 `date`。这段是源码发现，未设备复现。README 不能声称导入日期已完整显示。
2. **结果/确认卡只有有限摘要**：safeSummaryFields 只允许列出的字段名、最多 6 项、深度 2；不遍历数组内容。monthly evaluation、organization actions/recommendations、balances/items 等复杂数据通常看不到完整细节。无专用月评/整理页，无 evidence 钻取，无导出链接点击/下载（`links` 字段未在白名单）。可请求工具不等于可完整核对结果。
3. **组织操作预览缺口**：通用卡只画 values 摘要和 warnings，只有 platform-import 的 preview.rows 专用渲染。organization.apply/undo、账单 update 的完整前后值不会逐项展示；这些操作仍可经通用确认执行。
4. **200/100 的边界不一致**：assistant confirm route 接受 200 selectedIds，而 registry importArgs 再解析通用 stringArrayArg 截成最多 100。README 应区分展示最多 200 行和实际后端参数截断，不能承诺助理一次确认可导入所选 200 行；独立 DataTab 平台导入另行审计。
5. **禁用状态仍可发送**：助理状态文案显示关闭，但发送按钮本身不以 enabled 锁定。纯文字请求会由服务器返回 AI_NOT_CONFIGURED 安全消息；有附件时路径直接平台预览，不依赖模型配置。
6. **没有自动刷新/轮询**：当前消息通过加载、发送返回、显式刷新或 action 后刷新；progress 本身不意味着后台实时推送。发送可阻塞等待最多多步模型调用。
7. **secret 清除生效条件**：认证保持 bearer/header 且 enabled=true 又清除密钥时后端会拒绝保存（AiSecretUnavailable）；应关闭 AI、改无认证或替换密钥后保存。UI 清除标记不是立即清除。
8. **配置切模式只保当前内存字段**：服务端非 custom 返回 bodyTemplate null。UI 小心省略不可读字段，但无法显示其真实内容；仅当前会话保留已编辑模板，重开不能回显隐藏模板。
9. **本次只探查源码**：未证明任何真实 AI 模型能正确发起 30 种工具，也未验证连接测试、加密环境配置、附件预览/确认、归档或 HarmonyOS 4 行为。本报告没有改业务代码。
10. External references: 无。内部仓库审计，不依赖外部产品描述。后续维护必须重读上述源文件，更新受影响 A ID、API 覆盖、限制与日期；保留 ID 便于 UI 设计/验收映射。
