# Android Kotlin 纯原生重写

父任务：`10-06-harmony-android-adaptation`（需求总纲见父 PRD；本文件只写 Android 侧可独立验证的交付）。

## Goal

用 Kotlin 纯原生重写记账 App 全量功能（与 Web PWA 对齐），产出可在安卓主流版本 + 鸿蒙 4 安装运行的 APK。

## Requirements

- A1 网络层：baseURL 可配置（登录页填写+记忆，默认空首启必填）；OkHttp/CookieJar 持久化 `jizhang_session`；所有 mutating 请求带 `X-Requested-With: fetch`；无 body 的 POST 不带 `Content-Type: application/json`（否则服务端 400，见后端 spec recurring 注释）；401 回登录页；离线写操作明确报错。
- A2 鉴权：登录/登出/改密/会话检查（`auth/me|login|logout|password`），session TTL 30 天语义与 Web 一致。
- A3 账单：transactions CRUD + 按月筛选/搜索/标签；退款记收入勾选；转账独立表 CRUD（不计入收支）；回收站 restore/purge/restore-all/purge-all。
- A4 预算：overview（含 periodStart 历史回看）、periods、salaries CRUD、templates CRUD/set-default/apply-current、settings cycleStartDay。
- A5 周期账单：rules CRUD/enable、generate（显式 POST）、pending 列表、confirm（幂等）、ignore（已确认 409）。
- A6 统计：category-share / monthly-trend（含工资口径）/ pool-trend / range / month-window，原生图表绘制（环形+柱状+趋势）。
- A7 主数据：categories/accounts CRUD/move/usage、tags rename/remove。
- A8 数据：CSV 导出（下载）/导入（text/csv）、微信支付宝导入（选文件→读字节→`POST /import/platform-bills` dry-run 预览→勾选→categoryOverrides→确认导入；GBK/xlsx 字节原样上传）；备份列表/创建（恢复只给命令提示，不做恢复端点）。
- A9 AI 助理：conversations/messages（含附件 base64）、actions confirm/cancel（含 fileBase64/selectedIds/categoryOverrides）、archive；AI provider 配置/保存/测试。
- A10 物品资产：items CRUD/sell/retire/summary、照片上传/删除（jpeg/png/webp 原字节 PUT）、抠图 job 创建/查询/取消/候选预览+落图。
- A11 外观：深浅色三态（system/light/dark）+ 三套主色（钛蓝/森林绿/极简黑白），与 Web token 语义对齐。
- A12 导航：底部六 Tab（首页/账单/预算/记一笔/统计/我的）+ 子页面（工资/模板/周期/待确认/转账/回收站/数据/物品/设置/AI），路由名与 Web 对应。

## Constraints

- 禁止手写业务口径：所有金额/周期数字只呈现服务端返回值；cents↔元只做格式化；时区只做展示。
- 包名拟 `com.yansuu1.jizhang`；versionName 与仓库版本同源，versionCode 自增；签名用户本地保管。
- minSdk（在 design 中锁定，建议 26+ 覆盖主流机型）。

## Acceptance Criteria

- [ ] AC-A1 APK 在主流安卓版本 + 鸿蒙 4 可安装启动，登录页可填服务端地址并登录成功。
- [ ] AC-A2 登录→记一笔→预算已用变化链路可演示，数字与 Web 一致。
- [ ] AC-A3 R2 全量功能逐项可演示（A3–A12），无静默失败。
- [ ] AC-A4 lint/类型检查通过，可重复打 release 包。
