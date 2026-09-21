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

**`.env` 里不要放明文密码。** 需要这几项：

```
JIZHANG_USERNAME=admin
JIZHANG_PASSWORD_HASH=placeholder-required-to-boot-but-never-read
SESSION_TTL_DAYS=30
LOG_LEVEL=info
TRUST_PROXY=true
TZ=Asia/Shanghai
# Optional: 64 hex chars (32 bytes) to encrypt the AI provider key saved in Settings.
JIZHANG_AI_ENCRYPTION_KEY=
```

⚠️ **`TZ` 必须是用户日历时区**（中国用 `Asia/Shanghai`）。容器默认 UTC 时，北京时间 9/10 00:00 会被算成 9/9，工资被划进上一预算周期，当期「已用」会一直是 0。生产 compose 的 `environment` 里也应有 `TZ: Asia/Shanghai`。

⚠️ **`JIZHANG_PASSWORD_HASH` 必须存在，否则容器起不来**——它在 `config.ts` 的 `REQUIRED`
列表里，缺失时服务打印配置错误并退出 1，容器会一直在 `Restarting`。但它的**值不参与任何逻辑**
（`config.passwordHash` 被读进配置后无人使用），所以随便填一个占位串即可。

AI provider 的 API key 通过应用内「我的 → AI 助手」配置，但只有设置了
`JIZHANG_AI_ENCRYPTION_KEY` 才能保存或使用密钥。该密钥不写入 SQLite 备份；如果更换或丢失，
数据库里的旧 provider 密文将无法解密，需要重新输入 API key。生成命令：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

> 真正用于登录的凭据在数据库的 `users` 表里，只有下面这条命令会写它：
>
> ```bash
> docker compose exec -it jizhang node packages/server/dist/cli.js set-password
> ```
>
> 注意两点，都会直接导致「密码设了但登不进去」：
> 1. **必须带 `-it`**。它关掉回显读密码，没有 TTY 就报错退出；`docker compose exec` 不加 `-t`
>    同样不行。
> 2. **路径是 `packages/server/dist/cli.js`**（镜像里只有编译产物，没有 `src/`）。

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

### 4.4 如果反代跑在**容器里**（先分清你属于哪种）

上面的 `reverse_proxy 127.0.0.1:8081` 只在 **Caddy 直接跑在宿主机上**时成立。如果 Caddy 是个
容器，**它够不到宿主机的 `127.0.0.1:8081`**：容器里的 `host.docker.internal` 解析到的是 docker
网桥地址（如 `172.17.0.1`），那个地址到达的是宿主的 `docker0` 接口，**不是宿主回环**。这正是
很多「端口明明通了、反代就是 502」的根因。

先确认自己属于哪种，以及 jizhang 该用哪个上游：

```bash
docker ps --filter name=caddy --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker network ls
docker inspect caddy --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n'
docker inspect caddy --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

三种可行接法，**按推荐度排序**：

**① 让 jizhang 加入 Caddy 所在的网络（推荐，端口完全不暴露）**

在 jizhang 的 `docker-compose.yml` 里把发布端口去掉，改成加入那个外部网络：

```yaml
services:
  jizhang:
    # 不再写 ports: —— 没有宿主机端口，也就没有公网暴露面
    networks:
      - proxy

networks:
  proxy:
    external: true
    name: <上一步查到的 caddy 所在网络名>
```

Caddyfile 里写**容器名**，不用 `host.docker.internal`：

```
jz.example.com {
    reverse_proxy jizhang:8081
}
```

> 前提：Caddy 与 jizhang 在同一个 network 上。若 Caddy 用的是它自己 compose 默认创建的网络，
> 上面的 `name:` 就是那个（通常是 `<目录名>_default`）。

**② 把 Caddy 接进 jizhang 的网络（不改动现有 compose）**

如果不想动 jizhang 的 compose，也可以反过来把**正在运行**的 Caddy 挂到 jizhang 网络上——
`docker network connect` 是热操作，不需要重启 Caddy：

```bash
docker network connect <jizhang 的网络名> caddy
```

**③ 绑 0.0.0.0（能用，但不推荐）**

把 jizhang 的端口从 `127.0.0.1:8081:8081` 改成 `8081:8081`，Caddy 用
`reverse_proxy host.docker.internal:8081`。代价是**端口直接暴露在公网**上，绕过 TLS——能不用
就不用。

不论哪种，改完都要：

```bash
# 在容器里校验并 reload（路径用前面 .Mounts 查到的那条）
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload   --config /etc/caddy/Caddyfile
```

### 4.5 改完立刻做的事

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

> 下面每条命令都是 2026-09-13 那次真实升级（账户余额 + 转账，迁移 003/004）里跑过的，
> 不是示意。当时的结果：`migrationsApplied: [3,4]`，自动备份落在 `/data/backups/`。

### 更新

**不要用 `tar -czf` 包 `docker save` 的输出。** 那会得到「tar 里套 tar」，而 `gunzip -c x.tar.gz | docker load`
会去读外层 tar 然后失败或挂住——2026-09-13 就是这么把机器搞停过一次。`docker save` 出来的已经是一个
OCI 归档，里面的层本身就是压缩的，**再压一遍没有收益**。

```bash
# ── 本地：构建、打标签、导出（不压缩）

docker compose build
docker tag jizhang:latest jizhang:2026-09-13-2          # 用日期或 commit 短哈希，别用 latest
docker save -o jizhang.tar jizhang:2026-09-13-2

# 确认是 OCI 归档而不是套娃：应看到 manifest.json / blobs/sha256/…，且没有 *.tar
tar -tf jizhang.tar | head -5
tar -tf jizhang.tar | grep -c '\.tar$'                  # 必须是 0

sha256sum jizhang.tar                                   # 记下来，传完在服务器上核对
```

```bash
# ── 服务器：核对、加载、切标签

# 0. 先看内存和 swap。swap 为 0 且 available 很低时，先清理构建缓存：
docker builder prune -f
free -m && df -h /

# 1. 传上来之后先验完整性（这一步能省掉一整轮"到底哪里坏了"）
sha256sum -c <<< "<本地算出的哈希>  /root/jizhang.tar"

# 2. 从磁盘加载，不要用管道
docker load -i /root/jizhang.tar

# 3. 改 compose 的 tag，然后重建
cd /opt/jizhang
cp -n docker-compose.yml docker-compose.yml.bak-$(date +%F)
sed -i 's|^    image: jizhang:.*$|    image: jizhang:2026-09-13-2|' docker-compose.yml
docker compose up -d
```

**验证（不要只看容器起来了）**：

```bash
docker compose ps                                     # 必须 (healthy)
docker compose logs jizhang --since 3m | grep 'sqlite ready'
#   → 期望看到 "migrationsApplied":[3,4] 和 "backupPath":"/data/backups/jizhang-….db"
#     这两个字段就是「迁移跑了」和「迁移前有备份」的证据。
docker exec jizhang node -e "
const D=require('/app/packages/server/node_modules/better-sqlite3');
const db=new D(process.env.DATA_DIR+'/jizhang.db',{readonly:true});
console.log(db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all());
console.log(db.prepare('SELECT name,initial_balance_cents FROM accounts WHERE deleted=0').all());
"
curl -s -o /dev/null -w '%{http_code}\n' https://你的域名/api/v1/health     # 200
```

**升级后要确认前端也换了**。镜像里烤的是构建期的 `packages/web/dist`，只重启容器不会有新前端。
SPA 是按路由分包的，所以要**在所有 chunk 里**找标记，只在 `index-*.js` 里找会误判：

```bash
docker exec jizhang sh -c 'ls /app/public/assets/*.js | wc -l'
docker exec jizhang sh -c "grep -l 'asset-total' /app/public/assets/*.js"   # 新页面所在的 chunk
```

### 回滚

镜像级回滚，秒级，不动数据库：

```bash
cd /opt/jizhang
sed -i 's|^    image: jizhang:.*$|    image: jizhang:2026-09-13|' docker-compose.yml
docker compose up -d
```

**回滚前不要把旧镜像删掉**——保留它才有这条路。`docker load` 新镜像不会覆盖旧 tag，所以旧的会自然留着；
`docker image prune -a` 会把它删掉，别随手跑。

数据库迁移**只增不改**：003 只加了一列（带常量默认值），004 只加了一张表。旧代码不认识它们也能正常读写，
所以代码回滚不需要降级迁移。

真要恢复数据库（不是回滚代码）才需要动 `/data`，那走 §5.4 的恢复流程，并且**必须停服**。

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
| 登录一直 401 | 账户还没设置：`docker compose exec -it jizhang node packages/server/dist/cli.js set-password`。用 `docker compose logs jizhang \| grep 'login rejected'` 看 `reason`：`no-user` = 还没建账户，`wrong-password` = 密码不对 |
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
| `JIZHANG_AI_ENCRYPTION_KEY` | 可选 | 64 位十六进制；加密设置页保存的 AI API key |
