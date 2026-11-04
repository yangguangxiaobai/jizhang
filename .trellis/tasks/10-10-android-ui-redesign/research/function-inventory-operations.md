# Research: Android 数据、物品、转账、回收站与周期账单功能清单

- Query: 探查当前实际 Android 功能、输入、限制、服务端能力及客户端缺口，为可持续维护的 README 提供事实依据。
- Scope: internal；Android UI/repository、对应 API/service、Python 抠图 worker。
- Date: 2026-10-10。
- Evidence level: 源码核对；本轮没有运行构建、测试或设备验收，不能推定 Android/HarmonyOS 4 已实测通过。
- Active task: `.trellis/tasks/10-10-android-ui-redesign`。

## Findings

### 1. 范围与证据索引

下文链接从本研究文件位置指向真实源码；行号另列，方便主 README 维护者转写。功能 ID 保持稳定，后续删除功能应标记移除而不是把 ID 给新功能复用。

| 文件 | 覆盖内容 |
|---|---|
| [DataTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt) | 60 起：四类导出、本应用 CSV 导入、平台导入、数据库备份；321 起：平台预览/选择/改分类/确认 |
| [DocumentFiles.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt) | 10–43：SAF 文件名读取、CSV 校验、受限读取 |
| [PortabilityRepository.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt) | 18–58：文件下载、text/csv 上传、Base64 平台文件、备份调用 |
| [ItemsTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt) | 82–656：列表、概要、创建/编辑、详情、照片、抠图、售出/退役/删除；665 起的设置 UI 由其他研究域覆盖 |
| [ItemRepository.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/ItemRepository.kt) | 19–84：物品 CRUD/生命周期/照片/抠图 API |
| [ItemPhotoUploader.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/ItemPhotoUploader.kt) | 13–25：兼容照片上传封装，实际委托 ApiClient.putBytes；类注释仍称 HttpURLConnection，已过时 |
| [TransfersTrashTabs.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt) | 43–207：转账列表/编辑；216 起：回收站/单项与全量操作 |
| [LedgerRepository.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt) | 44–127：账单/转账/回收站与元数据调用，本研究重点为转账/回收站 |
| [RecurringRulesTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt) | 94–359：规则管理；530–798：规则编辑与草稿/不确定结果处理 |
| [PendingTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt) | 69–425：生成、列表、核对、确认/忽略；428 起：卡片与状态显示 |
| [BudgetRepository.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt) | 84–118：真正定义 RecurringRepository；不存在独立 RecurringRepository.kt 文件 |
| [LedgerLinkPicker.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt) | 57 起：物品关联已有支出/收入，50 条分页、选择/清除/取消 |
| [MyTab.kt](../../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt) | 121–129：周期规则、转账、回收站、数据、物品、待确认均有实际导航入口 |
| [portability.ts](../../../../packages/server/src/routes/portability.ts) | 全部导入导出与备份端点 |
| [portability-service.ts](../../../../packages/server/src/services/portability-service.ts) | CSV 栏位/校验、平台识别/去重/主数据建立、快照保留 |
| [items.ts](../../../../packages/server/src/routes/items.ts) / [item-service.ts](../../../../packages/server/src/services/item-service.ts) | 列表过滤、概要、生命周期、关联账单校验、照片与成本计算 |
| [item-cutouts.ts](../../../../packages/server/src/routes/item-cutouts.ts) / [item-cutout-client.ts](../../../../packages/server/src/services/item-cutout-client.ts) | 公共认证代理、worker 可选、错误映射与受限二进制读取 |
| [transfers.ts](../../../../packages/server/src/routes/transfers.ts) / [transfer-service.ts](../../../../packages/server/src/services/transfer-service.ts) | 转账分页/账户过滤、校验/余额语义/软删 |
| [trash.ts](../../../../packages/server/src/routes/trash.ts) / [transaction-service.ts](../../../../packages/server/src/services/transaction-service.ts) | 回收站路由；655–755 恢复/彻底删除/列表限制 |
| [recurring.ts](../../../../packages/server/src/routes/recurring.ts) / [recurring-service.ts](../../../../packages/server/src/services/recurring-service.ts) | 规则、周期生成、确认/忽略、历史 occurrence API |
| [bill-decode.ts](../../../../packages/server/src/services/bill-decode.ts) / [platform-bills.ts](../../../../packages/shared/src/platform-bills.ts) / [xlsx-lite.ts](../../../../packages/server/src/services/xlsx-lite.ts) | 文件识别/GBK 与 xlsx 解码、平台跳过规则、分类与稳定 ID |
| [cli-db.ts](../../../../packages/server/src/cli-db.ts) / [app.ts](../../../../packages/server/src/app.ts) | 一致性备份/校验/恢复与全局 8 MiB HTTP 请求上限 |
| [cutout settings.py](../../../../packages/cutout/app/settings.py) / [main.py](../../../../packages/cutout/app/main.py) / [jobs.py](../../../../packages/cutout/app/jobs.py) / [image_io.py](../../../../packages/cutout/app/image_io.py) / [engine.py](../../../../packages/cutout/app/engine.py) | 默认限额、worker API、临时任务生命周期、图像归一化、SAM2 分割候选 |

### 2. D：数据导入、导出与备份

入口：我的 → 数据管理。该页面为四组功能；平台导入替换本页显示，通过“关闭”返回；所有文件操作使用 Android 系统文件选择/保存组件。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| D001 | 导出账单 CSV；系统“另存”初始文件名 transactions.csv，可自行选保存位置 | DataTab.kt:84–99、177–196；PortabilityRepository.kt:18–21 |
| D002 | 导出工资 CSV，初始 salaries.csv | DataTab.kt:179–193；portability-service.ts:67、289 起 |
| D003 | 导出周期规则 CSV，初始 recurring.csv | DataTab.kt:181–193；portability-service.ts:68–79 |
| D004 | 导出转账 CSV，初始 transfers.csv | DataTab.kt:182–193；portability-service.ts:80 |
| D005 | 下载走认证 API；CSV 为 UTF-8，服务端含 BOM；保存成功显示“CSV 已保存到所选位置”，取消保存不执行下载 | DataTab.kt:84–99；portability.ts:47–54 |
| D006 | 本应用账单 CSV 导入：账单/转账二选一，切换清空所选文件和上次结果；未选文件不展示确认导入按钮 | DataTab.kt:205–263 |
| D007 | 选 CSV：文件 MIME 允许任意类型以兼容 provider，但真实名称必须 .csv（忽略大小写）、内容非空、≤10 MiB；本应用 CSV 按 UTF-8 读取，不执行平台 GBK 解码 | DocumentFiles.kt:12–19；DataTab.kt:132–153 |
| D008 | 取消文件选择保留此前文件；真正另选文件先清空旧文件/结果，读取失败显示错误 | DataTab.kt:132–153 |
| D009 | 点击确认即以 text/csv 内容上传，无本应用 CSV 预览；处理中阻止重复导入，成功展示新增 inserted/跳过 skipped/读取 total 三个数字 | DataTab.kt:232–263；PortabilityRepository.kt:23–32 |
| D010 | 账单 CSV 必需栏位：id/date/type/amount/category/account/note/tags/isRefund；type=expense/income，amount>0 且≤2 位小数，date=YYYY-MM-DD，tags 用竖线分割 | portability-service.ts:48–58、404–565 |
| D011 | 本应用 CSV 同 ID（包括已经软删除的数据）跳过；未知分类/账户、空 ID、金额/日期/类型/退款标志错误报错；先校验再事务写入，不能静默创建未知主数据 | portability-service.ts:430–591、641–720 |
| D012 | 转账 CSV 必需 id/date/amount/from/to/note；账户按名称匹配且必须是两个不同账户；同 ID 跳过；成功/错误交互同账单导入 | portability-service.ts:80、600–720 |
| D013 | 服务端兼容旧“支出类型的退款”CSV，归一化为收入退款；没有合法退款分类时明确拒绝 | portability-service.ts:536–550 |
| D014 | 平台账单文件导入支持微信 xlsx 与支付宝 GBK CSV，也可识别 UTF-8/BOM CSV；原始字节 Base64 上传，Android 不解析金额/平台规则 | DataTab.kt:269–283、321 起；PortabilityRepository.kt:34–51；bill-decode.ts:44–64 |
| D015 | 平台文件读取上限默认 5 MiB；读取成功后立即 dryRun 预览、显示文件名与识别平台；source 固定 auto，界面没有微信/支付宝手动来源选项。取消选择保留旧文件；另选文件若读取失败也保留旧文件及预览，因为清理发生在读取成功后，与本应用 CSV 不同 | DataTab.kt PlatformImportSheet picker；DocumentFiles.kt:23 |
| D016 | 预览行展示备注（缺则交易对方）、日期、元金额、分类，以及已入账/可能重复/忽略原因状态；实际拼接表达式应设备核对其多状态提示完整性 | DataTab.kt:424–450 |
| D017 | 默认只勾选非已入账、非忽略、非可能重复行；已入账/忽略行不能勾选；可能重复行可以人工勾选确认 | DataTab.kt:359–364、421–435 |
| D018 | 每行“改分类”输入自由文本分类名称，确认应用/取消保留旧值；上传 categoryOverrides；没有分类下拉、没有全选/取消全选按钮 | DataTab.kt:452–515 |
| D019 | 确认导入所选 N 行：上传原文件/selectedIds/overrides，非 dryRun；成功关闭面板，主页面展示平台、新增数、支出与收入金额 | DataTab.kt:469–491 |
| D020 | 平台稳定 wx-/ali- 订单 ID 去重；可能重复由服务端同平台账户的同本地日期/类型/金额推断，不自动阻止人工选择 | portability-service.ts:769–826；platform-bills.ts:322 起 |
| D021 | 平台自动创建或恢复命名为微信/支付宝的账户及必要分类；未知分类行为与本应用 CSV 不同。退款分类收入自动带 isRefund，平台导入不建立退款关联 | portability-service.ts:846–869、932、995–1074 |
| D022 | 平台忽略规则：无效金额、中性/不计收支、失败/关闭/异常/已退款/全额退款/退款成功等；成功平台收入优先允许，部分支出充值提现还款、零钱通/余额宝资金划转/理财等跳过 | platform-bills.ts:142–167、273–319 |
| D023 | 备份列表自动读取，显示文件名、体积与创建时间；“立即备份”后重新读取列表；空状态/加载/错误提示存在 | DataTab.kt:101–127、287–316；portability-service.ts:1085–1121 |
| D024 | 备份是服务端 dataDir/backups 下整库 .db 快照、不是手机副本；VACUUM INTO 保持 WAL 一致，校验 integrity_check 和应用表数，API 手动备份保留 30 天 | portability-service.ts:1109–1114；cli-db.ts:22–25、114–172 |
| D025 | 恢复只有说明文字：服务器停服/备份当前库/核对快照/按部署文档恢复/健康与账本检查；无 APP 内下载数据库、删除备份、恢复数据库端点 | DataTab.kt:45–49、312–321；portability.ts:27–32 |
| D026 | 工资、周期规则只能导出，没有对应导入；CSV 不是整库备份，账单 CSV 没有 refund_links 关联字段、工资 CSV 是记录及 allocations 快照、周期规则 CSV 不含账户列/完整历史 | portability-service.ts:48–80；portability.ts:62–109 |

### 3. I：物品资产、照片与抠图

入口：我的 → 物品资产。物品不属于财务账单，不会改变账户余额、预算或收支统计。实现的是持有成本/日均成本，不是会计折旧模型，没有折旧率、寿命、残值、折旧方法输入。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| I001 | 物品状态筛选：全部/使用中(active)/闲置(idle)/已售出(sold)/已退役(retired)；换状态回第 1 页 | ItemsTab.kt:179–184；item-service.ts:13 |
| I002 | 手动搜索名称/分类/品牌/型号/备注；输入后按“搜”才查询；后端 q≤100 字；API category 精确筛选在 Android 未提供独立控件 | ItemsTab.kt:102–108、187–195；item-service.ts:351–384 |
| I003 | 每页 50，上一页/下一页/当前页/总数；排序由服务端购入日期倒序、更新时间倒序、ID 决定；API 最大 200/offset≤1,000,000 | ItemsTab.kt:220–223；item-service.ts:359–403 |
| I004 | 概览显示在册购入总额/currentDailyCostCents；概要独立加载失败不妨碍列表。概要为全体未删除物品，不随列表过滤变化 | ItemsTab.kt:114–122、197–212；item-service.ts:406–435 |
| I005 | 列表每项名称、状态、分类、持有天数、购入价（空为未记录）、日均成本（未知有占位），点击详情；加载、空/无搜索结果、错误状态 | ItemsTab.kt:214–255、266–281 |
| I006 | 添加/编辑：名称*、物品自由文本分类、品牌、型号、备注、购入日期 YYYY-MM-DD、可空购入价格（元）、可选关联已有支出、使用中/闲置 | ItemsTab.kt:293–337 |
| I007 | 保存：名称非空、元金额解析有效；可空价格发送 null，类别空的新物品默认“其他”；服务端名称≤120、分类≤60、品牌/型号/备注各≤500 字，价格非负 safe integer 分；日期非负整数时间戳且不晚于今天 | ItemsTab.kt:347–376；item-service.ts:17–20、120–153、454–474 |
| I008 | 保存成功返回列表并刷新；失败保留填写内容；取消直接关闭，当前物品编辑没有独立脏表单离开确认/持久化草稿 | ItemsTab.kt:137–151、371–384 |
| I009 | 购入关联只能是活跃非退款支出，售出关联只能是活跃非退款收入；选择已有账单不新增/修改账单；旧关联账单后来删掉不影响物品历史 | LedgerLinkPicker.kt:57–99；item-service.ts:690–705 |
| I010 | 关联选择器：按收支类型、每页 50，显示金额/日期/备注；单选选择、清除关联、取消；物品调用没传 onAuthExpired 回调，选择器局部可设置过期提示，但非登录 401 同时由 ApiClient 拦截器与 MainActivity 全局流程清会话并返回登录。选择器无点击跳到账单详情的回调 | ItemsTab.kt:326、605；LedgerLinkPicker.kt:57–63、82–95、144 起；ApiClient.kt、MainActivity.kt |
| I011 | 物品详情重新 GET 数据及照片，照片框按原比例显示，区分无照片/照片已存但无法预览；可返回、重试加载、编辑 | ItemsTab.kt:415–432、479–518、582 |
| I012 | 当前详情展示名称、状态、持有天数与日均成本；不完整展示 DTO 的品牌/型号/备注/购入日期/购入价/结束日期/售出价/净成本/买卖关联/创建更新时间 | ItemsTab.kt:487–515；item-service.ts:202–222 |
| I013 | 上传照片：系统 image/* picker、原字节与 provider MIME（缺省 JPEG）直接 PUT 后刷新；手机默认读取≤5 MiB；服务端仅接受 JPEG/PNG/WebP，≤2 MiB、签名及尺寸匹配、≤4000 万像素 | ItemsTab.kt:459–473；DocumentFiles.kt:23；item-service.ts:320–336 |
| I014 | 一物品最多一张照片，上传替换当前照片；图片 BLOB 存数据库因此跟随整库备份；图片 GET 认证、no-store/nosniff | item-service.ts:628–652；items.ts:73–104；item-assets.md |
| I015 | 删除照片确认弹窗；资料保留，图片从服务器移除；busy 时按钮阻止重复操作；失败显示错误 | ItemsTab.kt:519–523、625–656 |
| I016 | 生成抠图候选需已保存照片且无现存 job；照片解码采样到至多约 1600 边，再压缩 WebP 质量 90 后 POST；生成不是识别物品名称/分类，也不会自动选择 | ItemsTab.kt:270–276、525–552 |
| I017 | jobId 后每 1500ms 轮询；queued/running/ready/failed/cancelled；ready 下载每个 WebP 预览，显示候选；failed/cancelled 停止轮询 | ItemsTab.kt:434–456；item-cutout-client.ts:3 |
| I018 | 点“使用此候选”下载透明 PNG → PUT 为照片 → 检查上传成功 → 刷新 → 清理 job；未成功上传保留原图。取消抠图 DELETE job，清空候选/预览、原图保留 | ItemsTab.kt:559–580 |
| I019 | worker 服务可选；普通照片上传不依赖 worker。未配置 worker/未就绪/过载/超时/已过期任务会明确报错；候选是临时结果，离开页面不保存 jobId，未实现离开时自动取消 | item-cutout-client.ts:215–280；ItemsTab.kt:434、577–580 |
| I020 | worker 默认输入≤2 MiB、源≤4000万像素、归一化边长≤1600、≤8候选、≤2活跃job、≤3保留job、超时120s、结果TTL600s；串行 SAM2 推理、取消/清理临时文件；透明候选≤16 MiB，预览≤2 MiB | cutout settings.py:28–52；jobs.py:78、103–105、207–223；engine.py:195–227 |
| I021 | “结束持有”：确认框填写结束日期，调用 retire；“售出物品”：结束日期、非负卖出价（元，UI 必填）、可选关联收入；终止前提 active/idle，结束日期不早于购入且不晚于今天 | ItemsTab.kt:583–620；item-service.ts:587–617、674–687 |
| I022 | “删除物品”确认后软删除，仅物品不删除账单；物品不会出现在账单回收站，也没有客户端恢复物品功能 | ItemsTab.kt:588–620；item-service.ts:620–625；trash.ts:1–25 |
| I023 | 服务端持有天数为本地日期差≥0；日均成本=四舍五入(净成本/天数)，同日或未知净成本为 null；active/idle/retired 净成本=购入价；sold 净成本=购入价−售出价，可负 | item-service.ts:180–200 |
| I024 | 服务端 currentDailyCost 只加 active/idle 的有效日均成本；累计购入总额加所有未删除且已知购入价。概要还返回总数及4状态数量，Android 未展示这些数量 | item-service.ts:406–435；ItemsTab.kt:197–212 |
| I025 | 编辑 sold/retired 并选 active/idle 可重新打开，服务端清空结束日期、售出价、售出关联；直接 PATCH 到新的 sold/retired 状态禁止，必须生命周期端点 | ItemsTab.kt:327–333；item-service.ts:537–554 |

### 4. T：账户间转账与账单回收站

入口：我的 → 转账、我的 → 回收站。转账是独立表，只改变两个账户之间的资金位置，不计入收入、支出或预算。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| T001 | 转账列表每页 50、总数/页码/上一页下一页/刷新/重试/空状态 | TransfersTrashTabs.kt:43–155 |
| T002 | 行展示备注（空有占位）、账户名称方向、日期与元金额；账户名读取失败显示信息不可用，已删除账户显示已删除；不会把 ID 直接当名称 | TransfersTrashTabs.kt:63–95、121–140 |
| T003 | 新建/编辑：转出账户、转入账户、金额（元）、日期 YYYY-MM-DD、备注；账户菜单来自账户 API；交换方向按钮；保存/取消 | TransfersTrashTabs.kt:165–207 |
| T004 | 客户端金额>0、账户非空且不同、日期可解析；服务端金额为正 safe integer 分，账户存在未删除，日期≥2000-01-01 且≤now+1日缓冲；备注必须文本 | TransfersTrashTabs.kt:194–200；transfer-service.ts:89–127、239–241 |
| T005 | 编辑更改金额/日期/备注或账户，POST/PATCH 成功返回列表刷新；失败保留编辑。转账编辑未实现脏表单离开确认 | TransfersTrashTabs.kt:105–108、165–207 |
| T006 | 转账删除需确认“转账没有回收站”，API 实为软删除；两边余额依据 live transfers 重算，因此撤销转账对余额的影响；无恢复转账端点 | TransfersTrashTabs.kt:156–158；transfer-service.ts:256–268 |
| T007 | 服务端支持按 accountId 过滤及 GET 单条详情，客户端未提供账户过滤/独立转账详情；分页 API 默认50、最大500 | transfers.ts:37–62、86–88；transfer-service.ts:26–27、130–160 |
| T008 | 回收站只显示服务端返回的软删除账单，不含工资、规则、转账、物品；每行显示备注、日期、金额 | TransfersTrashTabs.kt:216–335；trash.ts:1–25 |
| T009 | 单项恢复直接 POST，无确认框；恢复幂等，已恢复返回同账单，删除不存在则404；成功重新 GET 回收站 | TransfersTrashTabs.kt:289–314；transaction-service.ts:655–663 |
| T010 | 单项“永久删除”需要确认；只允许已软删除账单，删 live账单409；永久删除前清除该账单参与的退款关联，不可恢复 | TransfersTrashTabs.kt:315–325、336–396；transaction-service.ts:677–692 |
| T011 | “全部恢复”确认后 restore-all，作用于所有已删账单而不只是目前显示行；服务端返回 restored/remaining，UI 只刷新列表 | TransfersTrashTabs.kt:258–272、336–396；transaction-service.ts:696–703 |
| T012 | “彻底清空”确认后 DELETE /trash，作用于全库软删除账单，先删相关退款链接；服务端返回purged/remaining，UI只刷新列表 | TransfersTrashTabs.kt:258–272、336–396；transaction-service.ts:707–725 |
| T013 | 回收站加载、错误、busy禁用按钮；初次加载后无专门手动刷新/重试按钮，无显式空状态文案；listTrash不接受筛选/分页参数 | TransfersTrashTabs.kt:230–334；LedgerRepository.kt:94–111 |
| T014 | 回收站按删除更新时刻降序，最多返回500条；total为全库删除数，但 Android 忽略total、没有分页，批量确认文案可能误称“所列账单” | transaction-service.ts:246、737–755；TransfersTrashTabs.kt:231–251、341–353 |

### 5. R：周期规则、生成与待确认

入口：我的 → 管理周期规则；我的 → 待确认周期账单，首页也能打开待确认。规则不直接自动记账，不是后台闹钟/通知/定时服务；实际由客户端显式请求生成，再逐笔确认。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| R001 | 规则列表读取规则+收入/支出分类+账户，展示名称、收支类型、金额、频率/锚点、分类/账户、启用状态；刷新保留旧数据并提示更新失败 | RecurringRulesTab.kt:114–152、187–359、362–435 |
| R002 | 新建/编辑：规则名称、支出/收入、元金额、对应类型分类、账户、daily/weekly/monthly/quarterly/yearly、锚点日期；新建默认支出/每月/今天 | RecurringRulesTab.kt:530–558、602–681 |
| R003 | 切换收入/支出清除旧分类；分类/账户下拉，无有效选项时提示不可保存；锚点用日期选择器，不允许直接文字编辑 | RecurringRulesTab.kt:608–646、669–682、765–776 |
| R004 | 客户端名称非空≤60、金额有效>0、分类/账户已选、日期可解析；服务端创建同类型可用分类/账户校验，锚点≤now+1日缓冲并规范到本地日期，金额正整数分 | RecurringRulesTab.kt:700–728；recurring-service.ts:200–211、530–580 |
| R005 | 保存返回列表；失败保留填写；明确 4xx 允许修正重试，5xx/通用网络异常等不明确结果禁用再次保存，先返回列表刷新核对。UI 虽有 OfflineException 的未提交可重试分支，但 ApiClient 未实现网络预检或抛出该类型，不能保证断网实际进入此分支。脏表单系统 Back/内部取消需“放弃修改/继续编辑”；MyTab 外层顶部“返回我的”直接关闭子页，可绕过该确认 | RecurringRulesTab.kt:566–574、737–750、779–796；MyTab.kt closeSection/顶部返回；ApiClient.kt |
| R006 | 启用/停用只能在服务端确认后更新开关；操作失败保持旧状态并暂停相关操作直到刷新；减少动态模式使用文字启用/停用按钮 | RecurringRulesTab.kt:281–305、395–409 |
| R007 | 服务端新建默认 enabled=true；重新启用重置游标到今天之后的下一到期日，停用期间历史不会补齐；现有 pending没有因停用自动删除 | recurring-service.ts:233、285–298 |
| R008 | 删除规则需确认，软删除规则及其未处理 pending；已确认账单、已确认/忽略 occurrence历史保留；删除结果不确定需刷新核对后操作 | RecurringRulesTab.kt:311–355；recurring-service.ts:301–320 |
| R009 | 修改锚点会重置下一发生日期游标；已生成 pending 是当时类型/金额/分类/账户/名称的快照，不随未来规则编辑自动覆盖 | recurring-service.ts:275–279、393–407 |
| R010 | 打开待确认、刷新与已处理后先 POST generate，再 GET pending；生成幂等按(ruleId, plannedDate)去重，第一到期日为锚点，生成至服务端今天 | PendingTab.kt:95–120、220–235；recurring-service.ts:231–234、338–420 |
| R011 | 超期只保留每条规则最近12个到期周期；更旧周期丢弃，hasOlderDue/truncated提示；游标推进到今天之后，反复刷新不会继续补旧周期 | recurring-service.ts:48、357–380、414–420 |
| R012 | 待确认列表 oldest first、不分页、不筛选；每项备注（一般规则名）、收入/支出、计划日期、金额、分类与账户、待确认标签；服务端返回总项数 | PendingTab.kt:428–493；recurring-service.ts:425–432；recurring.ts:120–123 |
| R013 | 列表补充分类/账户名失败仍保留 pending，标记不可确认；分类/账户当前不可用时确认禁用，忽略仍可执行 | PendingTab.kt:127–150、341–359、479–493 |
| R014 | 单项确认先弹窗核对名字/金额/日期/分类/账户；确认入账按 occurrence快照创建账单，影响财务页；已确认重复请求返回created=false而不新增 | PendingTab.kt:198–224、362–425；recurring-service.ts:453–494 |
| R015 | 单项忽略需确认；不生成账单、从待确认移除；重复忽略幂等；确认已忽略/忽略已确认均409 | PendingTab.kt:216–235、362–425；recurring-service.ts:474–476、505–524 |
| R016 | 操作不明确不先删列表，不重新提交；“刷新核对”只 GET pending，看目标是否已移除；确认的total重新GET前标为旧数，加载/生成/读取错误分开，保留旧内容 | PendingTab.kt:95–196、220–235、279–331 |
| R017 | 没有批量确认/批量忽略/确认时改金额日期/系统提醒/单条详情页；确认后只提示关联页面刷新更新 | PendingTab.kt:198–224、428–493 |
| R018 | API 可读取所有 occurrence（pending/confirmed/ignored）历史但客户端 repository/界面未调用；规则下一日期与 hasOlderDue 在 DTO中，不等于客户端完整历史管理 | recurring.ts:113–118；BudgetRepository.kt:84–118；recurring-service.ts:53–84、435–442 |

### 6. API 对照表

全部端点以 `/api/v1` 为前缀，需要会话；写操作经客户端统一请求头。表中的“界面”只表示源码调用路径存在，不表示设备验收通过。

| 方法 | 相对路径 | 输入/输出要点 | Android 状态 |
|---|---|---|---|
| GET | /export/transactions.csv | 含退款标志的账单 CSV | D001 |
| GET | /export/salaries.csv | 工资/账户/分配快照 CSV | D002 |
| GET | /export/recurring.csv | 周期规则 CSV | D003 |
| GET | /export/transfers.csv | 转账 CSV | D004 |
| POST | /import/transactions | text/csv → inserted/skipped/total | D009–D011 |
| POST | /import/transfers | text/csv → inserted/skipped/total | D012 |
| POST | /import/platform-bills | fileBase64/source/dryRun/fileName/selectedIds/categoryOverrides → rows、计数/金额/warnings | D014–D022；也支持服务端 raw输入/手动source，但客户端未暴露 |
| GET | /backups | items:fileName/sizeBytes/createdAtMs | D023 |
| POST | /backups | 创建快照 → fileName/sizeBytes/createdAtMs | D024 |
| GET | /items | status/category/q/limit/offset → items,total,limit,offset | I001–I003；category未暴露 |
| GET | /items/summary | 状态数量/累计购入额/当前日均成本 | I004、I024 |
| GET | /items/:id | 全部物品DTO | I011；展示字段有缺口 |
| POST | /items | I006字段 → 201物品 | I006–I008 |
| PATCH | /items/:id | editable字段 → 物品；重开支持 | I006–I008、I025 |
| DELETE | /items/:id | 软删除 →204 | I022 |
| POST | /items/:id/sell | closedDate,salePriceCents?,saleTransactionId? | I021；服务端售出价可空，UI必填 |
| POST | /items/:id/retire | closedDate | I021 |
| PUT | /items/:id/photo | JPEG/PNG/WebP二进制 →204 | I013–I014 |
| GET | /items/:id/photo | 已存图像二进制/认证/no-store | I011、I014 |
| DELETE | /items/:id/photo | 删除照片 →204 | I015 |
| POST | /items/cutouts | image/webp →202{jobId} | I016 |
| GET | /items/cutouts/:jobId | jobId/state/message/candidates | I017 |
| DELETE | /items/cutouts/:jobId | 取消/清理 →204 | I018–I019 |
| GET | /items/cutouts/:jobId/candidates/:candidateId/preview | WebP预览 | I017 |
| GET | /items/cutouts/:jobId/candidates/:candidateId/image | 透明PNG | I018 |
| GET | /transfers | accountId?/limit/offset →items,total,limit,offset | T001、T007 |
| GET | /transfers/:id | 单条转账 | 仅服务端，客户端无独立详情 |
| POST | /transfers | fromAccountId/toAccountId/amountCents/date/note →201 | T003–T004 |
| PATCH | /transfers/:id | 同字段部分更新 | T005 |
| DELETE | /transfers/:id | 软删除 →204 | T006 |
| GET | /trash | 最近最多500行+全库total | T008、T014 |
| POST | /trash/:id/restore | 恢复并返回账单 | T009 |
| DELETE | /trash/:id | 永久删除 →204 | T010 |
| POST | /trash/restore-all | restored/remaining | T011 |
| DELETE | /trash | purged/remaining | T012 |
| GET | /recurring/rules | items完整规则 | R001 |
| POST | /recurring/rules | name/type/amountCents/categoryId/accountId/frequency/anchorDate/enabled? →201 | R002–R004；enabled不在创建表单 |
| PATCH | /recurring/rules/:id | 规则editable字段 | R005、R009 |
| POST | /recurring/rules/:id/enabled | {enabled:boolean} | R006–R007 |
| DELETE | /recurring/rules/:id | 删除规则与未处理项 →204 | R008 |
| POST | /recurring/generate | created/truncated/pending | R010–R011 |
| GET | /recurring/pending | items,total | R012 |
| GET | /recurring/occurrences | 所有非删发生历史 | R018，仅服务端 |
| POST | /recurring/occurrences/:id/confirm | transaction,created | R014 |
| POST | /recurring/occurrences/:id/ignore | occurrence | R015 |

### 7. 已识别限制与差异（需要主 README 明确维护）

1. **CSV 限额冲突**：Android 本应用 CSV 可选 10 MiB，但 Fastify全局 `bodyLimit:8*1024*1024`（app.ts:60），无对应导入路由提升上限，8–10 MiB 文件可选但提交会413；本地检查与成功导入上限不可混写。平台5MiB Base64约6.67MiB加JSON，仍在8MiB附近但未实测。
2. **照片限额冲突**：手机允许读取5MiB原图，服务端照片≤2MiB；普通上传不压缩，因此2–5MiB选图可读但被拒。worker候选允许≤16MiB，而最终物品照片仍≤2MiB；大候选可能可预览但保存失败。不要承诺所有候选都可保存。
3. **回收站500行及全量操作**：客户端不显示total/无分页，bulk却影响全库；“恢复所有返回的账单/所列账单”与实际全库恢复不符，需要将此列为现有问题而不是功能说明中的保证。
4. **超期周期提示错误**：PendingTab.kt:105文案称再次刷新可继续处理；后端只留最近12周期、游标跳到今天后，旧周期不会再补齐。README应忠于服务端事实并记下待修正文案。
5. **物品详情字段未完整呈现**：支持输入≠支持在详情完整查看。售出价服务端可空而UI强制非负已填金额；概要数量未显示；终态详情没有独立修改售出价格/日期/关联界面，只能重开再闭合。
6. **关联选择器可出现退款收入候选**：物品售出按type=1列收入，并未预筛退款，最终服务端拒绝退款关联；不能把选择器全部候选视为有效售出关联。
7. **设备未验证**：SAF读取/写入、GBK/xlsx实际文件、超大文件、透明PNG、worker模型与超时、删除/恢复重算、UI金额语义、Android最低版本/HarmonyOS4均需独立设备与服务器证据。
8. **局部与全局认证处理分开**：多个 DataTab 确认导入/备份及照片/售出/转账删除操作只 catch Exception，未显式调用 onAuthExpired。但 ApiClient 拦截器对所有非登录 401 清理 Cookie 并设置 sessionExpired，MainActivity 收集该状态后返回登录；不能仅凭局部 catch 推断缺少全局导航。该全局路径属于源码接入，本轮没有设备响应时间或运行验证。
9. **规则编辑引用校验缺口**：createRule显式assertReferencesUsable；当前updateRule只检查字段形式，不同于创建时引用校验，已生成pending最终确认创建账单时会被交易服务校验。记录此为代码差异，不宣称编辑已具有完整服务端同类型引用校验。
10. **无新增功能假设**：没有任意Excel通用导入、数据库下载到手机、云盘备份、照片相机入口/批量照片、会计折旧、物品回收站、定时推送/自动确认、周期发生历史客户端、转账搜索/账户筛选/恢复。

### 8. 维护规则建议

- 上述D/I/T/R ID随功能保留，每次UI/repository/API/service/shared parser改动同步更新对应行、证据行号、API与差异表。
- 修改导入文件/图片/请求限额必须同时检查 DocumentFiles、app.bodyLimit、路由/service、worker，不能只修改文案。
- 修改删除/恢复/周期生成应同时检查数据作用范围和确认文案；“显示的行数”与“全库批量操作范围”分别记录。
- 新页面接入时将“仅服务端”改为“有客户端入口”，附导航证据；移除功能标记“已移除，日期”，保留旧 ID。
- “已实测”只有设备/版本/步骤/结果证据完整才填写；更新日期与源码核对日期分别记录。
- Related specs: [.trellis/spec/backend/item-assets.md](../../../spec/backend/item-assets.md)、[native-delivery.md](../../../spec/backend/native-delivery.md)、[frontend/state-management.md](../../../spec/frontend/state-management.md)。本研究以当前代码为主；部分旧Web规范或注释与现有Android不同。
- External references: 无；本轮是内部功能事实核查，没有依赖外部文档或新增库版本。

## Caveats / Not Found

- 无设备、构建、自动测试、服务端探测；内容是静态源码事实清单。
- 此文件覆盖所分配的数据/物品/转账/回收站/周期域；登录、主题安全设置、工资预算/统计、AI、分类账户管理另由主任务整合。
- `RecurringRepository` 实际在 BudgetRepository.kt，`ItemPhotoUploader` 注释过时；源码注释不是已实现功能的充分证据。
