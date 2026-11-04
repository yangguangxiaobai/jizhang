# 记账 Android App：当前功能目录

> 源码核对日期：**2026-10-10**；导航/主题/首页/账单增补核对：**2026-10-10（本轮 UI 重构）**。维护对象是当前工作区（包含未提交的 UI 改动），不是仅以 Git HEAD 或旧设计稿为基准。本文记录“目前有什么、怎样输入和操作、接口及限制是什么”，作为后续 UI 重做、功能验收和维护的事实基线。

**本轮实现状态（源码级，已编译验证，未做设备验收）：** 底部导航已改为 4 个一级页面 + 中央记账动作（首页 / 账单 / ＋ / AI 助手 / 我的）；预算与统计改为首页快捷卡片进入的二级页；AI 聊天为一级入口（“我的”仅保留 AI 接口设置）；首页详情→编辑导航缺口已修复（P022 关闭）；钛蓝 Token 已按 #3478F6 / #24579D / #F6F8FC / #FFFFFF / #EEF3FA / #172B4D / #7A879A / #16A57A / #E85D65 / #E9A23B 对齐，卡片圆角 22dp、控件 14dp。moment：`assembleDebug`、`testDebugUnitTest`（11/11）、`lintDebug` 通过；设备/深色/小屏/键盘/真实账务流程仍未验证。

**证据等级：源码审计。** 本轮仅查代码和维护文档，没有构建、运行测试、安装 APK、连接生产服务器或真实 AI/抠图服务。下文“已接入”表示可找到实际 UI → Repository → API 路径，不能当作设备实测成功。Android API26 / 鸿蒙4、文件选择器、弱网、动画和真实账务流程都需要另行验收。

本次审计直接收录 **313个稳定功能条目、30个助理工具、109个服务端API接口、38个原审计main Kotlin文件（本轮新增2个AI feature文件；当前工作树另有前轮FinanceComponents，现为41个）、13个route文件**。313条包括工具条目，工具数不另加到总数。

**维护方式：每次相关功能代码修改，同一批次更新本 README。** 这不是自动监控或定时更新服务。源文件或接口发生变化而文档未改，视为文档漂移。

原来的 [UI 重构设计](ui-redesign/README.md) 是设计提案，本目录是实际功能清单；S01–S48 或动画十二原则的设计内容不等于全部实现和验证完成。

## 目录

- [1. 产品范围与状态标记](#scope)
- [2. 导航与全部入口](#navigation)
- [3. 平台、会话、外观和设置](#platform)
- [4. 首页、账单、工资、预算、统计与主数据](#ledger)
- [5. 数据文件、物品、转账、回收站和周期](#operations)
- [6. AI 助理、Provider、30 个工具和接口](#assistant)
- [7. 表单字段与操作速查](#forms)
- [8. 账务口径与数据边界](#accounting)
- [9. 已知问题与显示缺口](#gaps)
- [10. 没有接入或不存在的功能](#absent)
- [11. 源码和 API 覆盖](#coverage)
- [12. 维护流程、记录模板和变更日志](#maintenance)

<a id="scope"></a>
## 1. 产品范围与状态标记

这是 Kotlin / Jetpack Compose 单 Activity 记账客户端，连接自托管单用户后端。主要域包括账单、收入/工资、预算分配、账户余额、周期待确认、统计、主数据、转账、文件导入导出、物品持有成本和 AI 助理。金额传输/存储为整数分，页面格式化成元；普通页面金额通常无货币选择。

默认 API 服务地址为 `https://jz.yansuu1.xyz`，请求前缀 `/api/v1`。域名根不再托管 Web 页面；保留的 Web 源码是参考，不能作为 Android 已实现的证据。

| 标记 | 含义 |
|---|---|
| **直接 UI** | Android 有页面、按钮或字段和实际 API 调用 |
| **间接工具** | 可由助理白名单工具调用，但没有同等完整独立 UI；模型选择与摘要展示存在限制 |
| **仅服务端** | API/service/CLI 已有能力，Android 没有入口或未调用 |
| **源码缺口** | 字段未展示、入口/限制不一致或代码行为与文案不符 |
| **设备未验** | 有源码证据，当前没有相应设备/服务运行证据；适用于全部功能条目 |

稳定 ID 前缀按审计域保留：P 平台；L00 导航、L01 首页、L02 列表、L03 详情、L04 编辑、L05 关联；B01 预算、B02 统计、S01 工资、M01 主数据、M02 模板，D 文件、I 物品、T 转账/回收站、R 周期、A AI。条目涉及多个操作时仍以同一个原审计 ID 追踪；引用 ID 不代表新增功能。

<a id="navigation"></a>
## 2. 导航与全部入口

证据：[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)、[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)。

| 一级入口 | 页面/动作 | 可以继续进入 | 返回和限制 |
|---|---|---|---|
| 登录/冷启动 | 会话检查、用户名/密码登录 | 独立服务器地址页 | 地址页返回登录；验证过会话才进入主界面 |
| 首页 | 问候、总余额 Hero、预算/统计快捷卡、待确认提醒、最近账单 | 全部账单、最近账单详情、记一笔、待确认、预算页、统计页 | 详情/编辑/预算/统计隐藏底栏；详情→编辑已路由到账单编辑分支（P022 已修复） |
| 账单 | 月度账单、搜索、筛选、分页 | 新建、详情、编辑、删除 | 详情/编辑全屏；编辑有放弃草稿确认 |
| ＋（记一笔） | 中央圆形动作，非驻留 Tab | 金额、分类网格、账户、日期、备注、标签、退款关联 | 保存/取消回发起前的主页面；父分类不可选 |
| AI 助手 | 一级聊天（欢迎 + 4 快捷 + 工具卡确认） | 历史对话、附件、导入预览 | 二级全屏保留易失草稿；切换底部Tab/进程退出不承诺恢复 |
| 我的 | 分组功能中心 | 下表11个二级入口、退出登录 | 二级页隐藏底栏；使用内存页面状态，没有 URL 深链/持久化页栈 |

| 我的分组 | 二级入口 | 主要功能 |
|---|---|---|
| 账本管理 | 工资记录 | 历史、新增/编辑工资、预算分配 |
| 账本管理 | 分类与账户 | 主数据新增、编辑、排序、删除与引用影响 |
| 账本管理 | 分配模板 | 新建/编辑模板、默认模板、应用到周期 |
| 账本管理 | 周期账单 | 五种频率、启停、编辑/删除 |
| 账本管理 | 待确认账单 | 生成、逐笔核对确认或忽略 |
| 账本管理 | 转账 | 账户间资金转移、分页、编辑、删除 |
| 账本管理 | 回收站 | 账单恢复、永久删除、全部恢复/清空 |
| 智能与物品 | AI 接口设置 | Provider、认证、高级请求配置、测试保存配置 |
| 智能与物品 | 物品资产 | 资料、购入/售出关联、持有成本、照片/抠图 |
| 数据与账户 | 数据管理 | 4类CSV导出、2类CSV导入、平台导入、服务端备份 |
| 数据与账户 | 设置与外观 | 外观、减少动态、周期日、密码、AI状态、退出 |

**返回边界：** 内层表单有自己的取消/系统返回策略；外层“返回我的”大多直接移除二级页，除工资外并不自动转交表单。页面内存草稿不等于跨进程持久化，不能假定所有表单都具有离开确认。

<a id="platform"></a>
## 3. 平台、会话、外观和设置

本节 P001–P041：直接 UI、本地基础设施及明确不存在的能力混合，按每项描述区分。

### 3.1 逐项功能

| ID | 功能与当前行为 | 主证据 |
|---|---|---|
| P001 | 原生 Kotlin/Compose 单 Activity APK；应用 ID `com.yansuu1.jizhang`，minSdk26、target/compile34；versionCode3，versionName读取根 package.json |[build.gradle.kts](app/build.gradle.kts)|
| P002 | Android 和支持 APK 的鸿蒙4是交付目标；Android8/API26和鸿蒙4的本轮设备兼容性没有证据；Harmony5/6 ArkTS代码属另一客户端 |[native-delivery.md](../../.trellis/spec/backend/native-delivery.md)、[build.gradle.kts](app/build.gradle.kts)|
| P003 | 单用户自托管账本；无注册、多用户、找回密码、客户端 PIN/指纹锁 |[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)、[auth.ts](../../packages/server/src/routes/auth.ts)|
| P004 | 首次使用账号/密码由服务端 set-password CLI配置；客户端给文字指引 |[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)|
| P005 | 冷启动读取服务地址；有匹配会话才请求 auth/me，验证成功进入首页，期间显示检查状态 |[MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt)、[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)|
| P006 | auth/me 请求有10秒 callTimeout，外层会话恢复12秒；失败保持登录界面，不凭旧用户名自动进入 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)|
| P007 | 用户名和密码登录；用户名trim；非空校验；密码可显示/隐藏；提交期间禁登录按钮；错误文字反馈 |[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)|
| P008 | 默认服务器 `https://jz.yansuu1.xyz`；登录页显示当前地址，独立子页修改 |[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)、[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)|
| P009 | 地址要求 http(s) origin：禁止用户名/密码、非根路径、query和fragment；可含端口；去尾斜杠；不添加/api/v1 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)|
| P010 | “恢复默认地址”只先改编辑框；点击保存才持久化到DataStore；没有服务器连通性测试按钮 |[LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt)|
| P011 | 改变服务器会清除旧Cookie；退出也清会话；用户名/密码没有保存到DataStore |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[AuthRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt)|
| P012 | jizhang_session Cookie用SharedPreferences保存，匹配域/路径/过期/Secure，跨进程恢复；不是加密SharedPreferences。服务端SESSION_TTL_DAYS默认30、只接受正整数；登录创建固定到期时间，读取会话不续期。login/me返回expiresAt，但Android只使用username，没有到期时间展示/会话时长设置；默认值不代表实际服务器配置。 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[config.ts](../../packages/server/src/config.ts)、[auth-service.ts](../../packages/server/src/services/auth-service.ts)|
| P013 | 除login外HTTP401触发全局sessionExpired并返回登录；登录失败仅显示凭据错误 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt)|
| P014 | 请求统一添加变更头 `X-Requested-With: fetch`；空POST/PUT/PATCH无JSON Content-Type；API错误映射为status/code/message |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)|
| P015 | 普通HTTP连接15秒、读取90秒；无HTTP响应缓存/Room业务缓存/离线写队列/离线同步 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[build.gradle.kts](app/build.gradle.kts)|
| P016 | 注释提及requireOnline但实际没有该函数/网络监控实现；断网主要由请求失败提示，不能宣称统一预先禁用写入 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、全main源码rg核查|
| P017 | 4 个一级页面 + 中央记账动作：首页 / 账单 / ＋ / AI 助手 / 我的；预算与统计由首页快捷卡进入二级页；记一笔是全屏动作，保存或取消返回来源 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)|
| P018 | 账单详情/新建/编辑、预算/统计二级页、工资、待确认及“我的”二级页隐藏底栏；页面状态主要remember，非Navigation深链/持久化页栈 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)|
| P019 | 首页可跳全部账单、新账单、最近账单详情、待确认、预算页、统计页；预算页跳工资和模板；AI 为一级入口；“我的”11个二级入口（AI 聊天已移出一级） |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)|
| P020 | “我的”三组：工资/分类账户标签/模板/周期/待确认/转账/回收站；AI设置/物品；数据/设置；另有退出登录（AI 聊天不在此） |[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)|
| P021 | 子页顶部/系统返回；工资内部处理未保存退出；不是所有表单都有脏草稿确认，不能将规划规则当全部实现 |[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)、各表单源码|
| P022 | ~~首页详情→编辑导航缺口~~ 已修复（2026-10-10）：详情记录来源页，编辑统一路由到账单编辑分支并保留来源返回 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)|
| P023 | 浅色/深色/跟随系统三主题，即时切换，本地持久化；读取异常回系统默认；保存异常被吞，可能重启不保留 |[MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt)、[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)|
| P024 | 钛蓝/森林绿/极简黑白三配色，即时切换，有外观预览卡；财务语义配色保持独立 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)、[JizhangTheme.kt](app/src/main/java/com/yansuu1/jizhang/ui/theme/JizhangTheme.kt)|
| P025 | “减少动态效果”本地开关；与系统ValueAnimator.areAnimatorsEnabled()的关闭结果取OR；onResume刷新系统开关 |[MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt)、[ThemePrefs.kt](app/src/main/java/com/yansuu1/jizhang/ui/ThemePrefs.kt)|
| P026 | MotionTokens默认press90/quick140/base220/slow320/stagger24毫秒，reduced全0；并非所有Material内置动画被统一控制 |[MotionTokens.kt](app/src/main/java/com/yansuu1/jizhang/ui/MotionTokens.kt)、[Buttons.kt](app/src/main/java/com/yansuu1/jizhang/ui/Buttons.kt)|
| P027 | 共享主/次按钮按下缩放0.98；减少动态不缩放；多页列表/展开/图表消费tokens；设计十二原则不是已全部验收的运行能力 |[Buttons.kt](app/src/main/java/com/yansuu1/jizhang/ui/Buttons.kt)、各ui源码|
| P028 | 设置显示服务器当前周期：null自然月或每月1–28日；自然月与1日区分；读取min/max约束网格，失败重试 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt) SettingsFull|
| P029 | 选择新起算日仅为草稿，改变后才可保存；读取失败不保存；保存确认服务端返回后显示成功，无金额本地重算 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)、[BudgetRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt)|
| P030 | 修改密码输入当前/新/确认，遮罩，不用rememberSaveable；校验当前非空、新非空和两次一致；后端至少8字符 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)、[auth.ts](../../packages/server/src/routes/auth.ts)、[password.ts](../../packages/server/src/services/password.ts)|
| P031 | 改密成功后服务端所有会话作废，客户端清密码并退出；当前密码错误后端401也会触发会话清理 |[AuthRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt)、[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[auth.ts](../../packages/server/src/routes/auth.ts)|
| P032 | 设置只读AI配置状态：读取中/失败重试/未配置/已配置停用/启用；不显示明文密钥，也没有从这里直接跳AI设置按钮 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt) SettingsFull|
| P033 | “我的”主页和设置页都可退出，网络注销失败也清本地Cookie并返回登录；主页不显示当前用户名 |[SettingsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/SettingsTab.kt)、[AuthRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt)|
| P034 | 金额显示整数分转元两位小数；日期epoch ms按设备时区格式化；文本日期以yyyy-MM-dd解析，关闭宽松日历并要求全文消费，但没有固定补零位数的正则校验 |[format.kt](app/src/main/java/com/yansuu1/jizhang/ui/format.kt)|
| P035 | 设备时区与部署Asia/Shanghai可能不同；不宣称所有客户端显示/输入日期统一服务端时区 |[format.kt](app/src/main/java/com/yansuu1/jizhang/ui/format.kt)、部署合同|
| P036 | 只声明INTERNET/ACCESS_NETWORK_STATE；无相机权限/通知权限/生物识别权限；主应用allowBackup=false |[main Manifest](app/src/main/AndroidManifest.xml)|
| P037 | 系统选文件/创建文件入口，不是FileProvider分享；未发现推送、Widget、定时后台记账、系统分享接收、URL深链接入口 |Manifest、[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)、[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| P038 | debug DemoActivity为非exported预览入口，不属于正常应用功能；debug网络策略独立，release未声明明文HTTP允许 |[debug Manifest](app/src/debug/AndroidManifest.xml)、[debug_network_security.xml](app/src/debug/res/xml/debug_network_security.xml)|
| P039 | 设置地址校验能接受HTTP不等于release在Android9+允许明文连接；生产使用HTTPS，保留此区别 |[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、main/[debug Manifest](app/src/debug/AndroidManifest.xml)|
| P040 | 服务端只提供API；访问域名根不提供Web页面；本报告没有再次访问/部署服务器 |[app.ts](../../packages/server/src/app.ts)、[native-delivery.md](../../.trellis/spec/backend/native-delivery.md)|
| P041 | 没有客户端数据库恢复、应用内更新/版本关于页、通用帮助页入口；release无本地正式签名材料时用debug签名 |[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)、[build.gradle.kts](app/build.gradle.kts)|

### 3.2 API 覆盖

| API | 入口/状态 |
|---|---|
| GET /api/v1/auth/me | 冷启动会话恢复 |
| POST /api/v1/auth/login | 登录 |
| POST /api/v1/auth/logout | 两处退出与改密成功后的本地清理 |
| POST /api/v1/auth/password | 设置修改密码 |
| GET /api/v1/health | 后端存在；登录没有测试服务器按钮 |
| GET /api/v1/settings | 设置预算周期读取（委托BudgetRepository） |
| PUT /api/v1/settings | 设置预算周期保存，cycleStartDay为null或服务端允许的整数 |

<a id="ledger"></a>
## 4. 首页、账单、工资、预算、统计与主数据

### 4.1 L00 导航与总览

| ID | 当前功能 / 输入 / 操作 | 源码证据 |
|---|---|---|
| L00.01 | 登录后默认首页；4 个一级页面 + 中央记账动作：首页、账单、＋、AI 助手、我的。预算/统计为首页二级页。记一笔是动作入口，记录来源并返回来源。 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、（以下 ui/ 均指上述 Android ui 目录）|
| L00.02 | 账单新增/编辑/只读详情、预算/统计二级页、工资流程、首页待确认页、我的二级页隐藏底部导航。新账单保存/取消返回来源入口。 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)|
| L00.03 | 首页查看全部切到账单；最近记录打开详情；首页“记一笔”创建账单；提醒卡打开 PendingTab；预算/统计卡打开对应二级页。 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)|
| L00.04 | 预算页“记工资”进入工资历史流程，不直接进入新建表单；“分配模板”切到我的模板二级页。 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)|
| L00.05 | 页面/筛选/草稿普遍使用 Compose `remember`，并非离线账本或持久化草稿；进入别的主分支后重新组合可丢失局部状态。 |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)、[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|

### 4.2 L01 首页

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L01.01 | 首页刷新顺序请求本月趋势（1个月）、最近5笔、当前预算、分类；再尝试账户余额；将主要结果一起发布。顶部问候 + 日期副标题 + 显式刷新按钮，加载时禁用；不设通知按钮。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.02 | 总余额 Hero 显示服务端 `totalBalanceCents`，标“所有账户”；负值用危险色；下方并排本月收入/支出（服务端 `incomeCents`/`netExpenseCents`）。账户请求失败是补充错误，不清空主页面；已加载的余额可保留。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.03 | 收支概览显示服务端 `incomeCents`、`netExpenseCents` 与服务端月份标签；缺数据为“—”，不在客户端从5条列表累加。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.04 | 首页两张快捷卡：预算管理（已用/共计 + 封顶进度，点击进完整预算页）、统计分析（本月支出 + 仅服务端值迷你条，点击进完整统计页）；无数据正常空状态，不伪造趋势。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.05 | 首页依据每个模块已用/预算提示接近上限（≥80%）、超支（>100%），零预算且有支出也算超支；负结余池提示借用/透支。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.06 | 首页每次 reload 调显式 POST recurring/generate 后 GET pending；只在 pendingCount>0 显示可点击提醒卡；提醒失败单独显示并可重试整个首页。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.07 | 最近5笔显示标题（备注优先、否则分类）、日期/分类、收支符号与金额，可点开详情；空列表有提示和底部“记一笔”。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|
| L01.08 | 首次加载显示进度，首次失败阻断正文且有重试；刷新时保留上次成功结果，进度和“保留上次结果”提示；刷新失败保持旧数据显示错误/重试。401交统一过期处理。 |[DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt)|

### 4.3 L02 月度账单列表与筛选

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L02.01 | 默认本月；左右箭头任意前后切月，月份区间为设备本地月初00:00到下月初（右开区间），无“全部历史”或自定义日期范围。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.02 | 支出/收入/全部类型 chip 即时更新；退款收入属于收入筛选。切月/类型/账户/分类/标签/搜索均重置第1页；列表按日期分组展示。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.03 | 搜索只查备注；输入框文字为草稿，点搜索图标后 trim 才应用。后端 q 为 literal LIKE，%/_不会变成通配符。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)、[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| L02.04 | 筛选底部面板支持一个账户、一个分类、一个标签及“全部”。先修改草稿，“应用”才刷新；取消/滑动关闭不提交；重置仅清空面板草稿。顶部搜索/筛选收纳为图标按钮。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.05 | 活跃筛选为可单独清除 chip；整体“清除”清账户/分类/标签/备注搜索，**不清月份和收支类型**；筛选数量只计账户/分类/标签。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.06 | 历史分类/账户名称经 includeDeleted=true 获取，已删除资料也可用于历史筛选；标签来自当前活跃账单派生列表。分类筛选是 exact categoryId，不自动包含子分类。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)、[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| L02.07 | 每页50笔（offset=page×50）；总数/页码、上一页/下一页、显式刷新；后端默认按date降序再updatedAt降序，API单页最大500。删除尾页后会修正页码。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)、[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| L02.08 | 卡片正文点开只读详情；右侧更多菜单有编辑与删除。显示备注、分类、账户、日期、金额、支出/收入/退款收入徽标、每个标签。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.09 | 删除有确认（说明可去回收站恢复），提交时按钮禁用/删除中；失败留对话框错误；成功软删除后刷新。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|
| L02.10 | 首次加载、加载失败重试、无账单“开始记账”、无筛选结果“清除筛选”；有旧列表时加载小进度/失败提示保留旧结果。401退出当前认证流程。 |[TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt)|

### 4.4 L03 只读账单详情

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L03.01 | 读取单条账单，显示支出/收入/退款收入、大金额、分类、账户、日期；备注与标签仅非空时显示；名称用includeDeleted资料，读取失败降级为已删除分类/账户。 |[TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt)|
| L03.02 | 顶部返回和系统返回退出详情；编辑图标在单条账单已加载后可用；无独立删除按钮。 |[TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt)|
| L03.03 | 退款收入逐个 getTransaction(refundLinkedTxIds)，显示原支出标题、日期、金额；失败/未关联时显示“未读取到关联账单详情，关系仍保留”；关联行仅文字，**没有点击跳转**。 |[TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt)|
| L03.04 | 首次进度、错误信息、重试；已读到交易时可同时显示交易和后续错误/更新中。 |[TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt)|
| L03.05 | 后端原支出详情提供refundSummary及refundDetails，当前列表/详情均未读取这些字段，故目前无法从原支出查看已退款总数、金额及退款明细。 |[transaction-service.ts](../../packages/server/src/services/transaction-service.ts) 对照 [TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt)|

### 4.5 L04 新增与编辑账单

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L04.01 | 新建默认支出、当日、第一可用支出分类和账户；编辑先取原始账单，保留type/amount/category/account/date/note/tags/isRefund/关联ID。分类和账户未全部加载前不显示可保存表单，有返回/重试。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|
| L04.02 | 支出/收入切换会选择该类型首个可选子分类（跳过父分类）；切回支出关闭isRefund，退款关联文本仍可在内存里保留但支出保存发送空数组。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|
| L04.03 | 金额优先大字（¥ XX.XX，32sp 等宽）+ 文本框 + 数字键区（仅追加数字/单小数点/删除）；parseYuanToCents使用Double+Math.round，拒绝非有限、负数和>JS安全整数分；保存要求大于0；不支持计算器表达式。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|
| L04.04 | 分类网格按收支类型展示子分类、可选；有子类的支出父分类展示但不可选并提示“父分类不能直接记账”（服务端拒绝父分类记账）。账户列表选择；旧ID不在可用列表时显示已选项目暂不可用且保留ID，服务端决定可保存性；没有可用项时提示先添加。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|
| L04.05 | 日期支持文本和Material DatePicker，确认应用、取消不改；DatePicker用UTC转换确保日期显示，API保存用设备本地日期解析；parseDateInput不宽松且需解析完整文本，但没有固定宽度YYYY-MM-DD正则。服务端日期须≥2000-01-01且不超过服务器当前时间+1天。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)、[format.kt](app/src/main/java/com/yansuu1/jizhang/ui/format.kt)、[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| L04.06 | 备注可选多行；标签可选，中文/英文逗号拆分trim删空；服务端去重、单标签最多32字符、每条最多20个（超出截断而不是验证报错）。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)、[tags.ts](../../packages/server/src/services/tags.ts)|
| L04.07 | 仅收入提供退款标记；标记后可多选原支出，原支出不被改写；非退款收入/支出保存均强制空refundLinkedTxIds。服务端允许退款不关联任何原支出；不验证退款金额≤原支出金额。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)、[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| L04.08 | 保存完整payload（POST新建或PATCH编辑），操作中保存/取消禁用；错误留当前草稿，401调用统一处理；成功返回来源页。普通创建未携带幂等key，超时后手动重试可能重复记账。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)、[LedgerRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt)|
| L04.09 | 取消和系统返回统一requestClose；加载后与baseline比较所有账单字段/关联，修改后提示放弃修改/继续编辑；saving时拦截离开。草稿不持久化。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|
| L04.10 | 保存栏位于正文外且imePadding；表单分金额、账单信息、备注标签、退款关联四组，滚动正文。触摸/键盘遮挡表现待设备确认。 |[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)|

### 4.6 L05 关联账单选择器（退款/物品复用）

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| L05.01 | 由type限定支出或收入，仅按type查询全时段，分页50笔，不支持月份/搜索/账户/标签筛选。打开默认回第1页；显示备注/日期/金额。 |[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)|
| L05.02 | 多选：独立draftSelected，确认后提交；取消/关闭丢弃本次选择。单选点行立即提交并关闭；“不关联”立即清空并关闭。 |[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)|
| L05.03 | 显示已选数量和已选记录，跨页选中不丢；未缓存的已选ID逐条取详情；查不到保留ID显示不可用并可移除；当用户确认移除才修改关联。 |[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)|
| L05.04 | 首次加载/失败重试/空列表；有列表时更新失败保留旧列表；401回调或展示重新登录提示。当前行提示“可从详情跳转核对”未代表选择器本身有详情导航能力。 |[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)|

### 4.7 B01 预算

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| B01.01 | GET periods + overview；默认当前周期。当周期数>1显示横向chip（当前+历史），保留服务端顺序；历史显式只读，显示起始日。未知periodStart服务端返回400，不回退当前。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)、[budget-overview-service.ts](../../packages/server/src/services/budget-overview-service.ts)|
| B01.02 | 有预算显示服务端总预算、已用、结余池（负值标示）；无预算有第一笔工资按钮。`hasBudget`实际是服务端modules非空，不可解读成“有当月工资”的严格判定。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)、[budget-overview-service.ts](../../packages/server/src/services/budget-overview-service.ts)|
| B01.03 | 模块显示父级名称、预算、已用、剩余、封顶进度、未封顶已用百分比；状态正常/将超支（≥80%）/已超支（>100%）/零预算/零预算已超支；不能直接编辑模块额度。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)|
| B01.04 | 模块有children时可展开/收起子分类支出，服务端返回儿童金额。一次仅一个expandedModuleId；切周期清展开。不会跳到账单筛选页。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)|
| B01.05 | 工资与分配卡有模板入口与工资入口；预算另读pending数，有待确认时仅文字提醒，**无点击处理入口**，需首页/我的处理。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)|
| B01.06 | 首次加载、错误重试；切周期失败保持上次成功周期和金额，明确历史/当前标签；提醒失败可单独提示但重试实际reload预算及提醒；无常驻刷新按钮。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)|
| B01.07 | 预算进度由MotionTokens驱动，金额直接显示不动画计数；减少动态时token为0（策略见其他研究）。 |[BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt)|

### 4.8 S01 工资与分配

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| S01.01 | 工资历史/表单/分配三个阶段；入口来自预算或我的。打开先获取账户、工资、模板、支出分类；列表含金额、到账日期、账户、备注和编辑/分配/删除。当前工资GET最多返回最近200条，Android无分页/搜索/月份筛选。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)、[salary-service.ts](../../packages/server/src/services/salary-service.ts)|
| S01.02 | 新增工资：金额、到账日期（文本）、到账账户（必选）、分配模板（必选且默认模板优先）、备注；默认当日，但默认账户为空需明确选择；无模板时无法创建并指示去我的→分配模板。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.03 | 工资金额正数最多两位小数，BigDecimal精确转分，范围≤9,007,199,254,740,991分；不接受负号/指数/空值。日期严格解析，服务端≥2000且不超过now+1天。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)、[salary-service.ts](../../packages/server/src/services/salary-service.ts)|
| S01.04 | 新增按模板比例生成工资分配快照；工资存salary_records而非transactions，账单列表不显示工资；工资会影响账户余额及本月收入。模板小数分舍入由服务端执行。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)、[salary-service.ts](../../packages/server/src/services/salary-service.ts)、[stats-service.ts](../../packages/server/src/services/stats-service.ts)|
| S01.05 | 编辑稳定使用工资ID，先读取单条详情；可改金额、日期、到账账户、备注。未改金额/分配仅PATCH这些信息，保留服务端快照；编辑不允许选择另一模板。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.06 | 修改工资金额时显示同步分配编辑，所有模块非负且最多两位小数，总和必须等于新工资金额，显示差额/超额；零分配项不提交、不能全零；确认“同时替换工资分配”后一次PATCH包含新金额及allocations。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.07 | 独立“分配”流程读取该工资ID详情，可对支出分类填写金额，保留当前资料之外历史分类项并注明；总和=服务器工资金额才能保存；二次确认后PUT替换整份分配，非追加。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.08 | 分配显示局部表单合计仅用于验证，不代替预算/池计算；保存后返回历史并服务器重读，刷新失败明确“操作已确认但列表未刷新”。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.09 | 删除二次确认标明工资金额日期及同时移除分配；后端同时软删除工资与分配；不进入Android交易回收站。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)、[salary-service.ts](../../packages/server/src/services/salary-service.ts)|
| S01.10 | 表单/分配有未保存修改，顶部返回和系统返回提示放弃/继续编辑；历史返回退出流程。加载失败可重试，提交状态/字段错误/总错误分开，分配失败保留输入，401统一退出。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| S01.11 | 三阶段切换有短距离水平移动+淡入淡出，时长baseMillis；列表项位移动画；减少动态直接终态。不能据此宣称十二原则每项实机验收通过。 |[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|

### 4.9 M01 分类、账户、标签管理

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| M01.01 | 我的→分类与账户进入一个页面，内部分类/账户/标签tab；显式刷新；全量列表无分页搜索。首次同时读分类、账户、标签、账户余额，任一失败会影响初次加载。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M01.02 | 分类列表展示支出/收入、内建标记、图标名称、色块、父模块/独立收入/子分类关系；子分类缩进；支持新建、编辑、上移/下移和非内建删除。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M01.03 | 分类表单：名称必填（后端max40）；类型只在新建可选（0支出/1收入）；支出可选独立/顶级支出父模块；收入无父级；图标10种（餐饮/交通/住房/购物/娱乐/工资/医疗/教育/宠物/其他）；颜色12个预设，未命中预设保留原色。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.04 | 后端只支持两层，不能自己作为父级，父级必须活跃支出顶级分类；已有子级的分类不能改成子级；修改分类类型不提供。 |[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.05 | 删除前GET usage展示活跃交易引用数及子类数；软删除保留历史账单名称，子类脱离成为独立分类，同时退役引用该分类的周期规则和pending occurrence。内建分类可编辑但不可删。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.06 | 账户列表显示类型、内建、服务器当前余额、初始余额、负余额提醒；新建/编辑/上移/下移、非内建可删。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M01.07 | 账户输入名称、6类型（现金/储蓄卡/信用卡/支付宝/微信/其他）、初始余额；负数允许，BigDecimal 必须能精确转成整数分且在 JS 安全范围内。UI 提示最多两位小数，但没有小数位正则，带多余末尾零或指数的数值只要精确到分仍可接受；空余额按0处理，名称后端max40。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M01.08 | 删除账户GET usage显示引用交易数和将离开总余额的当前余额，历史账单保留；后端软删除账户并清引用周期规则/pending。账户内建可编辑不可删。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.09 | 标签不支持独立新增；使用账单标签后派生名称/count，按使用次数降序；可改名（必填）与删除。改名为已存在名会合并去重；删除仅从交易移除该标签，不删交易；确认后统一改写。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.10 | 分类/账户上移下移是调用move(dir=-1/+1)与相邻sort_order交换，再刷新；不是拖动排序；边界无相邻项时后端无动作。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[master-data-service.ts](../../packages/server/src/services/master-data-service.ts)|
| M01.11 | 加载占位、初次错误/重试、空态与新建按钮；刷新/保存/删除时busy禁用控件；对话框错误保留草稿；没有未保存编辑放弃确认（可直接取消/关闭）。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|

### 4.10 M02 工资分配模板

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| M02.01 | 我的→分配模板或预算入口；列表显示名字、默认标记、比例合计和每分类比例，显式刷新，无分页。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M02.02 | 新建/编辑模板名称和若干支出分类模块，每项比例以百分数输入；可逐项添加/移除，不默认全量分类；保留缺失分类并明确要求移除后保存。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|
| M02.03 | 模板名必填，至少一个模块；比例每项>0≤100，不能空/非法；总和距离100%必须小于0.01个百分点（后端fraction容差1e-4）；父类与子类不能同时选择。显示实时合计/剩余/格式问题。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[template-service.ts](../../packages/server/src/services/template-service.ts)|
| M02.04 | 可将非默认模板设为默认；成功刷新并反馈。新增工资自动预选默认模板，但历史工资分配快照不会随模板编辑改动。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)|
| M02.05 | 删除须确认“历史工资分配保留”；当前UI对默认模板也显示删除按钮，但服务端拒绝删除默认模板，需先设另一模板为默认。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[template-service.ts](../../packages/server/src/services/template-service.ts)|
| M02.06 | 应用当前周期须二次确认，覆盖该周期所有现役工资的分配快照（不是仅最近一笔，也不改工资金额）；成功反馈；无工资/周期服务端拒绝。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)、[salary-service.ts](../../packages/server/src/services/salary-service.ts)|
| M02.07 | 默认模板/模板列表读取来自服务器；表单保存失败保留输入；初次加载/错误/空态、新建入口、busy防连续操作；直接取消表单无放弃草稿确认。 |[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)|

### 4.11 B02/S02 统计与图表

| ID | 当前能力与行为 | 证据 |
|---|---|---|
| B02.01 | 三独立区：分类占比、收支月趋势、结余池趋势；各自加载/失败/重试，不互相清空。请求序号匹配才发布，旧结果与旧范围标签一起保留。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)|
| B02.02 | 图表/明细两种展示方式是整页本地开关，不新增API；完整金额明细可读，不依赖Canvas触摸。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)|
| B02.03 | 分类区间本月/近30天/近3个月/指定月；“近3个月”本月及前两个月；本月/近3个月截止下月初；显示最早账本记录日期；无自由起止日期。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)|
| B02.04 | 指定月弹窗年+/−（1..9999）、12个月，应用/取消；月边界由服务端month-window给出，以服务器时区为准。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)|
| B02.05 | 当前“近30天”实际from=设备now−30×86400000、to=设备下月初，不是今天为右边界，可能覆盖将来允许入账日期；这是现有代码边界，非产品保证。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)|
| B02.06 | 环形图只绘制正金额slice，服务器总额≤0或无正slice显示不可绘制空态；可点扇区查看分类金额；列表保留全部类别金额及ratio百分比；无“点击分类查看对应账单”导航。 |[Charts.kt](app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt)|
| B02.07 | 分类统计只累加type=0支出，各分类独立（不自动父子合并），按金额降序/名称；不统计工资收入和退款收入。尽管旧注释称net，当前实现是毛支出。 |[stats-service.ts](../../packages/server/src/services/stats-service.ts)、[types.ts](../../packages/shared/src/types.ts)|
| B02.08 | 收支趋势默认6月，可3/6/12月，和分类区间完全独立；后台支持1..36月但App仅暴露三个选项；服务端补无记录月份为0。收入含普通收入+退款+工资，netExpenseCents当前为毛支出。 |[StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt)、[stats-service.ts](../../packages/server/src/services/stats-service.ts)|
| B02.09 | 月度双柱显示收入/净支出标注、月份、图例；点月份柱显示该月两个精确值；全零仍显示轴/明细和无变化提示；坐标支持负值（历史数据适用），不改金额。 |[Charts.kt](app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt)|
| B02.10 | 结余池趋势GET pool-trend，没提供自选范围；线图两端日期、可点看周期/池值、最新池值及逐期明细；支持负池、零轴、单点/空态。 |[Charts.kt](app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt)|
| B02.11 | 图形入场/模式切换、柱/线渐显采用slow/quick tokens，不做金额动画；Canvas语义描述和文字明细可用，但TalkBack、色盲、小屏实际体验待验证。 |[Charts.kt](app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt)|

### 4.12 当前账务规则（以实际函数为准）

1. **毛支出/退款收入**：[types.ts](../../packages/shared/src/types.ts) expenseContribution只给type=0正金额，所有收入贡献0；`:195` incomeContribution给type=1全额，含退款。旧frontend规范与少量源码注释“退款负支出”“净支出”已过时，不能写成现行规则。
2. **工资独立且无自动去重**：salary_records增加收入和到账账户余额，不写transactions。若同一笔工资又手动创建收入账单，两条均计入收入，App没有重复检测。[stats-service.ts](../../packages/server/src/services/stats-service.ts)、`.trellis/spec/backend/index.md`。
3. **账户余额**：初始余额+全部活跃收入+工资+转入−全部活跃支出−转出；没有月份过滤，软删除交易/工资/转账不贡献；已删账户不在余额汇总里，历史账单仍存在。[account-balance.ts](../../packages/shared/src/account-balance.ts)、`:217`。
4. **退款关联只溯源**：对账链接不改写原支出，不冲减支出、不恢复预算，退款增收入/余额。服务端校验关联ID存在、活跃、为非退款支出、去重且不自关联。[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)、[types.ts](../../packages/shared/src/types.ts)。
5. **预算实时由shared引擎计算**：同周期多次工资的模块分配相加；自然月模式按发薪所在月合组；配置1..28起始日时按发薪所在月起始日归属（发薪日早于起始日也分到当月该起始日）。模块消费使用区间内活跃支出，未在模板中的消费仍成为零预算模块。父子支出按顶级父类归集；期末剩余进入累计结余池，超支借用池，池可负；不物化余额。[budget-engine.ts](../../packages/shared/src/budget-engine.ts)、`:150`。
6. **周期起点语义**：自然月group的start是组内最早发薪日（`earliestDate`），不是UI自行假定月1号；账务引擎另按自然月边界计算。在文档中应保留“服务端返回的周期起点”，不要把UI日期擅改成月首。[budget-engine.ts](../../packages/shared/src/budget-engine.ts)、[budget-overview-service.ts](../../packages/server/src/services/budget-overview-service.ts)。
7. **日期/精度**：请求金额整数分、时间epoch毫秒；日期输入和部分统计范围来自设备本地时区，服务器月窗口/周期计算来自服务器时区。文档须区分，不宣称跨时区一致已验收。
8. **删除范围**：账单可进交易回收站；工资/模板/基础资料软删除没有Android恢复入口。删除前确认不等于存在撤销能力。

### 4.13 API 对照与仅服务端/尚未暴露能力

| Android 功能 | 接口 | 与后端的差异 |
|---|---|---|
| 月账单/关联picker/最近列表 | GET `/api/v1/transactions`；GET `/:id`；POST；PATCH `/:id`；DELETE `/:id` | API支持任意from/to、includeDeleted、limit≤500，Android列表限定月、50/页；picker仅type+offset，首页5笔 |
| 原支出退款反查 | GET `/api/v1/transactions/:id` 返回refundSummary/refundDetails | 当前Android详情未展示这些字段 |
| 分类/账户 | GET、POST `/categories` `/accounts`；PATCH/DELETE `/:id`；POST `/:id/move`；GET `/:id/usage` | 后端可传sortOrder，Android仅上下移动；分类类型编辑未开放；includeDeleted用于历史显示但管理列表不显示已删除项 |
| 余额 | GET `/api/v1/accounts/balances` | 服务端还提供每账户flow、正资产/负债等，首页只展示净总余额，管理只展示每账户balance |
| 标签 | GET `/tags`；PATCH `/tags` {from,to}；DELETE `/tags/:name` | 无独立新建接口/标签表，App从交易创建标签 |
| 预算 | GET `/budget/periods`、`/budget/overview?periodStart` | Android仅切已有周期；无预算直接编辑接口 |
| 工资 | GET `/salaries`、`/:id`；POST；PATCH `/:id`；PUT `/:id/allocations`；DELETE `/:id` | 后端POST支持直接allocations或者模板，Android新建仅模板；工资列表服务端最多200、App无分页 |
| 模板 | GET/POST `/templates`；PATCH/DELETE `/:id`；POST `/:id/default`、`/:id/apply-current` | API create支持isDefault，Android创建不提供默认开关而用列表单独设默认 |
| 周期设置 | GET/PUT `/settings`，cycleStartDay=null或1..28 | Android暴露在SettingsTab，由其他研究覆盖 |
| 统计 | GET `/stats/range`、`/month-window`、`/category-share?from&to`、`/monthly-trend?months`、`/pool-trend` | monthly-trend backend1..36；Android3/6/12；category-share backend任意区间、Android四选项 |

<a id="operations"></a>
## 5. 数据文件、物品、转账、回收站和周期

### 5.1 D：数据导入、导出与备份

入口：我的 → 数据管理。该页面为四组功能；平台导入替换本页显示，通过“关闭”返回；所有文件操作使用 Android 系统文件选择/保存组件。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| D001 | 导出账单 CSV；系统“另存”初始文件名 transactions.csv，可自行选保存位置 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[PortabilityRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt)|
| D002 | 导出工资 CSV，初始 salaries.csv |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D003 | 导出周期规则 CSV，初始 recurring.csv |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D004 | 导出转账 CSV，初始 transfers.csv |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D005 | 下载走认证 API；CSV 为 UTF-8，服务端含 BOM；保存成功显示“CSV 已保存到所选位置”，取消保存不执行下载 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability.ts](../../packages/server/src/routes/portability.ts)|
| D006 | 本应用账单 CSV 导入：账单/转账二选一，切换清空所选文件和上次结果；未选文件不展示确认导入按钮 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D007 | 选 CSV：文件 MIME 允许任意类型以兼容 provider，但真实名称必须 .csv（忽略大小写）、内容非空、≤10 MiB；本应用 CSV 按 UTF-8 读取，不执行平台 GBK 解码 |[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)；[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D008 | 取消文件选择保留此前文件；真正另选文件先清空旧文件/结果，读取失败显示错误 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D009 | 点击确认即以 text/csv 内容上传，无本应用 CSV 预览；处理中阻止重复导入，成功展示新增 inserted/跳过 skipped/读取 total 三个数字 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[PortabilityRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt)|
| D010 | 账单 CSV 必需栏位：id/date/type/amount/category/account/note/tags/isRefund；type=expense/income，amount>0 且≤2 位小数，date=YYYY-MM-DD，tags 用竖线分割 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D011 | 本应用 CSV 同 ID（包括已经软删除的数据）跳过；未知分类/账户、空 ID、金额/日期/类型/退款标志错误报错；先校验再事务写入，不能静默创建未知主数据 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D012 | 转账 CSV 必需 id/date/amount/from/to/note；账户按名称匹配且必须是两个不同账户；同 ID 跳过；成功/错误交互同账单导入 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D013 | 服务端兼容旧“支出类型的退款”CSV，归一化为收入退款；没有合法退款分类时明确拒绝 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D014 | 平台账单文件导入支持微信 xlsx 与支付宝 GBK CSV，也可识别 UTF-8/BOM CSV；原始字节 Base64 上传，Android 不解析金额/平台规则 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[PortabilityRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt)；[bill-decode.ts](../../packages/server/src/services/bill-decode.ts)|
| D015 | 平台文件读取上限默认 5 MiB；读取成功后立即 dryRun 预览、显示文件名与识别平台；source 固定 auto，界面没有微信/支付宝手动来源选项。取消选择保留旧文件；另选文件若读取失败也保留旧文件及预览，因为清理发生在读取成功后，与本应用 CSV 不同 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt) PlatformImportSheet picker；[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)|
| D016 | 预览行展示备注（缺则交易对方）、日期、元金额、分类，以及已入账/可能重复/忽略原因状态；实际拼接表达式应设备核对其多状态提示完整性 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D017 | 默认只勾选非已入账、非忽略、非可能重复行；已入账/忽略行不能勾选；可能重复行可以人工勾选确认 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D018 | 每行“改分类”输入自由文本分类名称，确认应用/取消保留旧值；上传 categoryOverrides；没有分类下拉、没有全选/取消全选按钮 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D019 | 确认导入所选 N 行：上传原文件/selectedIds/overrides，非 dryRun；成功关闭面板，主页面展示平台、新增数、支出与收入金额 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)|
| D020 | 平台稳定 wx-/ali- 订单 ID 去重；可能重复由服务端同平台账户的同本地日期/类型/金额推断，不自动阻止人工选择 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)；[platform-bills.ts](../../packages/shared/src/platform-bills.ts)|
| D021 | 平台自动创建或恢复命名为微信/支付宝的账户及必要分类；未知分类行为与本应用 CSV 不同。退款标志来自独立实际收入流水的来源交易类型/分类证据，与所选应用分类名称无关；原退款购买保留支出，平台导入不生成退款流水或建立退款关联 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)、995–1074|
| D022 | 平台忽略规则：无效金额、中性/不计收支、失败/关闭/异常/已退款/全额退款/退款成功等；成功平台收入优先允许，部分支出充值提现还款、零钱通/余额宝资金划转/理财等跳过 |[platform-bills.ts](../../packages/shared/src/platform-bills.ts)|
| D023 | 备份列表自动读取，显示文件名、体积与创建时间；“立即备份”后重新读取列表；空状态/加载/错误提示存在 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability-service.ts](../../packages/server/src/services/portability-service.ts)|
| D024 | 备份是服务端 dataDir/backups 下整库 .db 快照、不是手机副本；VACUUM INTO 保持 WAL 一致，校验 integrity_check 和应用表数，API 手动备份保留 30 天 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)；[cli-db.ts](../../packages/server/src/cli-db.ts)|
| D025 | 恢复只有说明文字：服务器停服/备份当前库/核对快照/按部署文档恢复/健康与账本检查；无 APP 内下载数据库、删除备份、恢复数据库端点 |[DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt)；[portability.ts](../../packages/server/src/routes/portability.ts)|
| D026 | 工资、周期规则只能导出，没有对应导入；CSV 不是整库备份，账单 CSV 没有 refund_links 关联字段、工资 CSV 是记录及 allocations 快照、周期规则 CSV 不含账户列/完整历史 |[portability-service.ts](../../packages/server/src/services/portability-service.ts)；[portability.ts](../../packages/server/src/routes/portability.ts)|

### 5.2 I：物品资产、照片与抠图

入口：我的 → 物品资产。物品不属于财务账单，不会改变账户余额、预算或收支统计。实现的是持有成本/日均成本，不是会计折旧模型，没有折旧率、寿命、残值、折旧方法输入。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| I001 | 物品状态筛选：全部/使用中(active)/闲置(idle)/已售出(sold)/已退役(retired)；换状态回第 1 页 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I002 | 手动搜索名称/分类/品牌/型号/备注；输入后按“搜”才查询；后端 q≤100 字；API category 精确筛选在 Android 未提供独立控件 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I003 | 每页 50，上一页/下一页/当前页/总数；排序由服务端购入日期倒序、更新时间倒序、ID 决定；API 最大 200/offset≤1,000,000 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I004 | 概览显示在册购入总额/currentDailyCostCents；概要独立加载失败不妨碍列表。概要为全体未删除物品，不随列表过滤变化 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I005 | 列表每项名称、状态、分类、持有天数、购入价（空为未记录）、日均成本（未知有占位），点击详情；加载、空/无搜索结果、错误状态 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I006 | 添加/编辑：名称*、物品自由文本分类、品牌、型号、备注、购入日期 YYYY-MM-DD、可空购入价格（元）、可选关联已有支出、使用中/闲置 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I007 | 保存：名称非空、元金额解析有效；可空价格发送 null，类别空的新物品默认“其他”；服务端名称≤120、分类≤60、品牌/型号/备注各≤500 字，价格非负 safe integer 分；日期非负整数时间戳且不晚于今天 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)、454–474|
| I008 | 保存成功返回列表并刷新；失败保留填写内容；取消直接关闭，当前物品编辑没有独立脏表单离开确认/持久化草稿 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I009 | 购入关联只能是活跃非退款支出，售出关联只能是活跃非退款收入；选择已有账单不新增/修改账单；旧关联账单后来删掉不影响物品历史 |[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I010 | 关联选择器：按收支类型、每页 50，显示金额/日期/备注；单选选择、清除关联、取消；物品调用没传 onAuthExpired 回调，选择器局部可设置过期提示，但非登录 401 同时由 ApiClient 拦截器与 MainActivity 全局流程清会话并返回登录。选择器无点击跳到账单详情的回调 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt)、144 起；[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)、[MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt)|
| I011 | 物品详情重新 GET 数据及照片，照片框按原比例显示，区分无照片/照片已存但无法预览；可返回、重试加载、编辑 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)、582|
| I012 | 当前详情展示名称、状态、持有天数与日均成本；不完整展示 DTO 的品牌/型号/备注/购入日期/购入价/结束日期/售出价/净成本/买卖关联/创建更新时间 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I013 | 上传照片：系统 image/* picker、原字节与 provider MIME（缺省 JPEG）直接 PUT 后刷新；手机默认读取≤5 MiB；服务端仅接受 JPEG/PNG/WebP，≤2 MiB、签名及尺寸匹配、≤4000 万像素 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I014 | 一物品最多一张照片，上传替换当前照片；图片 BLOB 存数据库因此跟随整库备份；图片 GET 认证、no-store/nosniff |[item-service.ts](../../packages/server/src/services/item-service.ts)；[items.ts](../../packages/server/src/routes/items.ts)；[item-assets.md](../../.trellis/spec/backend/item-assets.md)|
| I015 | 删除照片确认弹窗；资料保留，图片从服务器移除；busy 时按钮阻止重复操作；失败显示错误 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I016 | 生成抠图候选需已保存照片且无现存 job；照片解码采样到至多约 1600 边，再压缩 WebP 质量 90 后 POST；生成不是识别物品名称/分类，也不会自动选择 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I017 | jobId 后每 1500ms 轮询；queued/running/ready/failed/cancelled；ready 下载每个 WebP 预览，显示候选；failed/cancelled 停止轮询 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-cutout-client.ts](../../packages/server/src/services/item-cutout-client.ts)|
| I018 | 点“使用此候选”下载透明 PNG → PUT 为照片 → 检查上传成功 → 刷新 → 清理 job；未成功上传保留原图。取消抠图 DELETE job，清空候选/预览、原图保留 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I019 | worker 服务可选；普通照片上传不依赖 worker。未配置 worker/未就绪/过载/超时/已过期任务会明确报错；候选是临时结果，离开页面不保存 jobId，未实现离开时自动取消 |[item-cutout-client.ts](../../packages/server/src/services/item-cutout-client.ts)；[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I020 | worker 默认输入≤2 MiB、源≤4000万像素、归一化边长≤1600、≤8候选、≤2活跃job、≤3保留job、超时120s、结果TTL600s；串行 SAM2 推理、取消/清理临时文件；透明候选≤16 MiB，预览≤2 MiB |cutout [settings.py](../../packages/cutout/app/settings.py)；[jobs.py](../../packages/cutout/app/jobs.py)、207–223；[engine.py](../../packages/cutout/app/engine.py)|
| I021 | “结束持有”：确认框填写结束日期，调用 retire；“售出物品”：结束日期、非负卖出价（元，UI 必填）、可选关联收入；终止前提 active/idle，结束日期不早于购入且不晚于今天 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I022 | “删除物品”确认后软删除，仅物品不删除账单；物品不会出现在账单回收站，也没有客户端恢复物品功能 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)；[trash.ts](../../packages/server/src/routes/trash.ts)|
| I023 | 服务端持有天数为本地日期差≥0；日均成本=四舍五入(净成本/天数)，同日或未知净成本为 null；active/idle/retired 净成本=购入价；sold 净成本=购入价−售出价，可负 |[item-service.ts](../../packages/server/src/services/item-service.ts)|
| I024 | 服务端 currentDailyCost 只加 active/idle 的有效日均成本；累计购入总额加所有未删除且已知购入价。概要还返回总数及4状态数量，Android 未展示这些数量 |[item-service.ts](../../packages/server/src/services/item-service.ts)；[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)|
| I025 | 编辑 sold/retired 并选 active/idle 可重新打开，服务端清空结束日期、售出价、售出关联；直接 PATCH 到新的 sold/retired 状态禁止，必须生命周期端点 |[ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt)；[item-service.ts](../../packages/server/src/services/item-service.ts)|

### 5.3 T：账户间转账与账单回收站

入口：我的 → 转账、我的 → 回收站。转账是独立表，只改变两个账户之间的资金位置，不计入收入、支出或预算。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| T001 | 转账列表每页 50、总数/页码/上一页下一页/刷新/重试/空状态 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)|
| T002 | 行展示备注（空有占位）、账户名称方向、日期与元金额；账户名读取失败显示信息不可用，已删除账户显示已删除；不会把 ID 直接当名称 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)|
| T003 | 新建/编辑：转出账户、转入账户、金额（元）、日期 YYYY-MM-DD、备注；账户菜单来自账户 API；交换方向按钮；保存/取消 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)|
| T004 | 客户端金额>0、账户非空且不同、日期可解析；服务端金额为正 safe integer 分，账户存在未删除，日期≥2000-01-01 且≤now+1日缓冲；备注必须文本 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transfer-service.ts](../../packages/server/src/services/transfer-service.ts)|
| T005 | 编辑更改金额/日期/备注或账户，POST/PATCH 成功返回列表刷新；失败保留编辑。转账编辑未实现脏表单离开确认 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)|
| T006 | 转账删除需确认“转账没有回收站”，API 实为软删除；两边余额依据 live transfers 重算，因此撤销转账对余额的影响；无恢复转账端点 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transfer-service.ts](../../packages/server/src/services/transfer-service.ts)|
| T007 | 服务端支持按 accountId 过滤及 GET 单条详情，客户端未提供账户过滤/独立转账详情；分页 API 默认50、最大500 |[transfers.ts](../../packages/server/src/routes/transfers.ts)；[transfer-service.ts](../../packages/server/src/services/transfer-service.ts)|
| T008 | 回收站只显示服务端返回的软删除账单，不含工资、规则、转账、物品；每行显示备注、日期、金额 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[trash.ts](../../packages/server/src/routes/trash.ts)|
| T009 | 单项恢复直接 POST，无确认框；恢复幂等，已恢复返回同账单，删除不存在则404；成功重新 GET 回收站 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| T010 | 单项“永久删除”需要确认；只允许已软删除账单，删 live账单409；永久删除前清除该账单参与的退款关联，不可恢复 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| T011 | “全部恢复”确认后 restore-all，作用于所有已删账单而不只是目前显示行；服务端返回 restored/remaining，UI 只刷新列表 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| T012 | “彻底清空”确认后 DELETE /trash，作用于全库软删除账单，先删相关退款链接；服务端返回purged/remaining，UI只刷新列表 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)|
| T013 | 回收站加载、错误、busy禁用按钮；初次加载后无专门手动刷新/重试按钮，无显式空状态文案；listTrash不接受筛选/分页参数 |[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)；[LedgerRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt)|
| T014 | 回收站按删除更新时刻降序，最多返回500条；total为全库删除数，但 Android 忽略total、没有分页，批量确认文案可能误称“所列账单” |[transaction-service.ts](../../packages/server/src/services/transaction-service.ts)；[TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt)|

### 5.4 R：周期规则、生成与待确认

入口：我的 → 管理周期规则；我的 → 待确认周期账单，首页也能打开待确认。规则不直接自动记账，不是后台闹钟/通知/定时服务；实际由客户端显式请求生成，再逐笔确认。

| ID | 当前实际功能、字段或约束 | 证据 |
|---|---|---|
| R001 | 规则列表读取规则+收入/支出分类+账户，展示名称、收支类型、金额、频率/锚点、分类/账户、启用状态；刷新保留旧数据并提示更新失败 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)、362–435|
| R002 | 新建/编辑：规则名称、支出/收入、元金额、对应类型分类、账户、daily/weekly/monthly/quarterly/yearly、锚点日期；新建默认支出/每月/今天 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)|
| R003 | 切换收入/支出清除旧分类；分类/账户下拉，无有效选项时提示不可保存；锚点用日期选择器，不允许直接文字编辑 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)、765–776|
| R004 | 客户端名称非空≤60、金额有效>0、分类/账户已选、日期可解析；服务端创建同类型可用分类/账户校验，锚点≤now+1日缓冲并规范到本地日期，金额正整数分 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R005 | 保存返回列表；失败保留填写；明确 4xx 允许修正重试，5xx/通用网络异常等不明确结果禁用再次保存，先返回列表刷新核对。UI 虽有 OfflineException 的未提交可重试分支，但 ApiClient 未实现网络预检或抛出该类型，不能保证断网实际进入此分支。脏表单系统 Back/内部取消需“放弃修改/继续编辑”；MyTab 外层顶部“返回我的”直接关闭子页，可绕过该确认 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)、779–796；[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt) closeSection/顶部返回；[ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt)|
| R006 | 启用/停用只能在服务端确认后更新开关；操作失败保持旧状态并暂停相关操作直到刷新；减少动态模式使用文字启用/停用按钮 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)|
| R007 | 服务端新建默认 enabled=true；重新启用重置游标到今天之后的下一到期日，停用期间历史不会补齐；现有 pending没有因停用自动删除 |[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R008 | 删除规则需确认，软删除规则及其未处理 pending；已确认账单、已确认/忽略 occurrence历史保留；删除结果不确定需刷新核对后操作 |[RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R009 | 修改锚点会重置下一发生日期游标；已生成 pending 是当时类型/金额/分类/账户/名称的快照，不随未来规则编辑自动覆盖 |[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R010 | 打开待确认、刷新与已处理后先 POST generate，再 GET pending；生成幂等按(ruleId, plannedDate)去重，第一到期日为锚点，生成至服务端今天 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R011 | 超期只保留每条规则最近12个到期周期；更旧周期丢弃，hasOlderDue/truncated提示；游标推进到今天之后，反复刷新不会继续补旧周期 |[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)、414–420|
| R012 | 待确认列表 oldest first、不分页、不筛选；每项备注（一般规则名）、收入/支出、计划日期、金额、分类与账户、待确认标签；服务端返回总项数 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)；[recurring.ts](../../packages/server/src/routes/recurring.ts)|
| R013 | 列表补充分类/账户名失败仍保留 pending，标记不可确认；分类/账户当前不可用时确认禁用，忽略仍可执行 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)、479–493|
| R014 | 单项确认先弹窗核对名字/金额/日期/分类/账户；确认入账按 occurrence快照创建账单，影响财务页；已确认重复请求返回created=false而不新增 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R015 | 单项忽略需确认；不生成账单、从待确认移除；重复忽略幂等；确认已忽略/忽略已确认均409 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|
| R016 | 操作不明确不先删列表，不重新提交；“刷新核对”只 GET pending，看目标是否已移除；确认的total重新GET前标为旧数，加载/生成/读取错误分开，保留旧内容 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)、279–331|
| R017 | 没有批量确认/批量忽略/确认时改金额日期/系统提醒/单条详情页；确认后只提示关联页面刷新更新 |[PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt)|
| R018 | API 可读取所有 occurrence（pending/confirmed/ignored）历史但客户端 repository/界面未调用；规则下一日期与 hasOlderDue 在 DTO中，不等于客户端完整历史管理 |[recurring.ts](../../packages/server/src/routes/recurring.ts)；[BudgetRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt)；[recurring-service.ts](../../packages/server/src/services/recurring-service.ts)|

### 5.5 API 对照表

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

<a id="assistant"></a>
## 6. AI 助理、Provider、30 个工具和接口

### 6.1 Android 可见功能（A001–A037）

本节受影响AI行为源码复核日期：2026-10-13；未推进其余功能的全局审计日期。

| ID | 功能与实际规则 | 证据文件:行 |
|---|---|---|
| A001 | AI 助手为底部一级聊天入口；会话管理、全屏导入、分类编辑及全屏二次确认隐藏底栏；聊天有 AI 接口设置入口（进入我的 Provider 页） |[MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、[MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt)|
| A002 | 显示 AI 尚未配置、已配置但关闭、已启用、读取失败；启用状态不等于连接已测试 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A003 | 读取服务器对话列表并默认选择首项；一级页只显示聊天、会话管理/新建入口；会话列表独立全屏；无消息欢迎的4快捷仅填草稿 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A004 | 新建对话，请求不带自定义标题；服务器返回 ID 后选中；列表重取 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A005 | 切换对话清空旧消息并重读；请求 generation + 当前对话 + 服务地址/当前 Compose 生命周期核对，拒绝同ID旧响应和 A→B→A旧快照；不能取消已发服务器写入 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、397–405|
| A006 | 刷新当前对话、列表加载失败重试、消息读取失败重试；保留服务器可重读数据 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A007 | 按对话保存文本、单附件、requestId 的易失内存草稿；全屏会话/导入/分类/确认均不卸载父聊天状态；不承诺跨Tab/进程恢复 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、137|
| A008 | 用户文本输入最多显示 4 行；无客户端长度阻止，服务端限制 2,000 字符 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant.ts](../../packages/server/src/routes/assistant.ts)|
| A009 | 文本非空或附有文件即可发送；发送中禁止该对话重复发送/改草稿/附件操作 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A010 | UUID clientRequestId 随相同草稿保留；编辑文本或更换附件会重置；服务端依请求 ID 去重 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant.ts](../../packages/server/src/routes/assistant.ts)|
| A011 | 等待完整响应，不模拟逐字输出；无 SSE/流式响应、无取消模型请求按钮 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A012 | 返回后安装服务器消息列表，清空成功草稿，刷新对话；失败保留草稿并提示先刷新核对 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A013 | 消息安装核对最新 generation 和当前目标；旧GET不会覆盖新发送/确认刷新；旧send成功仅清其原requestId草稿，不安装到别的对话；阅读旧内容有跳到最新 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A014 | 首次载入/位于底部时滚到底；手动跳到最新按减少动态状态决定滚动是否动画 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A015 | 系统选单附件并显示文件名/KB；上传完成核对picker generation、会话、草稿是否改变/是否发送或归档；取消不改草稿；字节不保存 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A016 | 客户端和服务端只接受非空CSV/XLSX、≤5MiB；微信XLSX/支付宝CSV由服务端解析；Android source固定auto；无来源选择UI |[DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt)；[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant.ts](../../packages/server/src/routes/assistant.ts)|
| A017 | 每次只附一个文件；无相机、照片、音频、PDF、通用文档 AI 分析入口 |AssistantComposerDraft；[assistant.ts](../../packages/server/src/routes/assistant.ts)|
| A018 | 消息区显示用户/助理/工具的内容，文本、progress、error、attachment、result、tool-card；文本按普通 Text 显示 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A019 | progress 显示服务器处理中/已完成，error 显示安全错误消息，附件显示文件名 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A020 | 结果卡显示服务端 summary 和最多 6 个白名单摘要字段，递归对象最多深度 2；金额格式化为元；不渲染任意 JSON |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A021 | 工具卡保留操作名/toolName/摘要/影响数/warnings；values与非导入preview可展开完整递归操作详情（含before/after与数组，排除秘密/附件摘要字段）；导入卡紧凑按钮打开全屏工作区 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A022 | 操作状态有 pending / confirmed / cancelled / expired，未知状态提示刷新；终态关闭执行按钮 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、1402–1409|
| A023 | 全屏二次核对所选收支合计、退款标签、每行现有分类与审核备注（空值明确）；返回不写账，0选择禁止确认。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A024 | 普通工具保持可选字段语义；平台导入始终传非空显式selectedIds（1–100），不会null/省略全文件；仅传所选行覆盖；未知结果提示并刷新，无自动重发，需显式刷新核对才重新开放确认 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A025 | 待确认操作可取消；请求中锁单个 action；失败刷新核对；对话发送/执行中禁止归档 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A026 | 全屏最多前200行预览，本地搜索/筛选；分别显示来源备注、审核备注、AI建议/理由、来源状态、退款提醒与硬阻断原因；未展示行不会导入。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A027 | 初始选择来自完成的AI建议，且仅硬规则允许行、最多100；AI失败初始不选。用户可逆转建议、手动选疑似重复；已存在/来源禁止/非正金额锁定。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A028 | 编辑页仅选择现有活跃同类型可记账分类ID（有子分类的支出父类不可选），不创建/恢复分类；独立审核备注≤200字符可明确清空，未编辑保留完整来源备注。缺分类必须用户处理。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A029 | 显式选择及发送覆盖最多100，预览200；审核草稿可保留当前预览内已编辑但未选中的分类，不静默丢弃后续编辑；上限、请求中及关闭操作有解释；0禁继续，缺分类禁继续；仅发送所选分类ID/备注覆盖。 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、876|
| A030 | 原件仍在进程需长度+SHA-256匹配本action才绑定/确认；上传晚结果检查当前pending卡，终态不复活；离开页面/进程丢附件重新选原件 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、858–873、1204–1222|
| A031 | 原件不一致不执行；可重新核对原文件；操作终态后清理本地行选择/附件/分类覆盖 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A032 | 归档有二次确认，说明无恢复列表、清草稿、不删除账本；成功移出列表选下一对话 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A033 | 对话存储服务端；全屏二级页保留父聊天易失草稿/附件，聊天内部切对话保留；切换底部Tab会卸载聊天，不承诺跨Tab/进程恢复 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A034 | 加载列表/消息、创建、归档、发送、action 执行都有各自 busy 状态与错误提示 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A035 | 当前有效请求AuthExpiredException回统一登录；生命周期/服务地址不同的晚完成不再回写UI；网络层已有401清Cookie机制本轮未改，不能声称解决晚401的新会话网络竞态 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)、266、289、328、764、888|
| A036 | 消息追加位置有 motion.quickMillis 动画；“跳到最新”适配 reduced；无动画模拟账务变化 |[AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt)|
| A037 | 归档会使服务端 pending actions expired；无归档列表、取消归档、删除单消息、编辑旧消息、重命名对话 API/UI |[assistant-conversation-service.ts](../../packages/server/src/services/assistant-conversation-service.ts)；[assistant.ts](../../packages/server/src/routes/assistant.ts):API 清单|

### 6.2 Provider 设置（A038–A062）

| ID | 选项 / 行为 | 证据文件:行 |
|---|---|---|
| A038 | 初始先加载保存配置；未成功加载时禁止保存空配置并给重试按钮 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A039 | 启用 AI 服务开关；关闭不调用模型；开关只在保存后改变服务端状态 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A040 | 三种模式：chat-completions / responses / custom；切换保留其他字段，不自动重写响应路径和模板 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A041 | 基础字段：配置名称、完整请求地址、模型名称 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A042 | 认证 none / bearer / header（自定义请求头） |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A043 | 新密钥为遮罩密码输入框、留空保留；已保存密钥只展示 hasSecret，不回显明文 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A044 | 已有密钥但认证改为 none 时仍保留密钥，提示当前不使用 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A045 | 清除已保存密钥必须弹窗；只先标记，保存后才清除；可撤销标记；输入新密钥取消清除标记 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A046 | 高级区可展开/收起，按统一 motion tokens 动画、减少动态无 transition |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A047 | HTTP 方法 GET / POST / PUT / PATCH；非 custom 启用时服务端要求 POST |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A048 | timeoutMs 默认 20,000，客户端和服务端校验整数 3,000–60,000 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)、510–515|
| A049 | 额外请求头 JSON 多行输入；本地必须能解析为 JSON 对象，服务端限制 20 个头、名称和字符串值，不允许敏感认证头 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A050 | 自定义 JSON bodyTemplate 多行；可引用 input/categories/accounts/model/today/responseSchema/facts，禁止 secret 和未知变量 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A051 | responsePath 可手填；非 custom 有“填入当前模式常用路径”按钮：Chat=choices[0].message.content，Responses=output_text |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt) responsePath 输入与 defaultResponsePath（652–656）|
| A052 | header 认证显示自定义认证头名称；客户端阻止空名称；服务端校验有效名称并禁 Cookie/Set-Cookie |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A053 | 保存按钮提交全部草稿和 clearSecret，secret 仅非空时发送；成功后清空本地 secret / 清除标记 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|
| A054 | 配置任意未保存变化或新密钥/清除标记存在则提示并禁“测试已保存配置” |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)、590|
| A055 | 测试只请求服务器已保存配置，不测试当前未保存草稿；有测试中/成功/失败反馈 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt)|
| A056 | 保存/测试互斥，过程中锁字段，失败保留当前可修改内容 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)、618–620|
| A057 | 不自动测试、不提供品牌 Provider 预设/URL 自动补全/模型列表下载；模式选择不是品牌预设 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt):完整表单；[AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt):实际 API|
| A058 | 当前 bodyTemplate 读取限制：后端非 custom 模式摘要返回 null；Android 不把不可读字段当清空，未编辑时省略保存该字段 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)、547–549；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A059 | 保存后 local 草稿作为 savedDraft；密钥保存在 Compose 普通内存，不写 rememberSaveable；没有离开页面未保存确认 |[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)；文件未使用 BackHandler|
| A060 | 服务端启用配置要求有效 URL/非空 model；生产 HTTPS、禁止 URL 用户密码；custom 非 GET 需要 JSON 模板，custom 需要响应路径 |[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A061 | 服务端 AES-256-GCM 保存密钥，随机 12 字节 IV；环境密钥为 64 hex=32 字节；保存/使用密钥需要环境密钥，环境密钥不存数据库 |[ai-crypto.ts](../../packages/server/src/services/ai-crypto.ts)；[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)|
| A062 | server config summary 还有 configured/encryptionKeyConfigured/updatedAt；Android provider 页面未展示 encryptionKeyConfigured 与更新时间，只使用 hasSecret 及表单字段 |[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)；[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)|

### 6.3 助理工具 30 项（A063–A092）

所有工具由后端白名单控制（assistant-tool-registry.ts:319–350），通过 Android 对话**间接**请求。读工具自动读；写工具只能生成待确认卡，确认后执行。工具 catalog 在服务器存在，Android 没有工具目录 UI。模型能否正确选中每个工具尚未真实 Provider 验证。以下每项为独立功能，勿把“可聊天”概括掉。

| ID | 工具 | 具体能力 / 限制 | 适配器源码行 |
|---|---|---|---|
| A063 | transactions.recent | 最近账单、类型或备注查询，默认 10 / 最多 50 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A064 | accounts.balances | 服务端账户余额 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A065 | budget.overview | 当前/指定 periodStart 的预算概览、模块、结余池 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A066 | stats.monthly | 1–12 个月月度收入与净支出趋势 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A067 | recurring.pending | 待确认周期账单，结果最多 100 项 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A068 | monthly.evaluate | 当前自然月评价：收入、净支出、分类、6 月趋势、当前预算事实；评价使用事实证据 ID |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)；[monthly-evaluation-service.ts](../../packages/server/src/services/monthly-evaluation-service.ts)|
| A069 | organization.preview | 预览安全分类/标签合并动作；语义交易重分类/分类建议仅建议；采样最多 200 笔 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)；[ai-organization-service.ts](../../packages/server/src/services/ai-organization-service.ts)|
| A070 | backups.list | 备份文件名列表，适配器未截断列表 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A071 | backup.export-links | 返回 transactions/salaries/recurring/transfers 四类相对 CSV 导出地址 /api/v1/export/{what}.csv |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A072 | transaction.create | 准备收入/支出、金额、日期、分类、账户、备注、tags、isRefund、refundLinkedTxIds 的新账单 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)；[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A073 | transaction.update | 指定账单 ID + changes；保留服务器校验、准备变更前后指纹 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A074 | transaction.delete | 将账单移入回收站 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A075 | transaction.restore | 从回收站恢复账单 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A076 | transfer.create | 创建指定转出/转入账户、金额、日期、备注的转账 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A077 | salary.create | 新建工资并生成预算分配快照；账户、日期、金额、备注、可选模板/分配 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A078 | category.create | 创建分类，name/type/icon/color/sortOrder/parentId |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A079 | category.update | 修改指定分类 changes |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A080 | category.delete | 分类软删除 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A081 | account.create | 创建账户、type、initialBalanceCents |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A082 | account.update | 修改指定账户 changes |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A083 | account.delete | 账户软删除 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A084 | budget.template.apply | 将指定模板应用到当前周期 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A085 | backup.create | 服务端创建数据库备份 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A086 | 平台账单确定性预览+配置Provider真实分析+人工审核；显式选择/分类ID/备注覆盖确认入账，原件摘要与当前账本/分类重验；事务/重复确认保护。 | 账单干跑预览；确认后按所选行/分类覆盖导入；原件摘要校验 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A087 | organization.apply | 准备应用指定 actionIds 或默认 ready 动作，重新取 previewHash；确认审计写入 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A088 | organization.undo | 根据 operationId 条件撤销审计操作；有后续变更则拒绝 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)；[ai-organization-service.ts](../../packages/server/src/services/ai-organization-service.ts)|
| A089 | recurring.confirm | 确认指定 occurrenceId |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A090 | recurring.ignore | 忽略指定 occurrenceId |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A091 | tag.rename | 指定 from/to 重命名标签，标签集合指纹防过期 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A092 | tag.delete | 指定 name 删除账单中的标签，指纹防过期 |[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|

助理没有：创建/编辑周期规则、删除转账、编辑/删除工资、编辑预算分配、模板 CRUD、物品/照片/抠图、设置主题/周期日、更改密码、备份恢复工具；这些只能走各自客户端功能或服务端管理途径。工具访问与 UI 是否有专门页面需要分开记录。

### 6.4 服务端流程与约束（A093–A100）

| ID | 能力 / 边界 | 证据 |
|---|---|---|
| A093 | 不含附件时模型最多 3 步工具调用；历史 context 最多 20 条（每条文本 2,000），input 最近 12 条；回复文本截断 4,000 |[assistant-orchestrator.ts](../../packages/server/src/services/assistant-orchestrator.ts)；[assistant-conversation-service.ts](../../packages/server/src/services/assistant-conversation-service.ts)|
| A094 | 附件先确定性提取事实，再调用已保存Provider分析前200行（每批25行），只接受已知行ID/理由/选入建议/现有同类型分类ID；没有工具执行或金额日期更改。失败明确显示且支持原件匹配的显式重试（新卡、重置旧草稿）；确认不调用AI。 |[assistant-orchestrator.ts](../../packages/server/src/services/assistant-orchestrator.ts)|
| A095 | 写操作预览记录参数、fingerprint、附件元信息；确认时重跑预览比较指纹、原件大小/hash； stale 被置 expired |[assistant-orchestrator.ts](../../packages/server/src/services/assistant-orchestrator.ts)；[assistant.ts](../../packages/server/src/routes/assistant.ts)|
| A096 | 确认操作同 action ID 的并发请求复用 Promise；写入 + 状态 + 消息在 SQLite 事务；已确认重复请求返回既有结果 |[assistant.ts](../../packages/server/src/routes/assistant.ts)；[assistant-orchestrator.ts](../../packages/server/src/services/assistant-orchestrator.ts)|
| A097 | 附件正文永不持久化；对话/消息/pending 卡持久化；归档为 archived=1，pending -> expired |[assistant.ts](../../packages/server/src/routes/assistant.ts):首行；[assistant-conversation-service.ts](../../packages/server/src/services/assistant-conversation-service.ts)|
| A098 | 确认路由、registry与严格导入服务共同限制显式非空1–100行及最多100覆盖；超限拒绝而非静默截断；只能选择前200预览行；未知执行结果须刷新核对。 |[assistant.ts](../../packages/server/src/routes/assistant.ts)；[assistant-tool-registry.ts](../../packages/server/src/services/assistant-tool-registry.ts)|
| A099 | Provider 自定义模板支持有限变量和点/数组下标响应路径；不运行 JS/任意代码；拒绝重定向、2 MiB 响应大小限制 |[ai-provider-service.ts](../../packages/server/src/services/ai-provider-service.ts)|
| A100 | Chat 模式固定 JSON object + temperature 0，Responses 模式固定 JSON object + temperature 0；测试只是成功调用并提取响应，并不验证正常记账完整草稿或所有工具 |[ai-provider-service.ts](../../packages/server/src/services/ai-provider-service.ts)；[ai-transaction-service.ts](../../packages/server/src/services/ai-transaction-service.ts)|

### 6.5 API 覆盖矩阵

| API | Android 实际入口 | 可用程度 |
|---|---|---|
| GET /assistant/tools | 无 Repository 方法/UI | 仅后端 catalog |
| GET /assistant/conversations | 对话列表 | 已接入 |
| POST /assistant/conversations | 新对话 | 已接入；不发送 title |
| GET /assistant/conversations/:id/messages | 切换/刷新 | 已接入；全量返回，无分页 |
| POST /assistant/conversations/:id/messages | 文本/账单附件发送 | 已接入；完整响应非流式 |
| DELETE /assistant/conversations/:id | 归档弹窗 | 已接入；无恢复 |
| POST /assistant/actions/:id/confirm | 卡片二次确认 | 已接入 |
| POST /assistant/actions/:id/analyse | 原件匹配后显式重试AI分析，生成新审核卡 | 源码接入，未设备/真实Provider验证 |
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
<a id="forms"></a>
## 7. 表单字段与操作速查

这是输入端速查表，详细校验、动作和限制见相应 ID。客户端校验与服务器最终校验分别列出，不能把“输入框接受”视为“必能保存”。本文覆盖全部实际表单，不新增设计字段。

| 表单 / 入口 | 全部可编辑字段 / 默认与选项 | 本地校验、动作及提交边界 |
|---|---|---|
| 登录 | 用户名、密码、密码可见切换 | 用户名trim，双方非空；提交禁重复；失败显示错误；无注册/找回 |
| 服务器地址 | origin地址；恢复默认 | http(s)，无凭据、非根路径、query/fragment；保存才生效；换地址清会话；无连接测试 |
| 外观 | 浅色/深色/系统；钛蓝/森林绿/黑白；减少动态开关 | 即时本地应用与持久化尝试，系统关闭动画会进一步限制 |
| 预算周期 | 自然月null或1–28日 | 草稿改变才保存，约束来自服务器；周期日≠统计自然月 |
| 修改密码 | 当前密码、新密码、确认新密码 | 当前/新非空、确认一致；服务器新密码≥8字符；成功所有会话作废 |
| 账单新建/编辑 | 收支类型、金额、日期、分类、账户、备注、标签、退款及关联账单 | 详见第4节；金额不是表达式计算器；选择器取消保留旧选择；正分金额服务器最终校验 |
| 工资新建/编辑 | 金额、到账日期、到账账户、备注；新建必选模板；分配编辑逐模块填写元金额（转换整数分） | 详见第4节；工资金额独立BigDecimal两位小数校验；原工资分配不要被金额编辑覆盖 |
| 分类 | 名称、新增时收入/支出类型、父分类、图标、颜色；编辑类型固定；上下排序是列表操作 | 父子类型与层级限制、排序/重命名/删除影响见第4节；不将Web字段猜成Android控件 |
| 账户 | 名称、账户类型、初始余额；上下排序是列表操作 | 完整字段和默认值见第4节；初始余额可为负，BigDecimal精确分校验 |
| 标签 | 原名称只读目标、新名称输入；删除确认 | 标签来自账单标签集合，非独立账户/分类；合并和影响范围见第4节 |
| 预算模板 | 模板名、模块、百分比；默认/应用操作 | 完整字段、总和容差、父子分类冲突见第4节；不是额度自定义输入 |
| 转账 | 转出账户、转入账户、方向交换、金额、日期、备注 | 必选两个不同账户，金额>0、日期有效；保存/取消；无脏草稿退出保护 |
| 本应用CSV导入 | 账单/转账类型、CSV文件 | 名称.csv、不空、手机≤10MiB、UTF8；确认直接上传，无dryRun；切类型清旧选择 |
| 平台账单导入 | 文件、逐行选择、逐行自由文本分类覆盖 | 手机≤5MiB，自动source；预览默认排除疑似重复等；确认所选；取消/关闭 |
| 立即备份 | 无文件路径/保留时长字段 | 后端创建数据库快照；不是导出到手机；只显示列表 |
| 物品创建/编辑 | 名称、分类、品牌、型号、备注、购入日期、可空购入价、支出关联、使用中/闲置 | 名称非空；价格空→null，非负；新物品分类空→其他；服务器字数/日期/关联限制见I007/I009 |
| 物品关联选择 | 账单单选、上一/下一页、清除、取消 | 每页50；买入支出、卖出收入；退款收入仍可能入选但最终会被拒；没有详情跳转 |
| 售出物品 | 结束日期、售出价、可选收入关联 | UI售出价必填非负，服务器可空；结束日期在购入日到今天之间；确认/取消 |
| 结束持有 | 结束日期 | 不早于购入不晚于今天；确认退役/取消 |
| 照片 / 抠图 | 系统图片文件、候选选择 | 无相机或裁剪表单；删除需确认；候选保存实际重新上传，失败保留原图 |
| 周期规则 | 名称、收入/支出、金额、分类、账户、五频率、锚点日期 | 默认支出/月/今天；名称1–60、金额>0；切类型清分类；日期选择器；不确定提交结果先核对 |
| 待确认 | 确认或忽略弹窗，字段只读 | 不能在确认时改金额/日期，不能批量确认；不可用引用禁确认，仍可忽略 |
| AI对话 | 文本、单个账单文件、移除附件 | 纯文本或附件其一即可，服务端文字≤2000；发送UUID去重；没有模型请求取消 |
| AI导入卡 | 行选择、现有分类ID、独立备注编辑/清空、同原件分析重试 | hash+长度匹配；200预览/100选择；AI建议可逆，失败非成功；缺分类先处理 |
| AI操作确认 | 只读摘要/影响数量/warnings及导入行选择 | 二次确认；取消；终态不可再执行；通用卡不展示所有嵌套数据 |
| AI Provider | enabled、mode、name、url、model、auth kind、secret、clearSecret、method、timeoutMs、headers、bodyTemplate、responsePath、headerName | 完整逐字段规则如下；保存/测试互斥，测试只针对已保存配置 |

### 7.1 Provider 逐字段规则

证据：[ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt)、[ai-config-service.ts](../../packages/server/src/services/ai-config-service.ts)。

| 字段 | 可用选项 / 规则 |
|---|---|
| enabled | 仅保存后修改服务器开关；关闭不调用模型，但助理附件走独立平台预览路径 |
| mode | chat-completions / responses / custom；切换保留当前编辑字段，不自动改请求路径/模板 |
| name | 配置名称，提交当前文本 |
| url | 完整请求URL；启用时服务器校验，生产HTTPS、无用户名密码 |
| model | 模型名；启用时不能空；无在线模型列表 |
| auth.kind | none / bearer / header；none不自动删除已有密钥 |
| secret | 遮罩输入；空表示保留，非空替换；未持久化在客户端 |
| clearSecret | 二次确认后只标记，保存才删除；可撤销，新密钥取消删除标记 |
| method | GET / POST / PUT / PATCH；启用非custom要求POST |
| timeoutMs | 默认20000；整数3000–60000 |
| headers | JSON对象；服务器最多20头、合法名称/字符串值、禁敏感认证头 |
| bodyTemplate | JSON模板，允许input/categories/accounts/model/today/responseSchema/facts；禁止secret/未知变量；custom非GET要求模板 |
| responsePath | 支持点路径/数组索引；custom要求填写；可按钮填Chat或Responses常用路径 |
| headerName | 只在header认证显示；不可空且服务器合法头名，禁止Cookie/Set-Cookie |
| hasSecret（只读） | 只知道有无密钥，不回显明文；其他encryptionKeyConfigured/updatedAt未显示 |

非custom模式的已保存bodyTemplate服务器返回null；未明确编辑时Android省略此字段以保留服务器值。认证保留bearer/header且启用时清密钥可能被服务器拒绝，不能把删除标记等同于成功清除。

<a id="accounting"></a>
## 8. 账务口径与数据边界

- **账单**是收入/支出；金额为正整数分。退款是收入退款（isRefund），不是新建负数支出；退款关联关系是另一份合同，不能靠同金额推断。
- **账户余额**由服务器基于初始余额、有效账单、工资及有效转账计算；余额是全历史口径，账单列表通常只看所选自然月，二者不能直接相减核对。
- **支出/预算/结转/工资分配**使用服务器/shared逻辑；现有API字段名netExpenseCents仍保留，但可执行函数按毛支出统计，退款计收入，不冲减预算；页面只格式化、画比例或显示服务器结果，不在客户端重新实现财务合计。具体工资/退款归属与周期规则见第4节。
- **工资**有独立记录和分配快照，不等同于普通收入列表项。新建/编辑/删除可能影响余额与预算，依服务器返回和刷新为准。
- **转账**只改变两个账户间资金位置，排除于收入、支出和预算；删转账撤销余额影响，但没有转账回收站。
- **物品**是资产资料与持有成本台账，不新增账单、不改变账户余额和预算。购入/售出关联只能链接既有合法账单；不是会计折旧。
- **导入**：本应用CSV未知主数据拒绝；独立数据管理平台导入仍会创建/恢复指定账户/必要分类；AI助理导入不创建/恢复分类，平台账户行为保留。原退款购买保留支出，独立实际退款流水作为退款收入，状态不生成流水或关联。稳定订单ID去重与疑似重复是两种判断。CSV不保存整库/全部退款关联。
- **周期生成**只生成待确认快照，确认才写账本。没有自动入账/通知服务；最近12次到期以外历史不会反复刷新补齐。
- **日期**传输为毫秒时间戳，设备输入/展示使用本地时区；服务器部署时区可以不同。统计自然月、预算周期和账户全历史是三个维度。
- **存储**：服务器保存账本、对话、照片和备份；手机持久化服务地址、Cookie、外观偏好。未发送表单/AI附件字节一般仅内存，无离线业务数据库或写入队列。

### 8.1 金额输入不是统一解析器

证据：[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt)、[SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt)、[ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt)。

普通账单/转账/物品等使用的元转分解析接受数值文本（可能包含指数），校验有限、非负与安全范围后Math.round到分；可接受超过2位小数并四舍五入，**没有金额表达式计算器**。工资有单独BigDecimal/最多两位小数正数正则校验；账户初始余额只要求BigDecimal精确整数分与安全范围，可接受1.2300、1E2、+1，不能概括为与工资相同的严格两位数字格式。README不将旧设计中的“表达式金额”写成已实现功能。

<a id="gaps"></a>
## 9. 已知问题与显示缺口

以下是当前代码事实或源码风险，不是已经修好的功能。后续修复必须更新对应功能行与这里的状态，不只改文案。全部待设备复现/验收。

### 9.1 平台、导航和账单细节

| 问题 | 当前事实 | 对应证据/影响 |
|---|---|---|
| 首页详情→编辑 | ~~缺口~~ 已修复（2026-10-10）：详情记录来源页并路由到账单编辑分支；设备回放仍待验收 | P022 / MainShell |
| 外层返回绕过表单保护 | MyTab顶部按钮直接closeSection，除工资外可移除页面；周期规则内部BackHandler/取消确认不覆盖这个按钮 | MyTab / RecurringRulesTab；不要宣称所有退出路径都保护草稿 |
| 详情分类/账户错误文案 | 元数据获取失败清空map，后续占位可能说“已删除”，即使是请求失败 | TransactionDetailScreen |
| 详情退款链接读失败 | 每个关联GET被runCatching吞掉，可能不完整显示关联，无独立读取失败提示 | TransactionDetailScreen |
| 关联选择器核对文案 | 文案提到详情核对，但行没有详情导航回调，只能选择/清除/取消 | LedgerLinkPicker |
| 日期输入宽度 | 禁宽松日期滚动并整段消费，未用正则强制yyyy-MM-dd各段固定宽度 | P034 / format |
| 外观保存异常 | 保存异常被吞，画面即时变化不保证下次启动仍保留 | P023 |
| reduced范围 | 自有MotionTokens为0，不代表所有Material内置动画统一关闭；十二原则无全量设备证据 | P026–P027 |
| HTTP地址与release | 校验接受HTTP，但release主Manifest不允许明文例外；Android9+连接可能失败 | P039 |

### 9.2 文件、物品、转账和周期


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


**平台文件新选择失败的边界：** DataTab平台面板先读取新文件才清旧状态；取消选择或真正新选文件读取失败（例如超过5MiB）都可能保留旧预览。该行为不同于本应用CSV先清旧文件再读取。没有“无效新文件一定清旧预览”的保证。

### 9.3 AI 助理和 Provider


1. **导入日期错配已源码修复**：本轮统一读取服务端 `dateLabel`，新增decoder单元测试；实际文件/设备日期展示尚待验证。
2. **结果/确认卡只有有限摘要**：safeSummaryFields 只允许列出的字段名、最多 6 项、深度 2；不遍历数组内容。monthly evaluation、organization actions/recommendations、balances/items 等复杂数据通常看不到完整细节。无专用月评/整理页，无 evidence 钻取，无导出链接点击/下载（`links` 字段未在白名单）。可请求工具不等于可完整核对结果。
3. **组织操作预览**：本轮通用卡和二次核对可展开values及非导入preview全部嵌套字段/数组，含before/after；仍是通用文本路径而非专用整理/evidence页，阅读及大型结果性能需设备验证。服务端未投影的信息不推测。
4. **导入范围有界**：AI助理展示/分析最多200行，确认显式1–100行，API超限拒绝；文件其余行不隐藏导入。重试生成新卡，会重置先前审核选择/分类/备注。真实Provider多批延迟/弱网仍待设备验证；独立DataTab合同未改。
5. **禁用状态仍可发送**：助理状态文案显示关闭，但发送按钮本身不以 enabled 锁定。纯文字请求会由服务器返回 AI_NOT_CONFIGURED 安全消息；有附件仍保留确定性预览，但AI分析显示失败，不伪装完成；可以手动审核或显式重试。
6. **没有自动刷新/轮询**：当前消息通过加载、发送返回、显式刷新或 action 后刷新；progress 本身不意味着后台实时推送。发送可阻塞等待最多多步模型调用。
7. **secret 清除生效条件**：认证保持 bearer/header 且 enabled=true 又清除密钥时后端会拒绝保存（AiSecretUnavailable）；应关闭 AI、改无认证或替换密钥后保存。UI 清除标记不是立即清除。
8. **配置切模式只保当前内存字段**：服务端非 custom 返回 bodyTemplate null。UI 小心省略不可读字段，但无法显示其真实内容；仅当前会话保留已编辑模板，重开不能回显隐藏模板。
9. **验证边界**：本轮AI界面已有源码实施及Gradle检查；未证明真实AI能发起全部30工具，也未验连接测试/真实附件写入/归档/HarmonyOS4/200%字体/键盘/读屏；构建不是设备验收。易失草稿不跨底部Tab；无服务端取消模型请求。

### 9.4 账务审计保留的缺口ID


- **L-GAP01：首页详情编辑路由**。首页recent打开详情时tab保持Dashboard；详情编辑回调只设editingTx并清viewingTx，编辑器仅在Tab.Transactions分支。按静态状态流，此路径会回首页同时editingTx导致底栏隐藏；尚未实机复现。证据 [MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt)、`:137`、`:152`。
- **L-GAP02：退款原支出反向明细缺失**。只读详情未读取后端refundSummary/refundDetails；退款关联行不可点击跳转。选择器文案提“详情跳转”并未对应这份详情实现。
- **L-GAP03：父分类仍可在账单编辑器选择**。分类picker未过滤有孩子的父分类；后端assertCategoryUsable拒绝父类记账。不能写“所有可选分类都能保存”。[TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt) / [transaction-service.ts](../../packages/server/src/services/transaction-service.ts)。
- **M-GAP01：默认模板删除按钮与服务端不匹配**。按钮可点，后端返回验证错误；应在功能文档记录“默认模板不可删，先切默认”。
- **B-GAP01：预算页待处理卡不是处理入口**；普通成功预算页面没有显式刷新按钮，需切页/切周期等触发重新加载。工资流程onSaved为空，直到退出流程回预算重新组合才更新预算。
- **B-GAP02：近30天上界取下月初**；指定月用服务器边界、其他统计窗口用设备边界，设备/服务端时区差异未验收。
- **S-GAP01：工资只列最近200笔，无分页；工资删除不进入交易回收站；新建工资没有幂等key，网络结果不明时不应宣称重试不会重复。**
- **L-GAP04：账单金额允许多余小数并四舍五入，与工资的最多两位小数正则、账户初始余额的精确整数分转换不同**；初始余额可接受指数或多余末尾零但拒绝非零厘精度。账单编辑/工资日期表单支持范围仍由服务端最终拒绝，DatePicker本身未限制2000..now+1天。
- **L-GAP05：详情关联读取的runCatching吞掉所有Exception**，其中可能包含AuthExpiredException与取消，局部无法区分失败原因。但 ApiClient 拦截器与 MainActivity 仍会处理任一非登录 HTTP401，不能据此断言关联阶段401缺少全局登录导航。这是局部静态错误边界，不是本轮改动。
- **L-GAP06：旧注释与现行函数冲突**。首页/图表用“净支出”文案，但退款已不冲减支出；shared/budget-engine开头、AccountFlow字段注释及旧frontend规范残留旧口径，功能README应明确实际运行函数。
- **L-GAP07：账单列表没有请求代次守卫**。月份/类型快速变更时LaunchedEffect会取消旧查询，但手动refresh与LaunchedEffect并发没有统一编号；不能从静态代码保证所有旧请求永不覆盖。StatsTab有requestId守卫，不能据此推及所有页面。
- **L-GAP08：年月只显示M月d日的交易详情/历史工资可能跨年不明确**；formatDay不含年，列表月份标题有年。该点属于展示事实，是否修改待UI方案。
<a id="absent"></a>
## 10. 没有接入或不存在的功能

| 分类 | 明确范围 |
|---|---|
| 无应用入口 | 注册/找回密码、多用户/共享账本、PIN/指纹锁、推送/Widget/后台自动记账、系统分享接收/URL深链、应用内更新/独立关于与帮助页、相机拍照 |
| 无离线能力 | 没有Room账本缓存、HTTP响应缓存、断网写队列/同步；requireOnline仅旧注释，实际没有统一网络监控预先禁写 |
| 非手机备份 | 无整库下载/客户端数据库恢复/删除备份/云盘自动备份；CLI恢复属服务器运维 |
| 仅服务端过滤/详情 | 转账accountId过滤与单条GET；物品category精确过滤；周期occurrence历史；回收站不能完整分页 |
| 导入不支持 | 工资/周期规则CSV导入、任意Excel通用表格、退款关联CSV还原；平台source手动选择在UI未暴露 |
| 物品没有 | 会计折旧参数、多照片、批量照片、独立物品回收站、终态独立编辑售价/结束日期/出售关联；抠图不会识别物品资料 |
| AI无独立界面 | /ai/transaction-draft（无直接调用）、完整月评、整理建议/审计历史/条件撤销列表；工具目录catalog界面 |
| AI无工具 | 周期规则CRUD、转账删除、工资编辑/删除、预算分配编辑、模板CRUD、物品/照片/抠图、周期日/主题/密码设置、备份恢复 |
| AI交互没有 | 流式文字/模型请求取消、归档恢复/单条消息删除/旧消息编辑/重命名、通用PDF/照片/音频多模态分析 |
| 平台边界 | Android APK目标含鸿蒙4待实测；本文不等同HarmonyOS5/6原生端交付；公网Web已退役 |

<a id="coverage"></a>
## 11. 源码和 API 覆盖

上面各域API表逐端点记录实际入口或仅服务端能力；主源码覆盖表用于防遗漏。不是把基础组件当成独立产品功能。


### 11.0 全部已注册服务端API（方法＋路径）

共**108项**：13个route文件107项，app.ts健康接口1项。除登录/健康等明确豁免路径，其余业务接口受会话认证保护，“API接口”不表示无认证公开访问。下表逐项登记，实际payload/字段/状态见各功能域API表；所有“直接UI/间接工具”均设备未验。

| 方法 | 完整路径 | Android接入状态 / 功能域 | 路由源码 |
|---|---|---|---|
| GET | `/api/v1/ai/config` | 直接UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| PUT | `/api/v1/ai/config` | 直接UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/test` | 直接UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/transaction-draft` | 仅服务端，无Android入口；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/monthly-evaluation` | 间接工具，无完整独立UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/organization-preview` | 间接工具，无完整独立UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/organization-apply` | 间接工具，无完整独立UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| POST | `/api/v1/ai/organization-undo` | 间接工具，无完整独立UI；AI设置/独立AI | [ai.ts](../../packages/server/src/routes/ai.ts) |
| GET | `/api/v1/assistant/tools` | 仅服务端，无Android入口；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| GET | `/api/v1/assistant/conversations` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| POST | `/api/v1/assistant/conversations` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| GET | `/api/v1/assistant/conversations/:id/messages` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| POST | `/api/v1/assistant/conversations/:id/messages` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| POST | `/api/v1/assistant/actions/:id/confirm` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| POST | `/api/v1/assistant/actions/:id/cancel` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| DELETE | `/api/v1/assistant/conversations/:id` | 直接UI；助理 | [assistant.ts](../../packages/server/src/routes/assistant.ts) |
| GET | `/api/v1/auth/me` | 直接UI；认证 | [auth.ts](../../packages/server/src/routes/auth.ts) |
| POST | `/api/v1/auth/login` | 直接UI；认证 | [auth.ts](../../packages/server/src/routes/auth.ts) |
| POST | `/api/v1/auth/logout` | 直接UI；认证 | [auth.ts](../../packages/server/src/routes/auth.ts) |
| POST | `/api/v1/auth/password` | 直接UI；认证 | [auth.ts](../../packages/server/src/routes/auth.ts) |
| GET | `/api/v1/budget/overview` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| GET | `/api/v1/budget/periods` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| GET | `/api/v1/salaries` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| GET | `/api/v1/salaries/:id` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| POST | `/api/v1/salaries` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| PATCH | `/api/v1/salaries/:id` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| PUT | `/api/v1/salaries/:id/allocations` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| DELETE | `/api/v1/salaries/:id` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| GET | `/api/v1/templates` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| POST | `/api/v1/templates` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| PATCH | `/api/v1/templates/:id` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| DELETE | `/api/v1/templates/:id` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| POST | `/api/v1/templates/:id/default` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| POST | `/api/v1/templates/:id/apply-current` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| GET | `/api/v1/settings` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| PUT | `/api/v1/settings` | 直接UI；工资/预算/模板/周期设置 | [budget.ts](../../packages/server/src/routes/budget.ts) |
| POST | `/api/v1/items/cutouts` | 直接UI；抠图 | [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) |
| GET | `/api/v1/items/cutouts/:jobId` | 直接UI；抠图 | [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) |
| DELETE | `/api/v1/items/cutouts/:jobId` | 直接UI；抠图 | [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) |
| GET | `/api/v1/items/cutouts/:jobId/candidates/:candidateId/preview` | 直接UI；抠图 | [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) |
| GET | `/api/v1/items/cutouts/:jobId/candidates/:candidateId/image` | 直接UI；抠图 | [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) |
| GET | `/api/v1/items` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| GET | `/api/v1/items/summary` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| GET | `/api/v1/items/:id` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| POST | `/api/v1/items` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| PATCH | `/api/v1/items/:id` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| DELETE | `/api/v1/items/:id` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| POST | `/api/v1/items/:id/sell` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| POST | `/api/v1/items/:id/retire` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| PUT | `/api/v1/items/:id/photo` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| GET | `/api/v1/items/:id/photo` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| DELETE | `/api/v1/items/:id/photo` | 直接UI；物品/照片 | [items.ts](../../packages/server/src/routes/items.ts) |
| GET | `/api/v1/categories` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| POST | `/api/v1/categories` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| PATCH | `/api/v1/categories/:id` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| DELETE | `/api/v1/categories/:id` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| POST | `/api/v1/categories/:id/move` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/accounts` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/accounts/balances` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| POST | `/api/v1/accounts` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| PATCH | `/api/v1/accounts/:id` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| DELETE | `/api/v1/accounts/:id` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| POST | `/api/v1/accounts/:id/move` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/tags` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| PATCH | `/api/v1/tags` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| DELETE | `/api/v1/tags/:id` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/categories/:id/usage` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/accounts/:id/usage` | 直接UI；主数据 | [master-data.ts](../../packages/server/src/routes/master-data.ts) |
| GET | `/api/v1/export/transactions.csv` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| GET | `/api/v1/export/salaries.csv` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| GET | `/api/v1/export/recurring.csv` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| GET | `/api/v1/export/transfers.csv` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| POST | `/api/v1/import/transactions` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| POST | `/api/v1/import/transfers` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| POST | `/api/v1/import/platform-bills` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| GET | `/api/v1/backups` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| POST | `/api/v1/backups` | 直接UI；文件/备份 | [portability.ts](../../packages/server/src/routes/portability.ts) |
| GET | `/api/v1/recurring/rules` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| POST | `/api/v1/recurring/rules` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| PATCH | `/api/v1/recurring/rules/:id` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| DELETE | `/api/v1/recurring/rules/:id` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| POST | `/api/v1/recurring/rules/:id/enabled` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| POST | `/api/v1/recurring/generate` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| GET | `/api/v1/recurring/occurrences` | 仅服务端，无Android入口；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| GET | `/api/v1/recurring/pending` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| POST | `/api/v1/recurring/occurrences/:id/confirm` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| POST | `/api/v1/recurring/occurrences/:id/ignore` | 直接UI；周期规则/待确认 | [recurring.ts](../../packages/server/src/routes/recurring.ts) |
| GET | `/api/v1/stats/category-share` | 直接UI；统计 | [stats.ts](../../packages/server/src/routes/stats.ts) |
| GET | `/api/v1/stats/monthly-trend` | 直接UI；统计 | [stats.ts](../../packages/server/src/routes/stats.ts) |
| GET | `/api/v1/stats/pool-trend` | 直接UI；统计 | [stats.ts](../../packages/server/src/routes/stats.ts) |
| GET | `/api/v1/stats/range` | 直接UI；统计 | [stats.ts](../../packages/server/src/routes/stats.ts) |
| GET | `/api/v1/stats/month-window` | 直接UI；统计 | [stats.ts](../../packages/server/src/routes/stats.ts) |
| GET | `/api/v1/transactions` | 直接UI；账单 | [transactions.ts](../../packages/server/src/routes/transactions.ts) |
| GET | `/api/v1/transactions/:id` | 直接UI；账单 | [transactions.ts](../../packages/server/src/routes/transactions.ts) |
| POST | `/api/v1/transactions` | 直接UI；账单 | [transactions.ts](../../packages/server/src/routes/transactions.ts) |
| PATCH | `/api/v1/transactions/:id` | 直接UI；账单 | [transactions.ts](../../packages/server/src/routes/transactions.ts) |
| DELETE | `/api/v1/transactions/:id` | 直接UI；账单 | [transactions.ts](../../packages/server/src/routes/transactions.ts) |
| GET | `/api/v1/transfers` | 直接UI；转账 | [transfers.ts](../../packages/server/src/routes/transfers.ts) |
| POST | `/api/v1/transfers` | 直接UI；转账 | [transfers.ts](../../packages/server/src/routes/transfers.ts) |
| GET | `/api/v1/transfers/:id` | 仅服务端，无Android入口；转账 | [transfers.ts](../../packages/server/src/routes/transfers.ts) |
| PATCH | `/api/v1/transfers/:id` | 直接UI；转账 | [transfers.ts](../../packages/server/src/routes/transfers.ts) |
| DELETE | `/api/v1/transfers/:id` | 直接UI；转账 | [transfers.ts](../../packages/server/src/routes/transfers.ts) |
| GET | `/api/v1/trash` | 直接UI；账单回收站 | [trash.ts](../../packages/server/src/routes/trash.ts) |
| POST | `/api/v1/trash/restore-all` | 直接UI；账单回收站 | [trash.ts](../../packages/server/src/routes/trash.ts) |
| POST | `/api/v1/trash/:id/restore` | 直接UI；账单回收站 | [trash.ts](../../packages/server/src/routes/trash.ts) |
| DELETE | `/api/v1/trash/:id` | 直接UI；账单回收站 | [trash.ts](../../packages/server/src/routes/trash.ts) |
| DELETE | `/api/v1/trash` | 直接UI；账单回收站 | [trash.ts](../../packages/server/src/routes/trash.ts) |
| GET | `/api/v1/health` | 仅服务端，无Android入口；平台健康 | [app.ts](../../packages/server/src/app.ts) |

### 11.1 全部 main Kotlin 文件

| main Kotlin 文件 | 核对覆盖 |
|---|---|
| [app/src/main/java/com/yansuu1/jizhang/MainActivity.kt](app/src/main/java/com/yansuu1/jizhang/MainActivity.kt) | 启动、会话、主题/配色/系统动态、全局401；§3 |
| [app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt](app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt) | URL、Cookie、认证、HTTP、下载/二进制、错误；§3 |
| [app/src/main/java/com/yansuu1/jizhang/repo/AdminRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AdminRepository.kt) | 分类/账户/标签管理；模板由 BudgetRepository 接入；§4 |
| [app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt) | 助理和Provider API；§6 |
| [app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt) | 登录/me/退出/改密；§3 |
| [app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt) | 工资/预算/模板/设置；同文件含RecurringRepository；§4/5 |
| [app/src/main/java/com/yansuu1/jizhang/repo/ItemPhotoUploader.kt](app/src/main/java/com/yansuu1/jizhang/repo/ItemPhotoUploader.kt) | 二进制照片上传封装（注释旧实现不能当事实）；§5 |
| [app/src/main/java/com/yansuu1/jizhang/repo/ItemRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/ItemRepository.kt) | 物品/照片/抠图API；§5 |
| [app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt) | 账单/退款关联/账户余额/统计/转账/回收站；§4/5 |
| [app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt](app/src/main/java/com/yansuu1/jizhang/repo/PortabilityRepository.kt) | CSV、平台文件、备份；§5 |
| [app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt) | 对话/附件/操作卡/平台导入卡；§6 |
| [app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/BudgetTab.kt) | 预算周期/模块概览/工资模板入口；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/Buttons.kt](app/src/main/java/com/yansuu1/jizhang/ui/Buttons.kt) | 共享主次按钮及按下动态；P027 |
| [app/src/main/java/com/yansuu1/jizhang/ui/Cards.kt](app/src/main/java/com/yansuu1/jizhang/ui/Cards.kt) | 共享卡片展示，不新增财务逻辑；§3/4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt](app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt) | 趋势/占比图与明细展示；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt) | 首页财务/预算/待确认/最近账单；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt) | 导出、导入、平台预览、备份；D001–D026 |
| [app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt](app/src/main/java/com/yansuu1/jizhang/ui/DocumentFiles.kt) | SAF名称/CSV校验/受限读取；D007/I013/A016 |
| [app/src/main/java/com/yansuu1/jizhang/ui/format.kt](app/src/main/java/com/yansuu1/jizhang/ui/format.kt) | 元/日期格式、非宽松日期解析；P034/P035 |
| [app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt) | 物品全部流程，SettingsFull/AppearanceSection；§3/5 |
| [app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt](app/src/main/java/com/yansuu1/jizhang/ui/LedgerLinkPicker.kt) | 退款/物品关联账单选择；§4/5 |
| [app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt) | 冷启动登录/服务器页；P005–P011 |
| [app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt](app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt) | 4+1导航/全屏动作/来源返回/P022修复；P017–P022 |
| [app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/ManageTab.kt) | 分类/账户/标签，TemplatesTab；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/MotionTokens.kt](app/src/main/java/com/yansuu1/jizhang/ui/MotionTokens.kt) | 动态参数/reduced策略；P025–P027 |
| [app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt) | 二级导航和外观持久化辅助；P019–P024 |
| [app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/PendingTab.kt) | 生成/待确认/核对/确认忽略；R010–R018 |
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt) | AI导入有界解码/选择/筛选/request gate；A005/A026–A029 |
| [app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt](app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt) | 全屏导入/分类/确认、操作详情与附件限制；A016/A021/A023/A026–A030 |
| [app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt](app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt) | Provider草稿/保存/测试/密钥；A038–A062 |
| [app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/RecurringRulesTab.kt) | 规则CRUD启停及脏草稿/结果核对；R001–R009 |
| [app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt) | 工资历史/表单/分配；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/SettingsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/SettingsTab.kt) | 我的退出辅助；P033 |
| [app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt) | 自然月趋势/分类统计；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/theme/JizhangTheme.kt](app/src/main/java/com/yansuu1/jizhang/ui/theme/JizhangTheme.kt) | 配色/财务语义/主题Token；P024 |
| [app/src/main/java/com/yansuu1/jizhang/ui/ThemePrefs.kt](app/src/main/java/com/yansuu1/jizhang/ui/ThemePrefs.kt) | 主题/配色/减少动态本地偏好；P023–P026 |
| [app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt) | 只读详情/退款关联/编辑入口；§4/9 |
| [app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt) | 新建编辑/字段校验/退款选择；§4/7 |
| [app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt) | 月度列表/筛选/分页/删除/详情；§4 |
| [app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt](app/src/main/java/com/yansuu1/jizhang/ui/TransfersTrashTabs.kt) | 转账和回收站；T001–T014 |

### 11.2 全部服务端 route 文件

实际为**13个route .ts文件**；health和API-only未匹配路由处理注册于app.ts，另外列出。

| route 文件 | 覆盖域和状态 |
|---|---|
| [ai.ts](../../packages/server/src/routes/ai.ts) | Provider GET/PUT config、test；独立draft/month评/整理preview/apply/undo；§6（标记直连/间接/服务端） |
| [assistant.ts](../../packages/server/src/routes/assistant.ts) | tools、conversation/message、archive、action确认/取消；§6 |
| [auth.ts](../../packages/server/src/routes/auth.ts) | login/logout/me/password；§3 |
| [budget.ts](../../packages/server/src/routes/budget.ts) | 工资、分配、预算概览、模板、周期settings；§4/3 |
| [item-cutouts.ts](../../packages/server/src/routes/item-cutouts.ts) | 创建/状态/取消/候选预览与原图；§5 |
| [items.ts](../../packages/server/src/routes/items.ts) | 物品查询/概要/CRUD、售出/退役、照片；§5 |
| [master-data.ts](../../packages/server/src/routes/master-data.ts) | 分类/账户/标签、排序/删除影响；§4 |
| [portability.ts](../../packages/server/src/routes/portability.ts) | 4导出、2CSV导入、平台导入、备份list/create；§5 |
| [recurring.ts](../../packages/server/src/routes/recurring.ts) | 规则/启停/生成/待确认/历史/确认忽略；§5 |
| [stats.ts](../../packages/server/src/routes/stats.ts) | 自然月趋势、分类占比等统计；§4 |
| [transactions.ts](../../packages/server/src/routes/transactions.ts) | 账单列表与条数 total、单条/CRUD/退款关联；无独立财务汇总接口；§4 |
| [transfers.ts](../../packages/server/src/routes/transfers.ts) | 查询/单条/CRUD；§5 |
| [trash.ts](../../packages/server/src/routes/trash.ts) | 软删账单list/restore/purge/bulk；§5 |
| [app.ts](../../packages/server/src/app.ts) | GET /api/v1/health（仅服务端，无登录连通性测试按钮）；API注册、认证及8MiB bodyLimit；非API路径JSON404，§3/9 |

### 11.3 其他已核对来源

- [app/build.gradle.kts](app/build.gradle.kts)：SDK/版本/签名；[main Manifest](app/src/main/AndroidManifest.xml)：权限/备份/入口。
- [debug Manifest](app/src/debug/AndroidManifest.xml)、[DemoActivity.kt](app/src/debug/java/com/yansuu1/jizhang/DemoActivity.kt)：仅debug预览，非正常用户入口。
- 后端services与shared规则是上述功能表中的验证依据；尤其CSV/平台解析、退款/余额/预算、AI指纹和物品生命周期不能只查Android文字。
- [cutout worker](../../packages/cutout/app/)：SAM2候选、容量/输入/任务TTL；其默认值不等于部署已启用。
- 审计原始材料：[平台](../../.trellis/tasks/10-10-android-ui-redesign/research/function-inventory-platform.md)、[账务](../../.trellis/tasks/10-10-android-ui-redesign/research/function-inventory-ledger.md)、[操作](../../.trellis/tasks/10-10-android-ui-redesign/research/function-inventory-operations.md)、[AI](../../.trellis/tasks/10-10-android-ui-redesign/research/function-inventory-assistant.md)。用户功能正文已直接收录本文，研究链接用于追踪依据，不代替正文。

<a id="maintenance"></a>
## 12. 维护流程、记录模板和变更日志

### 12.1 同批更新规则

1. 修改Android UI/Repository/网络/Manifest或相关API/service/shared parser时，先找受影响稳定ID。
2. 同批更新功能行为、所有表单字段/默认值/校验、入口/返回、状态/分页、限制、API和源码证据；有新增能力追加ID，不重排旧ID。
3. 接入原服务端能力时，把“仅服务端/间接工具”改为真实入口，并补UI调用证据；删功能保留原ID和“已移除（日期/原因）”，旧ID永不复用。
4. 修复缺口时同时修改正文和第9节，记录修复日期/源码事实；未设备验证不能写“实测通过”。
5. 修改文件限额要同时查手机读取、Fastify bodyLimit、路由/service、worker及Base64膨胀；修改删除/生成要查全库作用范围和确认文案。
6. 重新核查后才推进核对日期，并更新变更日志、主Kotlin/route覆盖表及下方条目数；维护触发来自代码变更，没有后台自动守护程序。
7. 交付前检查链接能解析、稳定ID唯一、全部main Kotlin/route有覆盖、设计与事实分开，设备/服务证据独立记录。

项目入口：[仓库README](../../README.md)、[客户端README](../README.md)；维护要求见[AGENTS.md](../../AGENTS.md)和[native-delivery规范](../../.trellis/spec/backend/native-delivery.md)。

### 12.2 新增或变更条目模板

| 项目 | 填写内容 |
|---|---|
| 稳定ID | 原ID或所属域下一个未使用序号 |
| 名称/状态 | 直接UI / 间接工具 / 仅服务端 / 已移除；是否源码缺口、设备未验 |
| 入口/返回 | 一级与二级入口、所有退出入口、保存成功去向 |
| 字段 | 名称、类型、默认、可空、选项、隐藏/只读条件 |
| 校验 | 本地与服务器分别记录，数字/日期/长度/引用及限额 |
| 动作/状态 | 读取/新增/编辑/删除/确认/取消/重试；busy、空、错、不确定结果 |
| 数据/API | 方法/路径/payload/返回；是否财务写入、全库/当前显示范围 |
| 限制/证据 | 源码链接、已知缺口、设备版本/步骤/结果（未测明确写未测） |
| 日期/日志 | 源码核对日期与运行验证日期分别记录，描述变化 |

### 12.3 变更日志

| 日期 | 变更 | 证据等级 |
|---|---|---|
| 2026-10-13（AI功能重设计） | A001/A003/A005/A007/A013/A015–A016/A021/A023–A030/A033/A035/A098：独立会话、紧凑卡、全屏导入/分类/二次核对；200展示/100显式选择/零禁确认；dateLabel、hash匹配、请求代次/上传晚完成隔离；既有Provider/工具合同保留 | 源码与7项新增helper测试；Gradle检查记录见任务ai-assistant-implementation-status.md；无设备/真实AI/生产写入证据 |
| 2026-10-10 | 首次全面盘点当前工作区；建立313个稳定功能ID、全部字段/操作/状态与限制、30个助理工具、API/源码覆盖、缺口和维护流程 | 静态源码核对；没有本轮设备/服务验收 |
| 2026-10-10（本轮 UI 重构） | 4+1 导航（AI 一级、预算/统计二级化）、P022 修复、钛蓝 Token 对齐（#3478F6 系）、首页问候 + Hero + 双快捷卡、账单搜索/筛选收纳 + 日期分组 + 服务端月度摘要、记一笔金额优先 + 分类网格 + 父分类拦截、AI 欢迎 4 快捷、预算/统计返回顶栏；`assembleDebug` / `testDebugUnitTest`（11/11）/ `lintDebug` 通过 | 源码编译验证；设备/深色/小屏/键盘/真实账务流程未验证 |

每次追加一行说明受影响ID、行为改变和核对来源。文档完成不表示现有UI改造已被用户接受，也不结束尚未完成的设备验收。

### 2026-10-13 AI聊天视觉修正 r2

按用户设备截图复核A003/A005/A007/A015–A016/A021/A035：顶部仅保留标题、带图标会话入口及更多菜单；新建、刷新、Provider移入菜单/会话管理。导入聊天卡压缩为摘要和主按钮，详细文件核对在全屏预览中处理。消息区域显式裁切并取消placement动效，避免移动时绘制遮挡；输入区独立Surface边界，附件按钮有强调背景和明确读屏标签。18单元测试、Lint、Debug/Release构建通过；截图所示重叠是否完全解决须r2设备复测，不以构建代替。

### Independent check follow-up
Pending refund statuses (退款中/退款处理中/待退款/退款审核中) remain blocked; mentioning “退款” is not completion evidence. Android category drafts are retained across selection changes within the bounded preview, analysis retry completion cannot close another action/conversation workspace, and failed refresh does not clear the uncertain-analysis gate. The blocked-row count follows hard eligibility rather than a removed generic status label. Independent reruns: shared 176 tests, server 489 tests, package build/lint/typecheck and Android unit/lint/debug build passed; these are mocked/build evidence, not device or live-provider acceptance.

### 2026-10-13 reviewed bill-import implementation
A023/A026–A030/A086/A094/A098 source rechecked for deterministic file facts, configured-provider advisory batches, reasons, refund facts, existing-category IDs and independent editable notes. Added `POST /assistant/actions/:id/analyse` with original digest validation. No feature ID recycled. Shared/server automated tests and Android unit/lint/debug build are separate evidence; no device, live Provider, production deployment or real ledger writes were performed. See `.trellis/tasks/10-13-wechat-import-review/implementation-status.md` for exact checks and remaining manual acceptance. The global audit date is unchanged.
