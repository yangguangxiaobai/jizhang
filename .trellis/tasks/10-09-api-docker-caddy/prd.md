# Docker 后端与 Caddy 迁移部署

## Goal
部署原生应用配套后端，复用现有服务器的 Caddy 与 jz.yansuu1.xyz，并保留旧账本。

## Requirements
- API-only Docker/Compose，保留健康检查、时区、非 root 运行与持久化。
- 核实原 Compose 项目和数据卷，保护数据库、照片、备份与必要环境密钥。
- 宿主机 Caddy 反代 loopback；容器 Caddy 使用正确共享网络地址。
- 保持其它站点不变，验证配置后 reload，不抢占 80/443。
- 验证 HTTPS、Secure Cookie、CSRF 及 Android 接口合同。
- 保留可选抠图能力，部署时核实资源与降级。
- 先备份、准备恢复与回滚，再升级；核对旧账本和新记账。

## Acceptance Criteria
- [ ] 镜像构建、Compose 校验、健康检查和 JSON 404 通过。
- [ ] 域名 HTTPS 登录及 APK 记账联调成功。
- [ ] 历史数据保留，备份/恢复/回滚步骤可复现。
- [ ] 部署文档完整，未实际验证项明确记录。

## Dependencies and Deferred Inputs
父任务范围确认、Android 本地验收后上线；服务器访问、Caddy 配置、旧卷名与镜像待核实，不编造部署结果。
