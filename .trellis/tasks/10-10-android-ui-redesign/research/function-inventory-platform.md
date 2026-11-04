# 平台、会话、导航与设置功能盘点

核对日期：2026-10-10。依据当前工作区源码，含尚未提交的 UI 改动；没有安装设备或连接生产服务验证。本轮仅记录事实，不修复 UI。

## 源码范围

- `clients/android/app/src/main/java/com/yansuu1/jizhang/MainActivity.kt`
- `net/ApiClient.kt`、`repo/AuthRepository.kt`
- `ui/LoginScreen.kt`、`ui/MainShell.kt`、`ui/MyTab.kt`、`ui/SettingsTab.kt`
- `ui/ItemsTab.kt` 中 `SettingsFull` / `AppearanceSection`
- `ui/ThemePrefs.kt`、`ui/MotionTokens.kt`、`ui/theme/JizhangTheme.kt`
- `ui/Buttons.kt`、`ui/Cards.kt`、`ui/format.kt`
- `app/build.gradle.kts`、main/debug Manifest、debug `DemoActivity.kt`
- `packages/server/src/routes/auth.ts`、`services/password.ts`、`app.ts`。

## 功能清单

| ID | 功能与当前行为 | 主证据 |
|---|---|---|
| P001 | 原生 Kotlin/Compose 单 Activity APK；应用 ID `com.yansuu1.jizhang`，minSdk26、target/compile34；versionCode3，versionName读取根 package.json | build.gradle.kts |
| P002 | Android 和支持 APK 的鸿蒙4是交付目标；Android8/API26和鸿蒙4的本轮设备兼容性没有证据；Harmony5/6 ArkTS代码属另一客户端 | native-delivery.md、build.gradle.kts |
| P003 | 单用户自托管账本；无注册、多用户、找回密码、客户端 PIN/指纹锁 | LoginScreen.kt、auth.ts |
| P004 | 首次使用账号/密码由服务端 set-password CLI配置；客户端给文字指引 | LoginScreen.kt |
| P005 | 冷启动读取服务地址；有匹配会话才请求 auth/me，验证成功进入首页，期间显示检查状态 | MainActivity.kt、LoginScreen.kt |
| P006 | auth/me 请求有10秒 callTimeout，外层会话恢复12秒；失败保持登录界面，不凭旧用户名自动进入 | ApiClient.kt、LoginScreen.kt |
| P007 | 用户名和密码登录；用户名trim；非空校验；密码可显示/隐藏；提交期间禁登录按钮；错误文字反馈 | LoginScreen.kt |
| P008 | 默认服务器 `https://jz.yansuu1.xyz`；登录页显示当前地址，独立子页修改 | LoginScreen.kt、ApiClient.kt |
| P009 | 地址要求 http(s) origin：禁止用户名/密码、非根路径、query和fragment；可含端口；去尾斜杠；不添加/api/v1 | ApiClient.kt |
| P010 | “恢复默认地址”只先改编辑框；点击保存才持久化到DataStore；没有连通性测试按钮 | LoginScreen.kt |
| P011 | 改变服务器会清除旧Cookie；退出也清会话；用户名/密码没有保存到DataStore | ApiClient.kt、AuthRepository.kt |
| P012 | jizhang_session Cookie用SharedPreferences保存，匹配域/路径/过期/Secure，跨进程恢复；不是加密SharedPreferences。服务端SESSION_TTL_DAYS默认30、只接受正整数；登录创建固定到期时间，读取会话不续期；login/me返回expiresAt但Android只使用username，页面无到期时间/会话时长设置 | ApiClient.kt、config.ts、auth-service.ts、auth.ts |
| P013 | 除login外HTTP401触发全局sessionExpired并返回登录；登录失败仅显示凭据错误 | ApiClient.kt、MainActivity.kt |
| P014 | 请求统一添加变更头 `X-Requested-With: fetch`；空POST/PUT/PATCH无JSON Content-Type；API错误映射为status/code/message | ApiClient.kt |
| P015 | 普通HTTP连接15秒、读取90秒；无HTTP响应缓存/Room业务缓存/离线写队列/离线同步 | ApiClient.kt、build.gradle.kts |
| P016 | 注释提及requireOnline但实际没有该函数/网络监控实现；断网主要由请求失败提示，不能宣称统一预先禁用写入 | ApiClient.kt、全main源码rg核查 |
| P017 | 六个底部入口：首页/账单/预算/记一笔/统计/我的；记一笔是全屏动作，保存或取消返回来源 | MainShell.kt |
| P018 | 账单详情/新建/编辑、工资、待确认及“我的”二级页隐藏底栏；页面状态主要remember，非Navigation深链/持久化页栈 | MainShell.kt、MyTab.kt |
| P019 | 首页可跳全部账单、新账单、最近账单详情、待确认；预算跳工资和模板；“我的”12个功能入口 | MainShell.kt、MyTab.kt |
| P020 | “我的”三组：工资/分类账户标签/模板/周期/待确认/转账/回收站；AI助理/AI设置/物品；数据/设置；另有退出登录 | MyTab.kt |
| P021 | 子页顶部/系统返回；工资内部处理未保存退出；不是所有表单都有脏草稿确认，不能将规划规则当全部实现 | MyTab.kt、各表单源码 |
| P022 | 当前首页账单详情点编辑只设editingTx而未切Tab.Transactions，编辑页只在账单tab渲染，存在导航缺口；列表来源路径正常 | MainShell.kt |
| P023 | 浅色/深色/跟随系统三主题，即时切换，本地持久化；读取异常回系统默认；保存异常被吞，可能重启不保留 | MainActivity.kt、MyTab.kt |
| P024 | 钛蓝/森林绿/极简黑白三配色，即时切换，有外观预览卡；财务语义配色保持独立 | ItemsTab.kt、JizhangTheme.kt |
| P025 | “减少动态效果”本地开关；与系统ValueAnimator.areAnimatorsEnabled()的关闭结果取OR；onResume刷新系统开关 | MainActivity.kt、ThemePrefs.kt |
| P026 | MotionTokens默认press90/quick140/base220/slow320/stagger24毫秒，reduced全0；并非所有Material内置动画被统一控制 | MotionTokens.kt、Buttons.kt |
| P027 | 共享主/次按钮按下缩放0.98；减少动态不缩放；多页列表/展开/图表消费tokens；设计十二原则不是已全部验收的运行能力 | Buttons.kt、各ui源码 |
| P028 | 设置显示服务器当前周期：null自然月或每月1–28日；自然月与1日区分；读取min/max约束网格，失败重试 | ItemsTab.kt SettingsFull |
| P029 | 选择新起算日仅为草稿，改变后才可保存；读取失败不保存；保存确认服务端返回后显示成功，无金额本地重算 | ItemsTab.kt、BudgetRepository.kt |
| P030 | 修改密码输入当前/新/确认，遮罩，不用rememberSaveable；校验当前非空、新非空和两次一致；后端至少8字符 | ItemsTab.kt、auth.ts、password.ts |
| P031 | 改密成功后服务端所有会话作废，客户端清密码并退出；当前密码错误后端401也会触发会话清理 | AuthRepository.kt、ApiClient.kt、auth.ts |
| P032 | 设置只读AI配置状态：读取中/失败重试/未配置/已配置停用/启用；不显示明文密钥，也没有从这里直接跳AI设置按钮 | ItemsTab.kt SettingsFull |
| P033 | “我的”主页和设置页都可退出，网络注销失败也清本地Cookie并返回登录；主页不显示当前用户名 | SettingsTab.kt、AuthRepository.kt |
| P034 | 金额显示整数分转元两位小数；日期epoch ms按设备时区格式化；文本日期以yyyy-MM-dd解析，关闭宽松日历并要求全文消费，但没有固定补零位数的正则校验 | format.kt |
| P035 | 设备时区与部署Asia/Shanghai可能不同；不宣称所有客户端显示/输入日期统一服务端时区 | format.kt、部署合同 |
| P036 | 只声明INTERNET/ACCESS_NETWORK_STATE；无相机权限/通知权限/生物识别权限；主应用allowBackup=false | main Manifest |
| P037 | 系统选文件/创建文件入口，不是FileProvider分享；未发现推送、Widget、定时后台记账、系统分享接收、URL深链接入口 | Manifest、DocumentFiles.kt、DataTab.kt |
| P038 | debug DemoActivity为非exported预览入口，不属于正常应用功能；debug网络策略独立，release未声明明文HTTP允许 | debug Manifest、debug_network_security.xml |
| P039 | 设置地址校验能接受HTTP不等于release在Android9+允许明文连接；生产使用HTTPS，保留此区别 | ApiClient.kt、main/debug Manifest |
| P040 | 服务端只提供API；访问域名根不提供Web页面；本报告没有再次访问/部署服务器 | app.ts、native-delivery.md |
| P041 | 没有客户端数据库恢复、应用内更新/版本关于页、通用帮助页入口；release无本地正式签名材料时用debug签名 | MyTab.kt、build.gradle.kts |

## API覆盖

| API | 入口/状态 |
|---|---|
| GET /api/v1/auth/me | 冷启动会话恢复 |
| POST /api/v1/auth/login | 登录 |
| POST /api/v1/auth/logout | 两处退出与改密成功后的本地清理 |
| POST /api/v1/auth/password | 设置修改密码 |
| GET /api/v1/health | 后端存在；登录没有测试服务器按钮 |
| GET /api/v1/settings | 设置预算周期读取（委托BudgetRepository） |
| PUT /api/v1/settings | 设置预算周期保存，cycleStartDay为null或服务端允许的整数 |

## 维护交付约束

目标README为 `clients/android/README.md`，维护稳定功能ID、入口/字段/操作/状态/API/限制/源码证据；与 `ui-redesign/README.md` 设计文件分开，不用设计页编号冒充实现状态。每次功能相关代码修改，在同批次更新README受影响条目、已知缺口、API矩阵、核对日期、变更日志；删功能保留ID的已移除说明，不重编号。文档维护纳入项目spec，root/client README添加入口。维护是代码变更时的同步要求，不表示有已安装后台自动任务。
