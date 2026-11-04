# Android UI 重构设计

## Authoritative design

完整中文设计：[Android UI 重构 README](../../../clients/android/ui-redesign/README.md)。本文作为上下文入口，逐页正文不重复维护。

完整README超过单文件自动注入大小上限，JSONL只注入本入口。后续执行者须主动分段读取README的全局约束、所负责S页面、§6动效和§9验收，不可依赖自动注入的截断内容。

## Architecture and boundaries

保持 Kotlin/Compose、Repository 和 ApiClient 合同，按功能拆入 `ui/feature/`，共享页面壳、表单、选择器、状态和动效。不升级当前工具链，不重写数据层与预算引擎；优先类型明确的小型页面栈，不以新导航依赖作为前提。

保留六入口顺序，“记一笔”为全屏动作，取消/保存回来源。二级页隐藏底栏，统一系统/顶部返回、草稿与键盘。48个设计单元同时包含全屏页面、选择面板和独立流程，通用确认复用组件。

## Data flow and contracts

Repository响应 → 匹配账号/服务器/查询/记录ID → 展示状态 → Compose。原始数据、草稿、提交快照分开；成功触发失效与重取，动画不控制请求完成。旧响应不得覆盖新页面。文件预览绑定原文件；秘密与附件字节不进入持久化导航状态。

## Compatibility

Android API26和鸿蒙4 APK为目标，后者需实机证据。保留三主题/三配色、历史Cookie及高级Provider字段。减少动态是拟新增本地偏好，默认跟随系统；系统关闭动画直接终态。

当前后端不需数据库迁移。Web CSS/iPhone规范只参考，旧退款负支出口径不适用。回收站无完整分页、备份无恢复/下载接口时不承诺不存在的能力。继续 API-only Hosting。

## Tradeoffs / rollback

采用保留功能并重组页面方案，避免只换皮残留交互问题，也避免全重写造成口径漂移。按模块交付、验收后才移除对应旧入口；异常/性能问题可关闭动效而不影响确定终态。风险矩阵见完整方案§8.2。

## Status

用户已于 2026-10-10 明确批准基于此设计开始 UI 优化并允许并行子代理。首轮实施范围和实际进度记于任务 README 与 `delivery-status.md`；本阶段完成不等于 S01–S48 全部交付。
