# 首页设计（待批准）

## 数据流与边界
- 继续消费MetaRepository.balances()，解码为单个余额快照(total + items)；name/accountId/balanceCents均来自同一响应，不另加账户元数据依赖。
- 删除首页selectedMonthKey/showMonthMenu/availableMonths及历史选择逻辑；monthlyTrend(1)取服务端当前月结果，标签与数值一起发布，不根据设备日期猜测另一月。
- 余额请求有独立状态与加载子协程，不串在预算/分类后。余额区域置于不被主模块首次错误提前return遮蔽的位置；其余页面失败仍可呈现余额。
- 各流独立持有generation，刷新开始同步更新归属，成功/错误/finally均验证当前代次并正确传播CancellationException/401。

## 展示与刷新契约
总额+真实账户行采用可换行/纵向布局以适配多账户与长名；不要只截取两项。空账户列表有真实空态，未知/错误不能默认为0。隐私状态一次控制全部金额。加载保留上次数据必须标旧值，重试入口明确。

与[交互子任务](../10-22-android-recording-cards/design.md)共用Shell单调刷新事件：保留来源组合，保存成功触发当前页面读取，不以key重建整个Dashboard。取消/关闭卡片不刷新、不清滚动。

## 兼容与回滚
无API/schema变更，不复制shared账务公式。保留以前账户筛选代码及代次合同，功能目录仅更新复核条目。仅撤本子任务hunk，不用Git HEAD覆盖既有大幅脏改动。

## 验证边界
JVM helper/MockWebServer可验证实际解码、状态归属与请求参数；布局、隐私、长名及小屏由[设备清单](../10-22-android-brand-recording/device-checklist.md)验收。当前仅规划，未运行测试。
