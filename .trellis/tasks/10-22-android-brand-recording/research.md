# 研究与来源（2026-10-22，仅规划）

## 证据范围与状态
直接读取本工作区源码、功能目录、spec与新旧任务产物，未改产品代码、运行构建/安装/部署/生产请求。get_goal返回null，无独立活动目标可套用。旧账户任务task.json仍in_progress且meta.validation_status=local_verified_device_not_verified；handoff称本地已完成，不将其写成已归档。新父任务task.json为planning，已挂三个子任务。本目录只保存规划证据。

## 源码锚点
| 事实 | 位置（仓库根相对路径与行号） | 设计影响 |
|---|---|---|
| 首页有12月趋势和月份菜单状态/选择 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt:106–151、279–324（后一段来源handoff） | 删首页选择与历史选择路径，固定本月；不改账单筛选 |
| 只保存服务端总额，底部伪造微信总额/3、银行卡余数 | 同上:178–180、619–626 | 需解析items与实际名称/余额，彻底移除分摊 |
| 余额读取串在趋势/列表/预算/分类后面 | 同上:110–126 | 设计独立余额请求/状态/代次，不被其他模块失败阻止；不能只加UI重试 |
| 服务端明确accountId/name/type/balanceCents与total字段 | packages/server/src/services/account-balance-service.ts:28–51、162–180（后段handoff） | 服务端金额权威；账户余额不是本月列表累加 |
| 原生已有余额入口 | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt:95–106 | 复用MetaRepository.balances，无新API |
| 原生新建reset固定支出，baseline在加载后建立 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt:155–216 | 增加显式退款seed，不让reset覆盖，不误判初始草稿脏 |
| 金额/键盘同处长滚动，保存重复，退款/错误靠后 | 同上:287–328、335、384–417、480–574 | 统一提交函数，金额固定/元数据滚动/键盘与保存紧凑区，顶部事件错误 |
| 详情整页，只有编辑入口 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt:105–206 | 内容复用到ModalBottomSheet，支出加退款入口 |
| Shell详情和编辑替换来源分支，编辑会切到账单Tab | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt:80–122、238–315 | 来源常驻、覆盖层分离；保存显式刷新 |
| 退款仅收入标记，校验关联但未限制退款总额≤支出 | packages/server/src/services/transaction-service.ts:9、486–509、585–625；clients/android/README.md:205 | 不发明退款第三类型/额外超额策略，不修改原支出 |
| Manifest单MainActivity入口、统一label/ic_launcher | clients/android/app/src/main/AndroidManifest.xml:7–20；clients/android/app/src/main/res/values/strings.xml:2 | 六个alias，MainActivity保留身份但不再单独LAUNCHER |
| 应用身份/SDK与签名debug fallback | clients/android/app/build.gradle.kts:43–53、68–83 | applicationId保留com.yansuu1.jizhang；覆盖兼容必须证书比较 |
| 设置真实分支位于SettingsFull | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ItemsTab.kt:821；MyTab.kt:134 | 在被消费的设置页加图标选择，不只改旧SettingsTab |

## 原附件顺序与校验
父代理已把附件规范化副本无图像编辑保存在assets下；1254×1254 PNG，**这些是附件复制/规范化结果，不宣称等于原始设计导出文件字节**。哈希来自父代理实际复制校验，本子代理未重新计算。第6张为用户确认的默认橙色。

| 序号 | 规范化附件副本 | SHA256 |
|---|---|---|
| 1 | assets/icon-1-source.png | b97b69a63055e95adbefa63e110f009e257b793cadab82c6de04bd0d269c5f8c |
| 2 | assets/icon-2-source.png | 2aeca781c695090f1e86ce6b3bcd9e7048e88a688121d4aa717d483695a0336a |
| 3 | assets/icon-3-source.png | 167b2f09a9b3ff5599f4cb4e52ad28750ec943d51d2308c5138a83ff6bf82401 |
| 4 | assets/icon-4-source.png | cd0d6502c0225a5ea8f7eba0e9ce0294ef11b8d74214fb1b7deae755920ce2ea |
| 5 | assets/icon-5-source.png | bf8fa32e76d678f4341b266dbce19f0877a5cd75ab55ded83f3f03712cc2ac1a |
| 6 | assets/icon-6-source.png | 15779b85f739d8e8acd3c179c273ea70d495ad2ad2ea5b3f6174afd205bcf12f |

实施时原始来源应复制到永久App素材位置再生成各密度/圆形及adaptive资源，不能依赖可归档任务目录参与发布构建。保留图案颜色及顺序，裁切安全区需要预览与设备核验。

## 规范冲突与优先级
- clients/android/README.md是维护事实目录，ui-redesign仅设计。目录L04.10宣称底栏imePadding与当前源码漂移，本次必须核源码后修订，不能复制其描述当事实。
- .trellis/spec/frontend/index.md:3–4仍Vue/PWA且54–55退款口径过时；当前原生交付以native-delivery、实际server/shared执行和最新用户要求为准。不批量修改退休规范，不套用CSS/Pinia实现。
- native-delivery:148–201规定账户查询、代次、历史元数据独立失败及每页50条，本次覆盖层/刷新必须全部保留。
- 用户只显式确认六款切换/第6默认，其余UX/技术选择是本规划待整体批准项，不伪称逐项已确认。

## 现有验证入口（未执行）
既有ui/InputContractTest.kt、ui/TransactionAccountFilterTest.kt及net/NetworkContractTest.kt可复用测试约定。MockWebServer/JUnit已在app Gradle依赖；Compose androidTest BOM存在不等于完整设备测试设施已具备。后续执行testDebugUnitTest/assembleDebug/lintDebug；小屏IME、Launcher缓存/固定快捷方式、覆盖升级与鸿蒙4必须单独记录设备证据。
