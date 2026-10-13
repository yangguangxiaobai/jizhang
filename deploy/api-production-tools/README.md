# API 生产维护与旧目录归档交接

## 状态与边界

本包最初在本地准备，助手未连接服务器或直接执行归档。随后用户已在服务器执行交接操作并反馈五项旧部署文件归档完成；当前执行证据与清理边界以[生产部署与维护记录](../API-PRODUCTION-README.md)为准。Git 提交授权与实际提交结果单独记录，不由工具准备状态推断。
用户已反馈验证：`jizhang:api-2026-10-12` 健康，HTTPS health 正常，域名根返回 JSON 404，旧账本完整，XLSX 导入可用。这些是用户提供的生产验收信息，不是本包重新实测的结果；不代表 Android 全功能或抠图/AI 已完整验收。

固定拓扑（不适用于其他机器）：

- 工作目录 `/opt/jizhang-production`，Compose 项目 `jizhang`。
- 外部数据卷 `jizhang_jizhang-data`，挂载到 API 的 `/data`。
- 配置顺序：`docker-compose.yml` → `docker-compose.migration.yml` → `runtime.override.yml` → `image.override.yml`，同目录保留 `.env`。
- 旧 worker 可以仍带 `/opt/jizhang` 的 Compose 标签；这意味着旧目录仍有配置引用，不能宣称完全清理，也不应通过重建 worker 来消除标签。本包不操作 worker、Caddy、containerd、komari 或任何卷。

## 安装交接包（由操作人员执行）

将 `api-production-tools.tar.gz` 和同名 `.sha256` 上传到保留的 `/opt/jizhang-upload`，在服务器终端校验并解压。以下是安装操作说明，不是助手远程执行记录；用户后续执行结果见上述生产部署与维护记录：

```bash
cd /opt/jizhang-upload
sha256sum -c api-production-tools.tar.gz.sha256
# 确認目标 api-production-tools 不存在后解压，避免覆盖既有文件。
tar -xzf api-production-tools.tar.gz
sudo install -o root -g root -m 700 api-production-tools/manage.sh /opt/jizhang-production/manage.sh
sudo install -o root -g root -m 700 api-production-tools/archive.py /opt/jizhang-production/archive.py
```

包不包含 `.env`、生产配置副本、数据库、镜像或任何凭据。依赖 Ubuntu 上的 Bash、Python3、Docker Engine 和 Compose v2。保持生产 `.env`、runtime/image override、备份与历史检查记录为 root 私有文件。

## 日常维护：只使用 wrapper

```bash
sudo /opt/jizhang-production/manage.sh status
sudo /opt/jizhang-production/manage.sh config
sudo /opt/jizhang-production/manage.sh logs
sudo /opt/jizhang-production/manage.sh backup
sudo /opt/jizhang-production/manage.sh up
```

`manage.sh` 无论调用者在哪个目录，都先进入生产目录，明确指定 `.env`、项目名和全部四个 `-f`，每次导出 `JIZHANG_DATA_VOLUME=jizhang_jizhang-data`。变量不是父 shell 的持久修改，但通过 wrapper 每次调用保持有效；不要依赖上次手工 export 或裸 `docker compose`。

- `status`：项目全部容器状态（含停止容器）。
- `config`：`config --quiet` 只验证合并模型，不打印环境变量或配置值。
- `logs`：API 最近100行，非 follow。应用日志可能包含用户数据；仅在私有终端查看，不贴到公开渠道。
- `up`：严格为 `up -d --no-deps --no-build --pull never jizhang`；不重建、不拉取、不操作依赖或 worker。
- `backup`：复用运行容器内的 `node packages/server/dist/cli.js backup /data/backups/production-handoff 0`，使用现有 SQLite 一致性快照与校验逻辑，`0` 禁止旧备份自动清理。备份仍在原数据卷，不是上传下载或离线恢复功能，也不替代隔离环境的恢复演练。

只接受上述五个操作且不接受附加参数；没有 `down`、restore、prune 或删除入口。不要启用 `bash -x`、输出 `.env` 或运行裸 `docker inspect`/`compose config` 后公开粘贴结果。完整 inspect/config 私有 JSON **包含秘密**（环境、认证、AI 密钥等）；历史 JSON 必须继续私有保存，不随交接包分发。归档工具仅在内存读取 inspect，落盘 manifest 只含路径、容器 ID、阻挡类型和已移动记录。

## 旧目录：先 dry-run，再选择 apply

```bash
sudo python3 /opt/jizhang-production/archive.py
# 审核 dry-run，确认当前没有部署、容器创建/重建或路径改动后，才执行：
sudo python3 /opt/jizhang-production/archive.py --apply
```

默认 dry-run 不创建归档目录、不移动文件，只打印固定候选的 `eligible` / `blocked` / `missing`。Docker 不可访问、inspect 失败、结果不完整或容器清单变化时关闭通路；不把未知状态当作“没有引用”。扫描 `docker ps -aq` 的所有容器，**包括已经停止的容器**。

唯一允许候选：

| 候选路径 | 处理 |
|---|---|
| `/opt/jizhang` | 仅无引用时可归档；worker 标签仍引用则保留 |
| `/opt/jizhang-api-2026-10-09` | 同上 |
| `/opt/jizhang-upload-old` | 同上 |
| `/home/ubuntu/jizhang-64be4b1-source.tar.gz` | 同上 |
| `/home/ubuntu/jizhang-images-64be4b1` | 同上 |
| `/home/ubuntu/jizhang-release-64be4b1` | 同上 |

任何容器挂载 `Source`、Compose `working_dir` 或 `config_files` 等于候选或位于候选内部，就阻止移动该候选；解析符号链接后的引用也检查。挂载 Source 是候选的上级目录（例如 `/opt` 或 `/home/ubuntu`）时也阻挡，防止归档改变容器可见的目录内容。符号链接候选、挂载点、跨文件系统移动均拒绝，避免复制后删除或移动实际卷。

**明确保留** `/opt/jizhang-upload`（现有源码）、所有备份、`/opt/jizhang-production`、Caddy、containerd、komari、任何 Docker 卷及迁移目录。本工具没有扩展候选参数，不扫描 `/opt` 后凭名字批量清理，也不做容器/镜像/网络/卷清理。

`--apply` 额外要求 root、API 运行且 Docker health 为 `healthy`、镜像标签和实际 ID 与 `jizhang:api-2026-10-12` 一致、`/data` 为原命名卷且卷 inspect 成功，项目/service 标签正确，working_dir 为生产目录，config_files 按顺序指向全部四份生产配置。配置缺失、符号链接或不满足上述条件时不开始移动；不要修改检查常量来强行通过。

归档路径为 root 所有、权限700的 `/opt/jizhang-archive/<UTC时间>-<PID>/`，以同文件系统 rename 保留原文件内容、权限与所有权；不删除内容。清单权限600。每次移动前重新检查全容器及生产条件。Docker 与文件系统不能原子锁定，因此执行期间必须暂停其他部署/容器与路径修改。中途失败会停止后续移动，已移动项不自动回退，查看私有 manifest；不要把部分归档说成完整清理。无需归档或只剩 blocked 项时，不应尝试绕过。

## 镜像回退（不恢复数据库）

先确认本地已存在 `jizhang:rollback-before-api-cleanup`，私下核对原 runtime override 与 `.env` 均保留。仅编辑生产 `image.override.yml` 的 API image 条目，其余内容保持不变：

```yaml
services:
  jizhang:
    image: jizhang:rollback-before-api-cleanup
```

然后：

```bash
sudo /opt/jizhang-production/manage.sh config
sudo /opt/jizhang-production/manage.sh up
sudo /opt/jizhang-production/manage.sh status
```

此操作只切 API 镜像，继续使用原 runtime override、外部数据卷和项目；不恢复 DB、不覆盖回退前的新账务写入。旧镜像必须与当前数据库/schema及有效环境兼容；若不兼容则停止并单独制定方案，不能用数据库恢复掩盖问题。本包不注入 `WEB_DIST_DIR`，但旧镜像可能自行提供 Web UI；缺少该变量不能证明 API-only。切换前须在隔离环境确认回退镜像仍符合 API-only 合同；若不符合则该镜像不是本交接包的可用回退目标，应另选兼容镜像。回退后须重新核查 HTTPS health、根 JSON404、登录和账本。归档工具在回退镜像状态下会故意拒绝 apply。

## 本地验证与交付边界

本地执行 `python -m py_compile archive.py`、`bash -n manage.sh` 和 mock 单元测试；打包检查 LF、成员与 SHA256。测试不连接 Docker 或服务器，不证明 root 权限、实际文件引用、生产健康或现场归档成功。以上是本地工具验证，未连接生产服务器，也不执行 Git 提交或删除操作。用户后续在服务器执行的归档及另行授权的镜像标签清理见[生产部署与维护记录](../API-PRODUCTION-README.md)；本包交付完成不等于旧环境完全清理。
