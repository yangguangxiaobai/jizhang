# 核心财务后端生产部署记录

## 授权及范围

2026-11-01 用户明确要求部署当前项目后端到 `jz.yansuu1.xyz`，并允许短暂 API 维护窗口。本次只部署 API 容器；不重建 Caddy、抠图服务或 Komari，不执行生产账务写入，不清理任何卷、历史备份或镜像。源码来自基线 `bde9a18da5ef33567f52fb544f181479cd4aedf3` 上含未提交改动的工作区，不等同于该 commit 的纯源码。

## 构建

- 源码包：`artifacts/jizhang-api-source-2026-11-01-finance-repair-v4.tar.gz`，144 个允许清单文件；SHA-256 `5f1e445e9244bd167f1abe7d15ebe27f3b1ca3e27a77dcb9ad44ee35a7f58a1f`。服务器外层及内层清单校验通过。
- 起初构建因 slim 基础镜像缺 Python/node-gyp 工具链失败；第二次官方 Debian 源下载过慢，停止的仅是确认无挂载的临时构建容器。随后 Dockerfile 增加构建时临时工具链与可选镜像参数，使用 Debian 签名元数据及经探测的镜像完成构建，运行阶段移除了临时工具链。
- 部署镜像：`jizhang:api-finance-repair-v4-20261101`，ID `sha256:c31e2c71c8313ec3ada9eb5f2c7c16f067c93bb496a16c48ba72d29fe6dfe452`，运行用户 `node`。
- 原镜像：`jizhang:financial-execution-20261027`；保留回退标签 `jizhang:rollback-finance-repair-v4-20261101`。旧镜像在迁移后隔离副本上验证可打开 schema 20、完整性正常且无额外迁移；此检查不是完整旧版功能验收。

## 备份及迁移验证

- 预检：原生产库 schema 19，`integrity_check=ok`，外键违规 0；原 `/data` 挂载为命名卷 `jizhang_jizhang-data`。
- 在线一致性备份由生产维护 wrapper 创建并由 CLI verify：40 张表。停止生产 API 写入后又生成并 verify 最终一致性快照 `jizhang-2026-11-01T12-08-13-585.db`。
- 最终快照受保护服务器副本：`/opt/jizhang-backups/finance-repair-20261101/cutover-v4/final-snapshot.db`；受保护本机副本：`%LOCALAPPDATA%/jizhang-deploy-backups/finance-repair-20261101/finance-repair-final-snapshot-v4.db`。两端 SHA-256 均为 `e0740060f126d5f9f522fa4d08a459745f44a909893a60abd76dd87f380965d0`，1,855,488 字节。不要将快照或 `.env` 纳入源码仓库。
- 使用备份恢复到独立目录，容器 `--network none` 且不挂载生产卷；应用迁移 20 后，schema 20、完整性 `ok`、外键违规 0。迁移前 40 张旧表（除预期改变的 `schema_migrations`）数据行数和摘要均不变；新增四张手动目标表。

## 切换后检查

- 维护锁受保护；备份复制至本机并哈希核验后，才替换生产 image override，使用相同项目及四个 Compose 文件，仅 `up -d --no-deps --no-build --pull never jizhang` 重建 API。
- API 容器：`running/healthy`，新镜像 ID 与候选镜像一致，用户 `node`，`127.0.0.1:8081`，原命名卷 `jizhang_jizhang-data` 仍挂载 `/data`。
- 原有 40 张表在最终快照与上线后只读 manifest 中，除 schema 版本表的预期变化外，数据行数和摘要均一致；上线后 44 张表，完整性 `ok`，外键违规 0。
- 公网 `https://jz.yansuu1.xyz/api/v1/health` 返回 HTTP 200 `status=ok`；根路径返回 JSON 404。未认证的 `/api/v1/monthly-plan` 和 `/api/v1/financial-goals` 均返回 HTTP 401。401 证明认证拒绝，不单独证明业务成功。
- Caddy、`jizhang-cutout` 与 Komari 均仍运行，cutout 报告 healthy；本次未操作这些容器。
- 切换帮助脚本和私有回退材料位于服务器 `cutover-v4` 目录；不得公开其中的完整 inspect、有效环境文件及数据库。切换早期出现一次连接重置，重试健康检查后成功；最终脚本 exit 0。

## 尚未完成

- 部署后未在手机上完成登录态下月计划、手动目标、平台导入或写入后的业务验收；也未验证真实 AI Provider。部署状态与设备业务验收须分别记录。
- 未在真实生产账本创建测试工资、账单、导入批次或手动目标。
- 未提交工作区改动。不要以本地版本号 `0.1.0` 判断具体镜像，以上线的镜像标签/ID 和源码包哈希为准。
