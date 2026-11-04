# 账单模糊搜索生产部署与安装记录

## 授权与范围

- 2026-11-01 用户明确授权“安装和部署服务器”，同意生产短维护窗口。
- 目标服务器：`jz.yansuu1.xyz`；保留生产数据卷 `jizhang_jizhang-data`、端口 `127.0.0.1:8081`、root 权限 `.env`、密钥、Caddy、抠图服务和 Komari。
- 目标设备：已授权的华为 JER-AN20（HarmonyOS 4 / Android 12 SDK 31）。

## 服务端构建与部署

### 1. 源码与镜像
- 源码包包含 `packages/server` 与 `packages/shared` 的最新账单模糊搜索实现（`searchVersion: 1`、`searchRevision` SHA-256、字面匹配、`MAX_SEARCH_ROWS = 10000` / `MAX_SEARCH_TEXT_BYTES = 16 MiB` 预检）。
- 初始候选镜像因解包 umask 077 导致构建上下文内 `package.json` 等文件为 600 root:root，生产以 `node` 用户启动无法解析依赖；通过只读隔离容器发现并以仅修改权限的派生镜像（`jizhang:bill-search-20261101t144524z-r2`）修复为 644/755。
- 经 `find . -type f | sort | xargs sha256sum` 对比，修复镜像与候选镜像的 2,871 个文件内容完全一致，仅文件模式变化。
- 上线镜像：`jizhang:bill-search-20261101t144524z-r2`，ID `sha256:7fea20afd6ea5c87466ce375192835c6a01c43bd6c6588ab86529a1b79712039`。
- 回滚镜像标签：`jizhang:rollback-bill-search-20261101t144524z-r2`，ID `sha256:c31e2c71c8313ec3ada9eb5f2c7c16f067c93bb496a16c48ba72d29fe6dfe452`（即原 `finance-repair-v4`）。

### 2. 隔离功能预检
在容器内临时数据库中执行只读探针 `artifacts/probe-image-search.mjs`：
- 全历史搜索返回 `searchVersion: 1` 和 64 位 SHA-256 `searchRevision`；
- 所选月列表与每日汇总的 `searchRevision` 一致；
- 金额（`123.45`）、标签（`probetag`）、分类名称匹配成功；
- 未匹配项依然返回协议标记和确定性指纹；
- `%` 通配符按字面匹配。

### 3. 数据安全与异机备份
- 切换全程由 `/opt/jizhang-production/maintenance.lock` 独占文件锁保护。
- 停止 API 写入后，在卷上生成最终一致性快照，并通过 CLI 校验。
- 最终快照路径：`/opt/jizhang-backups/bill-search-20261101t144524z-r2/final-snapshot.db`（1,896,448 字节）。
- 异机副本路径：`%LOCALAPPDATA%\jizhang-deploy-backups\bill-search-20261101T144524Z\final-snapshot-r2.db`。
- 两端 SHA-256 完全一致：`66e398f8c7d34f483d448d602cc193d7cebc93662f29463c86b4dcd3ea97773b`。
- 本机 ACL 严格限制为仅当前用户、SYSTEM 和管理员，禁用继承。
- 异机比对通过后，原子创建 root:600 证明标记，切换脚本方才推进。

### 4. 切换执行与上线结果
- 维护窗口耗时：**22 秒**（`MAINTENANCE_ELAPSED_SECONDS=22`）。
- 仅通过更新 `image.override.yml` 并执行 `docker compose up -d --no-deps --no-build --pull never jizhang` 重建 API 容器。
- 上线后容器状态：`running/healthy`，运行用户 `node`，挂载原数据卷 `jizhang_jizhang-data`。
- 上线后 44 张数据库表与最终快照逐行比较，行数与数据哈希完全一致（`ALL_44_TABLES_IDENTICAL_TO_FINAL_SNAPSHOT`）。
- Schema 版本 20，SQLite `integrity_check` 正常，外键违规为 0。
- Caddy、`jizhang-cutout` 和 Komari 保持原容器运行未受影响。
- 公网健康接口 `https://jz.yansuu1.xyz/api/v1/health` 返回 HTTP 200 `status=ok`（uptime 53s）。
- 根路径正确返回 JSON 404；未认证搜索及月计划请求正确返回 HTTP 401。

## Android 应用安装与验证

### 1. APK 构建与安装
- 构建命令：`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug '-Pkotlin.incremental=false' --rerun-tasks`。
- 63 套、580 项 JVM 单元测试全部通过；`lintDebug` 为 0 errors、43 warnings。
- APK 大小：22,112,428 字节，SHA-256 `E29593BE7FE956F25C142514CA1854EEA3CBD19251EB7924A34CEC66D76B7C4A`。
- 安装方式：在设备授权状态下执行 `adb install -r` 覆盖安装，保留应用数据。
- 启动核验：冷启动成功，MainActivity 正常展示首页与账单导航，未出现登录页或崩溃。

### 2. 状态与待验说明
- 本机当前与物理设备已断开连接（`adb devices` 为空），未能由脚本直接执行真机界面的搜索触摸/滑动验收。
- 部署后真机交互验证标记为**待验**，可由用户在手机上直接体验：在账单页输入名称或金额关键词，验证全部历史与所选月份搜索。
