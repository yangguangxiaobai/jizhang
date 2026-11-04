# 首页执行清单（已完成实现，待父任务统一构建验收）

1. 最终方案获批后启动本子任务，读取native-delivery、共同研究、受影响功能目录和当前Dashboard；保存改动前基线，不重置混合工作区。
2. 定义实际生产使用的余额快照解码/状态helper (`DashboardBalancesHelper.kt`)，实现0/负/多账户解析、缺失非法字段严格抛错不伪0、服务端totalBalanceCents权威保留绝不客户端重算。
3. 将余额与其他首页模块请求及呈现分离，由 `DashboardBalancesCoordinator` 维护代次与取消保护，覆盖独立失败/重试/交错成功错误finally回归测试 (`DashboardBalancesHelperTest.kt`)。
4. 去除首页历史月份状态及下拉菜单，趋势请求固定为 `stats.monthlyTrend(1)` 当前服务端月；标题栏恢复明确显式刷新按钮与服务端月份副标题。
5. Hero资产卡改动态真实账户名/余额行，适配多项长名截断与隐私眼睛遮罩；首次加载/失败/空态/旧值刷新清楚区分。
6. 支持可选参数 `refreshToken: Long = 0L`，通过 `LaunchedEffect(refreshToken)` 驱动首页就地刷新，不重建组件与滚动。
7. 根据约束，未修改 `MainShell/TransactionsTab/editor/detail/brand/ItemsTab/README`；README目录由父任务统一合并更新；Gradle构建由父任务统一运行。

## 产出文件
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt`：首页重构，独立加载余额与主数据，移除月份下拉，加刷新入口与 refreshToken 支持
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardBalancesHelper.kt`：生产余额解码与代次状态协调器
- `clients/android/app/src/test/java/com/yansuu1/jizhang/ui/DashboardBalancesHelperTest.kt`：10项单元测试，覆盖解析、校验、隐私遮罩、代次隔离与独立失败模拟

