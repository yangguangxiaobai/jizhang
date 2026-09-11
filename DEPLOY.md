# 部署手册 · jizhang（记账 Web PWA）

面向：**已经在这台 VPS 上跑着别的站点、并且用 Nginx 或 Caddy 占着 80/443** 的场景。

这份文档的每一处「不要做」都来自实际踩过的坑，不是泛泛的安全建议。

---

## 0. 部署模型（先理解这个，后面才不会踩雷）

```
iPhone Safari ──HTTPS──▶ 你已有的 Nginx/Caddy（占 80/443，管证书）
                              │ proxy_pass → 127.0.0.1:8081
                              ▼
                    jizhang 容器（只有一个）
                    ├── Fastify：/api/** + 托管前端产物
                    └── /data/jizhang.db（Docker 命名卷）
```

两个关键设计：

- **只监听 `127.0.0.1:8081`**。应用永远不会去抢 80/443，所以启停它不会影响你其它站点。
- **单容器**。1 核 1G 的机器上少一个容器就少一份 Node 运行时；前端是静态产物，由同一个 Fastify 同源托管，因此没有 CORS，反代也只需转发一个上游。

---

## 1. 部署前必须向用户确认的信息

**在这些都确认之前，不要动线上环境。**

| 需要知道 | 为什么 |
|---|---|
| SSH 主机 / 用户 / 认证方式 | 才能登录 |
| 域名，以及是否已解析到这台 VPS | 证书签发需要解析已生效 |
| 反代是 **Nginx 还是 Caddy**，配置文件在哪 | 两者的配置语法与 reload 方式完全不同 |
| 是否已装 Docker 与 compose 插件 | 没有就得先装 |
| **现有站点清单** | 改完之后要逐条确认它们仍然正常 |
| 磁盘余量 | 镜像 + 数据库 + 备份要留空间 |

---

## 2. 构建镜像（在**本地**，不要在 VPS 上构建）

1 核 1G 的机器上跑 `docker build` 会 OOM。本地构建好再传上去。

```bash
# 仓库根目录
docker compose build

# 打一个带日期的 tag，回滚时靠它
docker tag jizhang:latest jizhang:2026-09-11
```

分发方式二选一：

```bash
# A. 走镜像仓库（推荐，最省事）
docker tag jizhang:2026-09-11 <registry>/jizhang:2026-09-11
docker push <registry>/jizhang:2026-09-11
# 服务器上：docker pull <registry>/jizhang:2026-09-11

# B. 离线传输（没有仓库时）
docker save jizhang:2026-09-11 | gzip > jizhang-2026-09-11.tar.gz
scp jizhang-2026-09-11.tar.gz user@host:/opt/jizhang/
# 服务器上：gunzip -c jizhang-2026-09-11.tar.gz | docker load
```

---

## 3. 首次部署

```bash
# 服务器上
sudo mkdir -p /opt/jizhang && cd /opt/jizhang

# docker-compose.yml 从仓库拷过来，并把 image 改成带 tag 的那个
#   image: jizhang:2026-09-11
```

创建 `.env`：

```bash
cp .env.example .env
chmod 600 .env          # 收紧权限
```

**`.env` 里不要放明文密码。** 只需要：

```
JIZHANG_USERNAME=admin
SESSION_TTL_DAYS=30
TRUST_PROXY=true
```

> `JIZHANG_PASSWORD_HASH` 在启动校验里是必需项，但**不要手工填哈希**。用下面的
> 一次性命令设置密码，它会写入数据库并清空所有旧会话：
>
> ```bash
> docker compose run --rm -it jizhang node packages/server/cli.js set-password
> ```
>
> 注意：这条命令需要交互式终端（它会关闭回显读密码）。在 `docker compose run`
> 里加 `-it`。

启动：

```bash
docker compose up -d
docker compose ps            # 应为 healthy
docker compose logs -f       # 看到 "sqlite ready" 与 migrationsApplied
```

冒烟测试（在服务器本机）：

```bash
curl -fsS http://127.0.0.1:8081/api/v1/health
# {"status":"ok","version":"0.1.0","uptime":12}
```

---

## 4. 反代配置：**只新增，不修改**

> ⚠️ 这一步是整份文档里风险最高的操作。做之前先备份现有配置目录。
> 出错的典型后果不是本应用打不开，而是**你其它站点一起挂掉**。

### 4.1 先备份

```bash
# Nginx
sudo tar czf /root/nginx-backup-$(date +%F).tar.gz /etc/nginx

# Caddy
sudo tar czf /root/caddy-backup-$(date +%F).tar.gz /etc/caddy
```

### 4.2 Nginx：新增一个 server block

放到 `/etc/nginx/conf.d/jizhang.conf`（**新建文件**，不要改现有文件）：

```nginx
server {
    listen 80;
    server_name jizhang.example.com;

    # 交给证书机器人；如果证书由别处统一签发，这段按你的现有做法写
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name jizhang.example.com;

    ssl_certificate     /etc/letsencrypt/live/jizhang.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jizhang.example.com/privkey.pem;

    # PWA 需要相对宽松的上传体积其实很小，但保留一个上限
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;

        # ★ 这三个头是必须的：
        #   X-Forwarded-Proto 决定 Fastify 是否认为连接是 https，
        #   而会话 Cookie 带 Secure 属性 —— 缺了它 Cookie 不会被浏览器保存，
        #   表现为「登录成功但立刻又跳回登录页」。
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

校验并重载（**先 `-t`，通过才 reload**）：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 Caddy：新增一个 site

Caddyfile 里**追加**：

```
jizhang.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

Caddy 会自动申请证书，并自动下发 `X-Forwarded-*`，所以不用手写头部。

```bash
caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

### 4.4 改完立刻做的事

```bash
# 1. 本应用能打开
curl -fsS https://jizhang.example.com/api/v1/health

# 2. ★ 你其它站点仍然正常（逐条确认，这是硬性验收项）
curl -fsS -o /dev/null -w '%{http_code}\n' https://你其它的域名
```

---

## 5. 备份与恢复

### 5.1 为什么不能直接 `cp` 数据库

SQLite 跑在 **WAL 模式**：最近的提交在 `jizhang.db-wal` 边车里。只复制 `.db`
主文件会拿到一个**旧快照**——开发期我就这样丢过一次诊断数据，还据此去查一个
根本不存在的 bug。

必须用 SQLite 自己的备份机制。**镜像里没有 `sqlite3` CLI**（基础镜像是
`node:22-bookworm-slim`，为一条维护命令装一个包不值），所以备份命令做在应用自带的
CLI 里，用的是同一个 SQLite 构建。

### 5.2 备份

```bash
# 容器运行中即可执行（VACUUM INTO 是事务一致的，不阻塞写入）
docker compose exec -T jizhang node packages/server/dist/cli.js backup /data/backups 30
```

输出：

```
[jizhang] Backup ok: /data/backups/jizhang-2026-09-11T07-28-56-675.db
          10 tables, 128.0 KiB
```

它做了三件事，缺一不可：

1. 用 `VACUUM INTO` 生成**事务一致**的快照（包含 WAL 里的数据）；
2. **校验产物**：`integrity_check` 必须为 `ok` 且至少有一张表 —— 校验失败会删除该
   档案并报错，绝不留一个看起来正常的坏文件；
3. 按保留期清理旧档案（`0` 表示不清理）。

> ⚠️ **备份必须放在卷里**（如 `/data/backups`）。放 `/tmp` 的话容器一重建就没了——
> 而"容器重建"正是你最需要备份的时刻。

从容器拷到宿主机（备份的意义在于离开这台机器）：

```bash
docker compose cp jizhang:/data/backups/jizhang-2026-09-11T07-28-56-675.db ./backups/
```

定时任务（每天 03:15，保留 30 天）：

```
15 3 * * * cd /opt/jizhang && docker compose exec -T jizhang node packages/server/dist/cli.js backup /data/backups 30 >> /var/log/jizhang-backup.log 2>&1
```

### 5.3 校验某个档案

```bash
docker compose exec -T jizhang node packages/server/dist/cli.js verify /data/backups/jizhang-2026-09-11T07-28-56-675.db
# [jizhang] /data/backups/... is a valid database (10 tables).
```

### 5.4 恢复（**必须演练过一遍**）

只测「备份文件生成了」不算验证。下面是完整的恢复流程，**在 T10 里已经实际跑通过
一次并核对了数据**。

```bash
cd /opt/jizhang

# 1. 必须先停服务：CLI 会探测 8081 端口，服务还在跑时它会拒绝执行
docker compose stop

# 2. 执行恢复（run 会在卷上新建一次性容器）
docker compose run --rm -T --entrypoint node jizhang \
  /app/packages/server/dist/cli.js restore /data/backups/jizhang-2026-09-11T07-28-56-675.db
# [jizhang] Current database copied to /data/jizhang.db.before-restore-<时间戳>
# [jizhang] Restored /data/backups/... -> /data/jizhang.db

# 3. 重启并确认
docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
```

恢复时的三道保护：

- **服务在跑就拒绝**。判据是 HTTP 健康检查，不是数据库锁——WAL 模式下写锁可以和
  运行中的服务共存，用锁判断会误放行，然后把数据库从运行中的进程底下抽走。
- **先留存当前库**为 `jizhang.db.before-restore-<时间戳>`。恢复正是最需要回退的时刻。
- **删除 `-wal` / `-shm` 边车**。它们描述的是**上一个**数据库，留着会和恢复的库混成
  两个库的混合物。
- 恢复前会**校验来源档案**，不是可用数据库就拒绝执行，且不动现有数据。

---

## 6. 更新与回滚

### 更新

```bash
cd /opt/jizhang
# 1. 先备份
./scripts/backup.sh /opt/jizhang/backups 30

# 2. 拉新镜像并改 compose 里的 tag
docker compose pull          # 或 docker load < 新的 tar.gz
# 编辑 docker-compose.yml: image: jizhang:2026-10-01
docker compose up -d

# 3. 看日志确认迁移执行了
docker compose logs --tail=50
```

### 回滚

```bash
# 改回旧 tag 即可。迁移是「只增不改」的，旧代码能读新库。
# 编辑 docker-compose.yml: image: jizhang:2026-09-11
docker compose up -d
```

数据库迁移**只增不改**：回滚代码后旧库仍可读（新列都有默认值）。迁移执行前会自动
在 `/data/backups/` 留一份快照。

---

## 7. 1 核 1G 机器的注意事项

- **不要在服务器上构建**：镜像在本地构建好再传。
- 容器已设 `--max-old-space-size=256`（Dockerfile 与 compose 都写了）。
- 可选：给 compose 加内存上限，进一步保护宿主：
  ```yaml
  deploy:
    resources:
      limits:
        memory: 320m
  ```
- 查看占用：`docker stats --no-stream jizhang`
- 日志会无限增长，建议在 compose 里限制：
  ```yaml
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }
  ```

---

## 8. 故障排查

| 现象 | 原因与处理 |
|---|---|
| 容器起不来，日志说配置错误 | 缺少 `JIZHANG_USERNAME` 或 `JIZHANG_PASSWORD_HASH`。启动校验会**一次列出所有缺失项**，按提示补 `.env` |
| 502 Bad Gateway | 容器没在跑，或端口没对上。`docker compose ps`、`curl 127.0.0.1:8081/api/v1/health` |
| **登录成功但立刻跳回登录页** | 反代没下发 `X-Forwarded-Proto`，Fastify 认为是 http，于是不下发 `Secure` Cookie。补上 `proxy_set_header X-Forwarded-Proto $scheme;` |
| 登录一直 401 | 账户还没设置：`docker compose run --rm -it jizhang node packages/server/cli.js set-password` |
| 「需要联网才能记账」但网络正常 | 反代超时或后端挂了。看 `docker compose logs` |
| 数据好像丢了 | 大概率是在 WAL 模式下直接 `cp` 了 `.db`。用 `.backup` 重新取快照 |
| 改了代码但页面没变 | Service Worker 缓存。刷新两次；`sw.js` 用 `autoUpdate`，第二次加载会切到新版 |

---

## 9. 首次上线后要做的事

1. 用 iPhone Safari 打开域名，「添加到主屏幕」
2. 从主屏图标启动，确认**没有地址栏**（standalone）
3. 记录一次支出，在预算页看到对应模块变化
4. 记一次工资，确认按模板比例生成各模块预算
5. 打开飞行模式，重新启动应用，确认**能打开**且提示需要联网
6. 逐条确认**其它站点仍正常**

---

## 10. 环境变量速查

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8081` | 容器内监听端口；compose 只映射到 `127.0.0.1:8081` |
| `HOST` | `0.0.0.0` | 容器内必须是这个，反代从容器外连入 |
| `TRUST_PROXY` | `false`（线上设 `true`） | 信任反代下发的 `X-Forwarded-*` |
| `DATA_DIR` | `./data`（镜像内 `/data`） | SQLite 所在目录 |
| `LOG_LEVEL` | `info` | pino 级别 |
| `JIZHANG_USERNAME` | **必需** | 单用户登录名 |
| `JIZHANG_PASSWORD_HASH` | **必需** | 占位即可，真实密码用 `set-password` 写入数据库 |
| `SESSION_TTL_DAYS` | `30` | 会话有效期 |
