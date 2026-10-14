# 记账 Android API 生产部署与维护

## 本轮交付状态（2026-10-13）

以下为用户返回的服务器执行结果与验收反馈，不是助手直接连接生产服务器所得证据：

- API 已切换至 `jizhang:api-2026-10-12`，镜像 ID `21340743ce31a1b795b550a73473273a1f86cabd213f80fc18962b3945b0458a`，容器健康。
- 公网 `https://jz.yansuu1.xyz/api/v1/health` 返回 `status: ok`；根路径返回 JSON 404，不再提供旧 Web 页面。
- 原账单、余额、工资、预算仍在；用户确认 App 微信账单导入正常。
- 原数据卷保持不变；Caddy、抠图、Komari 未被本轮重建。
- 五项旧部署文件归档完成；用户确认随后完成指定旧镜像标签清理。清理后的完整镜像列表尚未返回。
- 本部署交付按用户授权提交 Git；具体提交号见交付回复及开发日志。以上不代表 Android 全功能、真实 AI 或鸿蒙设备全量验收。

## 唯一生产入口及目录

| 路径/资源 | 用途 |
|---|---|
| `/opt/jizhang-production` | 唯一 API 生产配置入口，含管理脚本和服务器 README |
| Docker 卷 `jizhang_jizhang-data` | 原数据，挂载 `/data`；数据库 `/data/jizhang.db` |
| `/opt/jizhang-backups` | 一致性数据库备份、受保护的配置及回退证据 |
| `/opt/jizhang-upload` | 源码和构建包，不是生产启动入口 |
| `/opt/jizhang-archive/20261013T042430993098Z-411738` | 本次归档及 `manifest.json` |
| `/opt/jizhang` | 抠图容器仍记录的 Compose 来源，保留；不要在此更新 API |

归档内容：`/opt/jizhang-api-2026-10-09`、`/opt/jizhang-upload-old`、`/home/ubuntu/jizhang-64be4b1-source.tar.gz`、`/home/ubuntu/jizhang-images-64be4b1`、`/home/ubuntu/jizhang-release-64be4b1`。归档不是删除；备份暂不清理。

## 配置和服务合同

Compose 项目固定为 `jizhang`，服务名 `jizhang`，容器名 `jizhang`。四份配置按以下顺序合并：

1. `docker-compose.yml`
2. `docker-compose.migration.yml`
3. `runtime.override.yml`
4. `image.override.yml`

同目录的私有 `.env` 保留原账号、认证和 AI 配置。数据卷必须显式指定 `JIZHANG_DATA_VOLUME=jizhang_jizhang-data`，使用 external 卷，不创建新空卷。管理脚本每次固定该变量、项目名、目录及四份配置。

API 仅发布 `127.0.0.1:8081`，Caddy 负责 HTTPS。API 网络保持 `jizhang_default`、`jizhang_cutout-internal`。抠图镜像 `jizhang-cutout:64be4b1` 不属于旧 Web 镜像，继续保留。Caddy、Komari、containerd 不在清理范围。

## 日常命令

```bash
sudo /opt/jizhang-production/manage.sh status
sudo /opt/jizhang-production/manage.sh config
sudo /opt/jizhang-production/manage.sh logs
sudo /opt/jizhang-production/manage.sh backup
```

`config` 只验证，不打印敏感值。日志仅在私有终端查看。`.env`、完整 inspect/config JSON、历史环境备份不得公开或纳入源码包。

## 后续更新

1. 先备份并复制一份到服务器外。
2. 上传完整源码包至构建目录，检查 SHA256。构建输入必须包含 `.npmrc` 和 `deploy/db-manifest.mjs`；不打包生产 `.env`、数据库或凭据。
3. 用新的独立标签构建镜像，不覆盖当前/回退标签。例如在已准备好的源码目录运行 `docker build -t jizhang:api-YYYY-MM-DD .`。
4. 保存当前配置和实际镜像的回退标签；只修改生产 `image.override.yml` 中 `services.jizhang.image`，其余配置不变。
5. 执行：

```bash
sudo /opt/jizhang-production/manage.sh config
sudo /opt/jizhang-production/manage.sh up
sudo /opt/jizhang-production/manage.sh status
curl -fsS https://jz.yansuu1.xyz/api/v1/health; echo
curl -sS -i https://jz.yansuu1.xyz/
```

`up` 只操作 API，使用 `--no-deps --no-build --pull never`。单纯 restart 不会切换镜像。不从其他历史目录运行裸 Compose；不要执行 `down -v` 或卷清理。

确认健康、根 JSON404、旧数据和关键 App 操作后才归档旧包。

## 数据备份

本轮已生成并用 CLI verify 验证的备份为 20 张表、320 KiB：

`/opt/jizhang-backups/api-cleanup-20261012/database/jizhang-2026-10-13T03-34-07-837.db`

原配置备份在同目录下的 `config/`。日常 wrapper 的 backup 使用 SQLite 一致性快照，不直接复制运行中的 `.db`；在线数据库可能有 WAL，仅复制主文件不完整。

wrapper 新备份位于原卷内 `/data/backups/production-handoff`，不自动复制到卷外。生成后通过 `docker cp` 按实际文件名复制到宿主机受保护目录，再保存到服务器外。定期在隔离环境演练恢复；禁止为了回退镜像覆盖生产数据库。

## 镜像回退和清理

保留当前 `jizhang:api-2026-10-12` 与 `jizhang:rollback-before-api-cleanup`（原 API 镜像 `226abee3cc1b`）。回退前确认与当前数据库和配置兼容，只修改 image override 指向回退标签，再执行 wrapper config/up/status；不恢复数据库，不覆盖更新后的账务写入。重新验证 API-only、登录和账本。

本轮用户确认删除旧 Web 标签及重复的 `api-2026-10-09` 标签，并删除已退出的 `jizhang-api-check`；回退标签保留。未知停止容器 `boring_colden` 未纳入删除。禁止强制删除被引用镜像或批量 volume prune。

## 工具来源及边界

版本控制内的维护工具与详细安装/归档说明：[api-production-tools README](api-production-tools/README.md)。工具包 `artifacts/api-production-tools.tar.gz` 及其 SHA256 sidecar 已交付；本地 bash/Python 检查及 9 项 mock 测试通过，不等同于真实生产测试。

archive.py 默认预览，--apply 才归档。检查全部容器（包括停止容器）的挂载和 Compose 引用；被引用目录保留。本轮 `/opt/jizhang` 因抠图引用被正确阻挡。无需为目录外观整洁重建正常工作的依赖服务。

## Backup retention implementation boundary (2026-10-14)

Bounded enrolled-snapshot tooling passed independent review and was deployed
maintenance-only on 2026-10-14T04:38:31Z. Sudo preview of the empty registry reports
zero candidates, zero reclaimed bytes and apply_ready=false. All five container
IDs, image IDs, start times and states plus production configuration bytes remained
unchanged; API/cutout stayed healthy, public health returned 200 and root 404.
Existing 9 host DB paths and 8 app backup paths remain unmanaged/protected; the
649,814,782-byte historical archive file inventory was unchanged. See
[retention operations](api-production-tools/RETENTION.md). No production apply,
timer activation, image change, restart or ledger write has been executed by this
implementation. Historical backups/configs/archives remain protected. The app's
existing root backup policy is unchanged; the wrapper still uses retain-days=0.
The protected shared maintenance lock was created before installing the changed
wrapper. No systemd service/timer was installed or enabled. Private old scripts:
`/opt/jizhang-production/maintenance-rollback-20261014T043831Z`.
Future snapshots require manual completed-snapshot transfer and enrollment; the
wrapper does not enroll automatically. Detailed evidence and plan digest:
`.trellis/tasks/10-14-backup-retention/deploy-status.md`.

### Approved existing-snapshot enrollment follow-up (2026-10-14)

At 2026-10-14T05:28:24Z the existing bill-import deployment snapshot was copied
(not moved) into the managed retention root and enrolled pinned/current-release
with matching locally verified off-server attestation. Original host/local copies
remain unchanged. Preview now has ONE distinct verified point, zero candidates
and zero reclaimable bytes; apply_ready=false because minimum-three is not met.
No fresh production backup, apply/deletion, restart, config/image change or timer
activation occurred. Tools still require manual transfer/enrollment; the precise
next-deployment checklist is in [retention operations](api-production-tools/RETENTION.md).
Evidence: `.trellis/tasks/10-14-backup-retention/enrollment-status.md`.
