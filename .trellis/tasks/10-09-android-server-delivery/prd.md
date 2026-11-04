# 安卓优先交付与 Caddy Docker 服务迁移

## Goal
取消 Web 产品形态，优先完成 Android 原生应用，将后端部署到现有服务器，通过 Caddy 和 https://jz.yansuu1.xyz 提供服务。

## Background
- 2026-10-09 用户授权创建任务；服务器当前是旧 Web Docker 版本。
- 最新确认域名 jz.yansuu1.xyz 覆盖旧任务“等待新域名”的假设。
- Android 已有 Kotlin + Compose 工程及 APK，但 clients/README.md 和验收记录仍有真机联调、功能口径待验事项。
- Dockerfile 当前构建 shared/web/server 并托管静态页面；docker-compose.yml 使用 /data 数据卷、127.0.0.1:8081 和私有抠图服务。服务器实际配置尚待核实。
- 后端 app.ts 承载独立 API 和可选静态托管；账本规则继续由 server/shared 维护。

## Requirements
- R1 分阶段取消 Web（2026-10-09 用户已确认）：首先停止网站上的 Web 服务，访问 jz.yansuu1.xyz 不进入 Web 页面；暂留源码核对安卓功能。安卓全量验收通过、必要合同与测试已迁移独立后，彻底删除 Web 源码及专用配置、依赖和文档引用。
- R2 优先完成 Android 全量功能：账单、预算、周期、统计、主数据、导入导出、AI、物品、主题；Android 与鸿蒙4共用 APK。
- R3 Android 默认 https://jz.yansuu1.xyz，保留自定义并记忆服务地址。
- R4 后端 Docker 独立于 Web，保持 API、鉴权及历史账本、照片、备份、必要密钥兼容。
- R5 复用现有 Caddy 终止 TLS，核实宿主机/容器运行方式，保持其它站点正常。
- R6 部署前备份并记录旧镜像、卷名和数据位置，准备迁移与回滚；不删除数据卷。
- R7 本轮优先 Android 与后端，保留 HarmonyOS 5/6 成果但暂不扩展。

## Task Map and Order
1. 10-09-retire-web：确认并落实取消范围。
2. 10-09-android-production-ready：现有工程修复、完整功能、本地验收；旧 10-06 Android 任务作参考，本轮不重复重写。
3. 10-09-api-docker-caddy：API-only 镜像、Caddy、数据迁移、部署与 APK 上线联调。
先明确 Web 范围，再优先 Android 完善与本地联调，随后服务器升级与真实域名联调；部署配置可提前研究。

## Acceptance Criteria
- [ ] AC1 生产镜像不发布 Web UI，源码处理符合确认范围。
- [ ] AC2 APK 登录、会话恢复、记账、预算变化通过，全量功能逐项记录证据。
- [ ] AC3 Android/鸿蒙4安装验证；无设备时明确待验，不宣称成功。
- [ ] AC4 域名 HTTPS 健康检查、鉴权及 APK API 调用成功。
- [ ] AC5 历史账本完整保留，备份恢复和回滚可复现。
- [ ] AC6 Android build/lint、服务端检查和相关合同测试通过，交付 APK 与部署文档。

## Out of Scope
不扩展 HarmonyOS 5/6，不重写账本算法，不增加多用户、系统推送或市场上架。

## Key Decisions
网站立即退出 Web 产品形态，源码仅作过渡参考；完整移除列为本轮最终交付，不无限期保留。

## Deferred Operational Inputs
服务器连接方式、Compose 项目/卷名、旧镜像、Caddy 运行方式/路径、备份空间、测试设备和签名配置待相应步骤核实；不记录密码或密钥。范围确认后补齐 design.md、implement.md 和上下文清单，再通过规划审阅开始实现。

