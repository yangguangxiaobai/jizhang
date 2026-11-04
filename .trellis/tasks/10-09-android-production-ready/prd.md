# Android 功能完善与 APK 验收

## Goal
完善现有 Kotlin + Compose 工程，优先交付实际可用的 Android/鸿蒙4 APK。

## Requirements
- 沿用 10-06-android-kotlin-native/prd.md A1–A12 全量功能合同；页面存在不等于验证通过。
- 审查会话恢复、Cookie、401、登出、地址切换、错误反馈、无 body POST 和文件上传下载。
- 默认 https://jz.yansuu1.xyz，保留自定义服务地址。
- 核对 API 字段、必填参数、导航及生产/演示入口，补齐功能遗漏。
- 预算与金额由后端计算，不复制业务规则。
- 交付可安装 APK、版本升级及签名说明，签名材料不入库。

## Acceptance Criteria
- [ ] 登录→记账→预算变化通过，重启恢复会话，过期回登录。
- [ ] 账单/预算/周期/统计/主数据/数据/AI/物品/外观逐项验证。
- [ ] Gradle build/lint 及关键合同检查通过。
- [ ] Android/鸿蒙4安装运行有证据或明确待验项。
- [ ] APK 可重复构建，部署后 HTTPS 联调通过。

## Dependencies
父任务范围确认后规划执行；上线联调依赖 10-09-api-docker-caddy；旧任务和 Web 为功能参考。
