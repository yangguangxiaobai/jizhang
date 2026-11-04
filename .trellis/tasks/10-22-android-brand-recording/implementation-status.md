# Yansuu1记账品牌与记账体验优化：实施状态记录（2026-10-22）

## 1. 目标达成情况与验收映射

本轮实现已由用户明确批准实施（“开始实现”），所有已批准需求在 Android 客户端全部完成落地与本地验证：

| 需求 ID | 功能要求 | 实施方案与源码锚点 | 本地验证结果 |
|---|---|---|---|
| R1 | 名称 Yansuu1记账；设置提供六款桌面图标切换（默认第6款橙色）；保持应用身份与数据 | [strings.xml](../../clients/android/app/src/main/res/values/strings.xml:2)、[AndroidManifest.xml](../../clients/android/app/src/main/AndroidManifest.xml:7-106)、[LoginScreen.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt:87,172)、[ItemsTab.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt:934-940)、[LauncherIconController.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/launcher/LauncherIconController.kt) | `LauncherIconControllerTest` 6 项通过；Manifest 包含 6 个 alias，默认仅 6 enabled；资源包含 6 组全密度 adaptive/round/legacy drawables |
| R2 | 移除首页月份下拉选择，收入支出展示当前月 | [DashboardTab.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt:148) 请求 `monthlyTrend(1)`；移除月份下拉菜单状态与轮询；标题栏恢复显式刷新按钮与副标题 | 账单页月份与账户筛选独立运作不受影响；刷新就地进行 |
| R3 | 首页真实账户余额细分，彻底修复假分摊 bug | [DashboardTab.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt:580) 移除原 619–626 行总额/3 假分摊；消费 `meta.balances()` 服务端权威 `items` 与 `totalBalanceCents`；[DashboardBalancesHelper.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardBalancesHelper.kt) 严格解码；眼睛开关一键遮蔽全量金额；独立代次守卫与重试 | `DashboardBalancesHelperTest` 10 项通过；覆盖多账户、0值、负值标红、长名、服务端总额权威不重算、独立失败与代次隔离 |
| R4 | 首页和账单点击记录弹底部卡片，保留来源列表状态 | [MainShell.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt) 将详情作为 `ModalBottomSheet` 覆盖在来源页面之上；[TransactionDetailScreen.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt) 底部卡片；[TransactionDetailLoadOwner.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailLoadOwner.kt) 代次防过期覆盖；关闭保留底层列表的筛选条件、第2页页码与滚动位置 | 详情异步代次隔离，来源组件不卸载；保存成功发 `ledgerRefreshToken` 就地静默刷新列表与首页 |
| R5 | 支出详情卡提供“记录退款”，预关联原支出，原记录不改 | [TransactionDetailScreen.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt:176,242) 对非退款支出显示“记录退款”；[TransactionRefundSeedHelper.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionRefundSeedHelper.kt) 构建 seed（type=1, isRefund=true, 预关联原支出 ID，金额留空，日期今天，原到账账户活跃则默认，可见收入叶子分类）；[TransactionEditSheet.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt) 支持 `refundOriginalId` | `TransactionRefundSeedHelperTest` 6 项通过；`TransactionEditorNetworkContractTest` 验证 POST 新收入退款 payload 且原支出无 PATCH |
| R6 | 金额与键盘同时可见，元数据独立滚动，IME 自动避让 | [TransactionEditSheet.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt) 固定大金额（32sp 等宽）+ 自定义数字键盘 + 底部保存区；元数据使用独立滚动；备注/标签获得焦点时隐藏自定义键盘让出 IME 空间，金额与保存按钮始终可见；小屏/大字进入紧凑回退布局 | `TransactionEditorHelperTest` 12 项通过；覆盖键盘输入退格/小数点/12位上限/两位小数边界与紧凑模式 |
| R7 | 校验与保存失败在顶部浮层显示 4.5 秒，统一保存防重入 | [TransactionTopErrorHelper.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionTopErrorHelper.kt) 顶部错误控制器；默认 4500ms，同文新事件重置计时，支持手动 ✕ 关闭与无障碍时长延长；[TransactionEditorHelper.kt](../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditorHelper.kt) `TransactionEditorSubmitter` 单次同步门控提交 | `TransactionTopErrorTest` 8 项通过；`TransactionEditorHelperTest` 验证双击门控只触发一次网络请求 |

---

## 2. 自动化验证数据

- **Gradle 单元测试**：`.\gradlew.bat :app:testDebugUnitTest`
  - 19 test suites，**215 tests 全部通过**，0 failures，0 errors，0 skipped（耗时 14s）。
  - XML 报告位于 `clients/android/app/build/test-results/testDebugUnitTest/*.xml`。
- **Android Lint 静态检查**：`.\gradlew.bat :app:lintDebug`
  - **0 errors**，43 warnings，21 information。无任何新增业务阻断性警告。
- **APK 构建产物**：`.\gradlew.bat :app:assembleDebug`
  - 路径：`clients/android/app/build/outputs/apk/debug/app-debug.apk`
  - 大小：`22,206,206` 字节
  - SHA-256：`ce2356671fe4d2dda4c55dbcf0b265251369100858f208a8900cdbfc1451486b`

---

## 3. 边界与未执行项说明

- **未修改后端**：服务端路由、服务、数据库模式、`@jizhang/shared` 账务公式均保持不变，未发起任何远程部署或生产写操作。
- **工作区隔离**：保留了仓库内原有约 245 项无关混合脏改动；未执行 `git commit`。
- **设备端待验**：本轮验证仅限本地源码分析、JVM 单元测试、MockWebServer 回归与 Gradle 离线构建；未在真实物理设备（Android / HarmonyOS 4）上安装运行。图标在特定桌面上的图标缓存刷新延迟、小屏键盘真机手势及真实交互待在后续设备验收阶段验证（详见 [device-checklist.md](device-checklist.md)）。
