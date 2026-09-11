# jizhang 记账

单用户记账 Web PWA:Vue 3 + Vite 前端、Fastify 后端、SQLite 存储,**单容器**部署(后端同源托管前端产物)。

> 当前状态:**T1 项目骨架与部署底座**。只有健康检查接口和一个连通性验证页;
> 业务表、认证、真实页面、PWA 分别在 T2/T3/T4/T9。

## 目录结构

```
jizhang/
├─ pnpm-workspace.yaml        # workspace: packages/*
├─ package.json               # 根脚本 dev / build / test / lint / typecheck
├─ tsconfig.base.json         # 三包共享的严格模式 TS 基础配置
├─ eslint.config.mjs          # 根 ESLint(TS + Vue essential),Prettier 管格式
├─ Dockerfile                 # 多阶段:builder → runtime(同一基础镜像)
├─ docker-compose.yml         # 只发布 127.0.0.1:8081
├─ .env.example               # 全部环境变量 + 说明
└─ packages/
   ├─ shared/                 # 领域模型 + 纯函数(前后端共用,T5 起填充)
   ├─ server/                 # Fastify API + 静态托管
   │  └─ src/
   │     ├─ index.ts          # 启动 / 优雅退出
   │     ├─ app.ts            # Fastify 装配(可 inject 测试,不 listen)
   │     ├─ config.ts         # 环境变量解析与校验
   │     ├─ db/index.ts       # better-sqlite3 连接 + PRAGMA
   │     └─ ...
   └─ web/                    # Vue 3 + Vite
      └─ src/{main.ts,App.vue,styles/}
```

依赖方向:`web` / `server` → `shared`(`shared` 不依赖任何包,且不含 IO,
所以同一份代码能在浏览器里跑)。两个消费方在 T1 只是声明了依赖,
第一次真正 import 发生在 T5 预算引擎落地时。

## 环境要求

- Node.js ≥ 22.12(pnpm 10 的 `packageManager` 字段锁定 `pnpm@10.12.2`)
- Docker + Compose(可选,只用于容器验证)
- Windows / macOS / Linux 均可开发,部署目标是 Linux VPS

## 本地开发

```bash
pnpm install
cp .env.example .env      # 本地首次运行必需

pnpm dev                  # 并行:Fastify(8081) + Vite(5173)
```

- 前端 <http://127.0.0.1:5173>,`/api` 由 Vite 代理到 `127.0.0.1:8081`
- 后端 <http://127.0.0.1:8081/api/v1/health>
- `.env` 只在 `NODE_ENV !== production` 时被读取(见 `packages/server/src/index.ts`)

常用命令(全部递归到三个包):

```bash
pnpm build        # shared → web → server(拓扑顺序)
pnpm typecheck    # tsc / vue-tsc --noEmit
pnpm lint         # ESLint
pnpm test         # vitest(server)
pnpm format       # Prettier
```

## 容器运行

```bash
cp .env.example .env                 # 必须:.env 提供 JIZHANG_USERNAME 等必需变量
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
```

浏览器打开 <http://127.0.0.1:8081/> 应看到页面,并且 health 结果显示 `ok`。

```bash
docker compose ps                    # STATUS 应显示 (healthy)
docker compose logs -f jizhang
docker compose down
```

### 端口与反代共存(重要)

`docker-compose.yml` 只发布 `127.0.0.1:8081`,**绝不占用公网 80/443**——
宿主机上已有的 Nginx/Caddy 继续终止 TLS。只需给它加一个上游:

```nginx
location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

容器内 `TRUST_PROXY=true`(compose 默认值),Fastify 才会信任上面这些头。

### 数据目录

`DATA_DIR` 默认 `/data`,由 compose 的**命名卷** `jizhang-data` 承载:
命名卷会用镜像里 `/data` 的属主初始化,非 root 的 `node` 用户因此可以写
SQLite 文件与 WAL 边车文件,新机器上 `docker compose up -d` 开箱即用。

如果想改成宿主机目录(方便直接备份),把 compose 里的卷换成 bind mount:

```yaml
volumes:
  - ./data:/data
```

并在**首次启动前**在宿主机上建目录并交给 uid 1000(容器内 `node` 的 uid):

```bash
mkdir -p data && sudo chown -R 1000:1000 data
```

否则容器会以 `SQLITE_CANTOPEN` 之类的权限错误退出。

### 环境变量

全部变量及说明见 [`.env.example`](./.env.example)。几个关键点:

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `JIZHANG_USERNAME` | ✅ | — | 单用户登录名 |
| `JIZHANG_PASSWORD_HASH` | ✅ | — | 密码的 argon2id 哈希(不是明文) |
| `DATA_DIR` | | `./data`(容器 `/data`) | SQLite 所在目录 |
| `PORT` | | `8081` | 容器内监听端口 |
| `HOST` | | `0.0.0.0` | 容器内必须绑 0.0.0.0 |
| `TRUST_PROXY` | | `false`(compose `true`) | 信任反代下发的 `X-Forwarded-*` |
| `LOG_LEVEL` | | `info` | pino 日志级别 |
| `SESSION_TTL_DAYS` | | `30` | 会话有效期(T3 使用) |
| `WEB_DIST_DIR` | | `packages/web/dist` | 静态产物目录(镜像内 `/app/public`) |

必需变量缺失或取值非法时,服务**启动即失败**并打印一份可读的问题清单后退出 1:

```
[jizhang] Startup aborted — configuration error

The server refused to start: the configuration is invalid.

  - JIZHANG_USERNAME is required but is not set (...)
  - JIZHANG_PASSWORD_HASH is required but is not set (...)

See .env.example for every variable, its default and its meaning.
```

### 原生模块注意事项

`better-sqlite3` 是 C++ 原生扩展,镜像构建有三条硬约束,改动 Dockerfile 时不要破坏:

1. builder 与 runtime 使用**同一基础镜像** `node:22-bookworm-slim`(ABI/libc 一致);
2. `pnpm install` **不能**加 `--ignore-scripts`(否则跳过原生模块构建);
3. `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 必须保留 `better-sqlite3`
   (pnpm 10 默认不执行依赖的安装脚本)。

容器内验证:

```bash
docker compose exec jizhang node -e "require('better-sqlite3'); console.log('ok')"
docker compose exec jizhang whoami     # → node(非 root)
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | `{status, version, uptime}`,免认证,容器 HEALTHCHECK 使用 |

错误契约统一为 `{"error":{"code":"...","message":"..."}}`;
`/api/**` 未匹配路由返回 **JSON 404**,不会被 SPA fallback 吞掉;
其余未匹配路径返回 `index.html`(交给前端路由)。

## 下一步

- T2 数据库 schema 与迁移
- T3 认证(一次性 CLI 设置密码)
- T4/T5 记账与预算引擎
- T9 PWA(T10 上线)
