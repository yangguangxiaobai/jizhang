# Android UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按现有功能逐页重构 UI 与动效，保持账务与认证合同。

**Architecture:** 功能页面渐进拆分，共享组件/导航/MotionPolicy；Repository/API为数据来源。本次不执行步骤。

**Tech Stack:** 当前 Kotlin1.9.24、Compose BOM2024.06.00、JDK17、OkHttp/DataStore。

**Spec:** [完整 README](../../../clients/android/ui-redesign/README.md)，先读本任务PRD和设计§1–§9。

## Global Constraints

- minSdk26、compileSdk/targetSdk34，不顺带升级工具链。
- 默认 `https://jz.yansuu1.xyz`，保留Cookie/401/地址隔离。
- 整数分，退款为收入，余额/预算/成本/统计来自服务器。
- 全部功能/字段覆盖§2和S01–S48；密码/密钥/附件字节不持久化。
- 不动画计数金额，减少动态到确定终态，不修改生产数据。
- 当前只规划；后续明确实施指令与项目规划审核后才开始代码。

## Review Focus

1. 大字号/IME/小屏下保存栏与选择器可达：P1/P2设备验证。
2. 旧请求覆盖新记录/账号、超时重复写账：P1/P2状态与请求测试。
3. 退款/工资/转账口径或刷新改变：P2/P3/P4合同与隔离账本验证。
4. 关闭动画/连续打断留下透明内容或丢焦点：P1及各模块设备验证。
5. 文件MIME/原文件丢失、密钥语义/高级Provider丢字段：P4/P6流程测试。

## Staged checklist

详细页面、动作、状态与验收以README§5/§8/§9为准。按模块渐进完成，未开始项保持未勾选。

### P0 基线

- [ ] 固定当前APK入口、源码矩阵、截图和现有合同测试结果。
- [ ] 隔离测试账本准备退款、负余额、父子分类、工资、51条分页、物品状态。
- [ ] 对齐S01–S48并保存证据，不录入生产密钥/真实账单。

### P1 应用壳与组件

**Files:** `MainActivity.kt`、`ui/MainShell.kt`、`ui/MyTab.kt`、`ui/LoginScreen.kt`、`ui/ThemePrefs.kt`、`ui/theme/`；新建`ui/navigation/`、`ui/components/`、`ui/motion/`。

**Interfaces:** 类型明确的destination/来源/返回状态；集中MotionPolicy；金额组件只格式化整数分。共享签名在本阶段定义后供后续使用，不臆造Repository接口。

- [ ] 先建立来源/草稿/筛选恢复、编辑退出、减少动态终态测试，确认缺失行为时失败。
- [ ] 实现S01–S03/S23/S46、共享页面/表单/选择/错误/结果/确认组件与token。
- [ ] 跑现有网络合同与新增状态测试，验证冷启动/401/地址隔离。
- [ ] 100%/130%/200%字号、键盘、动画倍率0和读屏验收后评审。

### P2 首页与账单

**Files:** `DashboardTab.kt`、`TransactionsTab.kt`、`TransactionEditSheet.kt`、`LedgerLinkPicker.kt`，按`ui/feature/home/ledger/`拆分。

- [ ] 测选择器取消/筛选应用、晚响应、退款关系、超时核对而非自动重发。
- [ ] 实现S04–S10，保留表达式金额、标签、关联和全部payload字段。
- [ ] 隔离账本验证记账→预算/余额、51条分页、删除恢复和退款收入。
- [ ] 普通/减少动态、键盘返回与功能矩阵评审。

### P3 预算与周期统计

**Files:** `BudgetTab.kt`、`SalarySheet.kt`、`ManageTab.kt`中Templates、`RecurringRulesTab.kt`、`PendingTab.kt`、`StatsTab.kt`、`Charts.kt`、`ItemsTab.kt`中周期设置。

- [ ] 测历史周期、工资编辑不覆盖分配、100%/父子冲突、待确认成功才移除、图区间独立。
- [ ] 实现S11–S22/S47；预算模块仅展示overview实际字段；图表有明细。
- [ ] 验证工资到账/分配、默认与应用模板、五频率、起算1–28/null、负结转与零预算。
- [ ] 图形不改数字，M06/M07关闭仍完整；评审增量。

### P4 主数据与文件维护

**Files:** `ManageTab.kt`、`TransfersTrashTabs.kt`、`DataTab.kt`、`DocumentFiles.kt`，按功能拆分。

- [ ] 测负初始余额、分类原色、危险确认、无效新文件清旧选择、取消和preview绑定。
- [ ] 实现S24–S36；不假设回收站完整分页或备份恢复API。
- [ ] 验证排序/删除影响、转账51条、CSV round-trip、xlsx/GBK、部分结果和备份。
- [ ] 完成功能矩阵、读屏、键盘与减少动态评审。

### P5 物品与抠图

**Files:** `ItemsTab.kt`物品部分、`ItemRepository.kt`、`ItemPhotoUploader.kt`，新建`ui/feature/item/`。

- [ ] 测空价格/关联、售出方向、候选失败保留原图、取消轮询、上传成功但清理失败。
- [ ] 实现S37–S41，图片后台采样、透明候选预览、真实阶段状态。
- [ ] 实际服务验证ready/failed/cancelled/过期、大图内存、生命周期和51件分页。
- [ ] 验证M05/M11及弱网/重开，评审增量。

### P6 AI与账号

**Files:** `AssistantTab.kt`、`ProviderSettings.kt`、`ItemsTab.kt`中密码/设置、当前Assistant/AuthRepository。

- [ ] 测切对话晚响应、归档终态、工具卡重执行、附件丢失、密钥三语义与高级字段round-trip。
- [ ] 实现S42–S45/S48，共享导入预览但保留各自确认合同。
- [ ] 验证三Provider模式/四HTTP方法/认证/模板/responsePath/已保存配置测试、改密失效。
- [ ] 实际AI、读屏、弱网、取消/超时及减少动态验收评审。

### P7 集成与发布

- [ ] 按README§9记录48页、全部功能、输入与动作证据。
- [ ] 基准60Hz真机测帧与打断/倍率0；未测量不宣布达标。
- [ ] Android API26及鸿蒙4实际APK验证会话、账务、文件、照片和返回。
- [ ] 跑适用Gradle检查，记录APK/签名/升级说明；本任务不重新切服务。
- [ ] review通过后按既有流程提出具体Git计划，获授权再提交与记录结果。

## Commands

从根目录、配置JDK17/SDK后：

```powershell
Push-Location clients/android
./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease
# 实现仪器测试、依赖和隔离设备后再执行：
./gradlew.bat :app:connectedDebugAndroidTest
Pop-Location
```

期望全部适用检查成功并有设备证据；新增测试依赖协调当前BOM。仅本次文档不运行APK构建；未改API不重复后端全量检查。

## Rollback

模块验收前保留上一可用入口；回退该模块展示/状态，避免跨模块大重写。移除旧页面前逐行确认完整方案§2。动效性能不足改为即时终态。服务器/数据库不在UI回退范围。以上阶段全部尚未开始。
