# jizhang 记账

单用户记账 Web PWA:Vue 3 + Vite 前端、Fastify 后端、SQLite 存储。Fastify 同源托管前端；物品自动抠图由一个**可选、私有、资源受限的 CPU 推理服务**处理。

> 当前状态:**已部署到 `https://jz.yansuu1.com`**(镜像 `jizhang:2026-09-18-home-balances`,迁移 v6 已执行;容器 `TZ=Asia/Shanghai`)。
> 日常用法请看 [USAGE.md](./USAGE.md);部署与升级请看 [DEPLOY.md](./DEPLOY.md)。

## 功能

按**信封预算法**记账:每月工资按模板分配到各分类模块,日常支出从模块额度里扣,超支从累积
结余池借用。

- **账单**:记收入/支出、多账户、标签、退款(**收入**下勾选,计入收入,可关联/搜索原始支出)、按月筛选
- **预算**:工资录入 + 分配模板(比例和必须为 100%)、模块已用/剩余、80%–100% 预警与超支提示、
  累积结余池、**历史周期回看**、周期区间与未纳入支出提示
- **周期账单**:房租/订阅这类固定账单按日/周/月/季/年自动到期,到期后进入**待确认**由你确认,
  不静默入账
- **统计**:分类占比环形图(中心总额 + 图例金额/占比)、月度收入与净支出柱状图、结余池趋势
- **回收站**:删除的账单可恢复,或彻底删除
- **数据**:
  - CSV 导出/导入(账单、转账、工资、周期规则,带 BOM,Excel 直接打开中文不乱码)
  - **微信/支付宝账单导入**:上传平台导出文件(xlsx / GBK CSV),自动识别来源、过滤提现理财与「不计收支」;**预览明细表 → 勾选 → 改分类 → 确认导入所选**;自动创建「微信」「支付宝」账户,按交易单号幂等去重
  - 整库备份(SQLite 快照)
- **AI 助理**:独立对话工作区支持账本查询、月度评价、分类整理预览和自然语言记账；每次写入都先展示确认卡。支持在对话中预览微信/支付宝账单并选择导入行；历史保存在服务端，附件原始字节只在当前页面内存中保留
- **物品资产**:记录持有物品、购入时间与价格、使用状态和日均成本；可关联已有账单，但不会自动新增账单，也不纳入账户余额或收支统计
- **物品自动抠图**:物品表单可生成透明背景候选并由用户确认；推理服务只提供未标注区域，不判断物品类别。原图及候选临时保存在私有容器的内存盘，只有用户选定并保存后才进入现有物品照片存储；服务不可用时普通上传仍可用
- **外观**:深浅色(跟随系统/浅色/深色)、三套主色预设(钛蓝/森林绿/极简黑白)
- **PWA**:可"添加到主屏幕"作为独立 App 使用,离线可查看已打开的页面

### 微信 / 支付宝账单导入(速查)

| 项 | 说明 |
|---|---|
| 入口 | **我的 → 导出与备份 → 微信/支付宝 →「打开导入面板」**（独立弹窗，避免数据页被表格撑长） |
| 流程 | 选文件 → **预览**（明细表）→ **勾选** → **改分类** → **确认导入所选** |
| 重复 | 平台单号已入账 → 不可选；同账户同日同类型同金额（如手记账单）→ 标「可能重复」并默认不勾选 |
| 来源 | 自动识别 / 微信 / 支付宝 |
| 微信 | 账单页 →「···」→ 下载账单,得到 `.xlsx` 或 CSV |
| 支付宝 | 账单 → 开具交易流水证明,得到 **GBK** `.csv`;直接上传原文件,勿用 Excel 另存 |
| 过滤 | 提现/充值/理财/零钱通、支付宝「不计收支」「投资理财」「信用借还」、已退款、0 元、失败状态 |
| 分类 | 默认关键字粗分;预览表可逐行改分类,导入后也可再改 |
| 去重 | 稳定 id:`wx-<交易单号>` / `ali-<交易订单号>`,已存在行不可勾选,重复导入不重复入账 |
| API | `POST /api/v1/import/platform-bills`;JSON body:`fileBase64` + `source` + `dryRun` + `selectedIds` + `categoryOverrides` |

更完整的导出步骤与过滤说明见 [USAGE.md §12](./USAGE.md)。

## 口径与日历(重要)

这些规则决定首页/账单/预算/统计里的数字是否对得上,改代码时不要各算各的。

| 主题 | 规则 |
|---|---|
| **退款** | 记在**收入**下并勾「退款」;计入收入与账户余额,**不冲减**模块/分类的毛支出 |
| **支出聚合** | `expenseContribution`:仅 `type=支出` 计 `+amount`;退款(收入)贡献为 0 |
| **收入聚合** | `incomeContribution`:收入 `+amount`(**含退款**);支出为 0 |
| **预算周期(起始日模式)** | 工资/分配归属**发薪日所在自然月**的起算日(`allocationPeriodStart`):起算日 10 时,9/10 记的工资供 **9/10–10/9** 周期 |
| **账单入周期** | 支出落在 `[周期起点, 下一周期起点)`;起算日**之前**的支出不进本周期已用 |
| **时区** | 服务端按本地日算账单/周期。容器**必须**设 `TZ`(`Asia/Shanghai`)。默认 UTC 会把北京时间 9/10 00:00 算成 9/9,导致工资被划进上一周期、当期已用为 0 |
| **转账** | 不算收入也不算支出,只改两个账户余额 |

`packages/shared` 是这些规则的唯一实现(无 IO);web/server 都调用它,禁止在视图里手写聚合。

## 在 iPhone 上使用

首次部署完成后,在 Safari 打开站点 → 分享 → **添加到主屏幕**。之后从主屏幕图标打开即是
独立 App 观感(应用内也会提示这一步,点 ✕ 可永久关闭)。

**离线只能看,不能记**:记账需要联网。断网或服务端不可达时顶部会出现提示条,已填写的表单
内容不会丢失,恢复联网后点保存即可(不会重复记账)。详见 [USAGE.md](./USAGE.md)。

## 目录结构

```
jizhang/
├─ pnpm-workspace.yaml        # workspace: packages/*
├─ package.json               # 根脚本 dev / build / test / lint / typecheck / test:iphone
├─ tsconfig.base.json         # 三包共享的严格模式 TS 基础配置
├─ eslint.config.mjs          # 根 ESLint(TS + Vue essential),Prettier 管格式
├─ Dockerfile                 # 多阶段:builder → runtime(同一基础镜像)
├─ docker-compose.yml         # 只发布 127.0.0.1:8081;默认 TZ=Asia/Shanghai
├─ .env.example               # 全部环境变量 + 说明
├─ DEPLOY.md                  # 部署到 VPS(含反代共存、备份与回滚)
├─ USAGE.md                   # 面向使用者的日常用法
└─ packages/
   ├─ shared/                 # 领域模型 + 纯函数(预算引擎、周期日期、CSV、色板、平台账单解析)
   │  ├─ src/                 # 无 IO,所以同一份代码能在浏览器里跑
   │  │  └─ platform-bills.ts # 微信/支付宝账单:表头定位、过滤、关键字分类、稳定 id
   │  └─ test/                # vitest:预算引擎、周期、CSV、色板、平台账单、预算完整性
   ├─ server/                 # Fastify API + 静态托管
   │  ├─ src/
   │  │  ├─ index.ts          # 启动 / 优雅退出
   │  │  ├─ app.ts            # Fastify 装配(可 inject 测试,不 listen;text/csv 与 octet-stream)
   │  │  ├─ config.ts         # 环境变量解析与校验
   │  │  ├─ cli.ts            # set-password / backup / verify / restore
   │  │  ├─ db/               # better-sqlite3 连接、PRAGMA、迁移
   │  │  ├─ plugins/          # 会话、CSRF、静态托管等 Fastify 插件
   │  │  ├─ routes/           # auth / transactions / budget / master-data /
   │  │  │                    # stats / trash / recurring / portability
   │  │  │                    # (portability 含 POST /import/platform-bills)
   │  │  └─ services/         # 业务逻辑;bill-decode / xlsx-lite 解 GBK 与微信 xlsx
   │  ├─ test/                # vitest(14 个套件,含 platform-import)
   │  ├─ test/fixtures/       # 真实结构的微信/支付宝样例(已脱敏)
   │  └─ scripts/             # 容器内 e2e 套件(e2e-*.mjs,13 个)
   ├─ cutout/                 # 私有 CPU 图像抠图服务(SAM 2.1;无公网端口)
   │  ├─ app/                 # FastAPI、临时任务队列、限额与候选生成
   │  └─ tests/               # 服务契约与临时图片生命周期
   └─ web/                    # Vue 3 + Vite
      ├─ src/
      │  ├─ api/              # 类型化 API 客户端(含 importPlatformBills,原始字节上传)
      │  ├─ components/       # DonutChart / BarChart / TransactionDetailModal / OfflineBanner / InstallHint
      │  ├─ composables/      # useTheme / useNetwork
      │  ├─ router/           # 路由与登录门禁
      │  ├─ stores/           # Pinia:auth / budget / meta / transactions
      │  ├─ styles/main.css   # 主题令牌(颜色、动效、高度)
      │  ├─ utils/            # budget-tone / category-color / money
      │  └─ views/            # 19 个视图(含 AppShell;DataView 含平台账单导入)
      ├─ e2e/                 # Playwright:iPhone 视口下的真实表单链路
      └─ scripts/             # 构建期静态审计 + 浏览器实测套件 + 图标生成
```

- `shared` **无 IO**:同一份代码能在浏览器里跑;预算/退款/周期规则只在这里实现一次。

## 环境要求

- Node.js ≥ 22.12(pnpm 10 的 `packageManager` 字段锁定 `pnpm@10.12.2`)
- Docker + Compose(容器运行与容器内 e2e 需要)
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
pnpm build        # shared → web → server;web 构建会跑四项静态审计(见下)
pnpm typecheck    # tsc / vue-tsc --noEmit
pnpm lint         # ESLint
pnpm test         # vitest(shared + server)
pnpm format       # Prettier
```

## 容器运行

```bash
cp .env.example .env                 # 必须:.env 提供 JIZHANG_USERNAME 等必需变量
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
```

浏览器打开 <http://127.0.0.1:8081/> 应看到登录页。首次登录前需要设置密码:

```bash
docker compose exec -it jizhang node packages/server/dist/cli.js set-password
```

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

容器内 `TRUST_PROXY=true`(compose 默认值),Fastify 才会信任上面这些头。完整流程见 [DEPLOY.md](./DEPLOY.md)。

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
| `TZ` | | `Asia/Shanghai`(compose/Dockerfile) | **账单日历与预算周期按此本地日计算**;勿用 UTC |
| `TRUST_PROXY` | | `false`(compose `true`) | 信任反代下发的 `X-Forwarded-*` |
| `LOG_LEVEL` | | `info` | pino 日志级别 |
| `SESSION_TTL_DAYS` | | `30` | 会话有效期 |
| `WEB_DIST_DIR` | | `packages/web/dist` | 静态产物目录(镜像内 `/app/public`) |
| `JIZHANG_AI_ENCRYPTION_KEY` | | — | 64 位十六进制(32 字节),用于加密设置页保存的 AI API key;不配置则 AI 不可用 |
| `JIZHANG_ITEM_CUTOUT_SERVICE_URL` | | 未配置 | 私有抠图 worker 地址；Compose 内部自动配置，普通照片上传不依赖此服务 |

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

## 测试与质量门

四条互相不可替代的验证线。**改任何一层都要跑对应的那条**,不要只看单测。

| 命令 | 覆盖 | 需要 |
|---|---|---|
| `pnpm lint && pnpm typecheck && pnpm test` | 三个包的静态检查与单测 | 无 |
| `pnpm build` | 构建 + **四项静态审计** | 无 |
| 容器内 e2e(下表) | 真实 HTTP 契约与全链路 | Docker 容器在跑 |
| `node scripts/render-*.mjs` | 真实浏览器渲染、对比度、动效 | 容器 + Chrome |
| `pnpm test:iphone` | iPhone 视口下的真实表单链路 | Playwright 浏览器 |

**`pnpm build` 里的四项静态审计**(构建期强制,失败即构建失败):

- `check-mobile.mjs` — 触摸目标 ≥44px、输入字号 ≥16px、安全区、375px 无横向溢出
- `check-motion.mjs` — 无 `transition: all`、无 `linear`、无字面量时长、无布局属性动画、
  关键帧与令牌全部有定义且被引用、减少动效覆盖完整
- `check-color.mjs` — 组件内无颜色字面量、令牌两两引用一致、明暗两套块逐字相同、
  三套主色预设只覆盖 accent、2 主题 × 3 预设对比度矩阵、分类色板六检、
  manifest/meta/图标/主题脚本同源
- `check-pwa.mjs` — manifest、图标尺寸、service worker、缓存策略、包体积

PWA 包体积按 `dist/` 中未压缩文件合计检查，预算为 JS < 320 KiB、CSS < 80 KiB。当前构建实测 JS 307,547 B (300.34 KiB)、CSS 81,712 B (79.80 KiB)，均在预算内；本次不做额外包体积裁剪。

**容器内 e2e 套件**(13 个,需先 `docker compose up -d`):

```bash
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-home.mjs
# 换成 e2e-auth / e2e-budget / e2e-master-data / e2e-periods / e2e-portability /
#      e2e-pwa / e2e-recurring / e2e-stats / e2e-transactions / e2e-trash /
#      e2e-backup / e2e-transfers
```

这些套件会**清空容器内的数据库并重设密码**,只对开发容器使用,不要对存有真实账本的实例运行。

**浏览器实测套件**(在 `packages/web` 下,复用 CDP 驱动):

```bash
node scripts/render-dashboard.mjs out.png   # 还有 render-trash / render-budget /
                                            # render-recurring / render-theme /
                                            # render-motion / render-color
```

**iPhone 隔离 e2e**(Playwright,每个用例自建 HTTP 监听与临时数据库,
不碰 `.env` / `data/` / 容器):

```bash
pnpm test:iphone              # = pnpm build && playwright test(chromium + webkit)
pnpm test:iphone:only         # 跳过构建
```

> Playwright 的浏览器需要 `npx playwright install`。若所在网络下载不了,
> 可用 `JIZHANG_E2E_CHANNEL=chrome pnpm test:iphone:only` 退回本机 Chrome 跑 chromium 项目
> ——它**不能**替代 webkit 项目,即最接近 iOS Safari 的那一层。
>
> CDP 驱动默认用 9222 端口,可用 `JIZHANG_CDP_PORT` 改,避免与被占用的端口冲突。

## API

所有端点前缀 `/api/v1`(下表的路径都省略了这个前缀),统一错误契约
`{"error":{"code":"...","message":"..."}}`;
`/api/**` 未匹配路由返回 **JSON 404**,不会被 SPA fallback 吞掉;其余未匹配路径返回
`index.html`(交给前端路由)。除 `health` 与 `auth/login` 外均需会话 Cookie。

| 资源 | 端点 |
|---|---|
| 健康 | `GET /health`(免认证,容器 HEALTHCHECK 使用) |
| 认证 | `GET /auth/me`、`POST /auth/login`、`POST /auth/logout`、`POST /auth/password`(改密码会使所有会话失效) |
| 账单 | `GET/POST /transactions`、`GET/PATCH/DELETE /transactions/:id` |
| 回收站 | `GET /trash`、`POST /trash/:id/restore`、`POST /trash/restore-all`、`DELETE /trash/:id`(彻底删除)、`DELETE /trash`(清空) |
| 预算 | `GET /budget/overview`(可带 `periodStart` 回看历史周期)、`GET /budget/periods` |
| 工资 | `GET/POST /salaries`、`GET/PATCH/DELETE /salaries/:id`、`PUT /salaries/:id/allocations`(`accountId` 必填:工资必须指定收款账户) |
| 模板 | `GET/POST /templates`、`PATCH/DELETE /templates/:id`、`POST /templates/:id/default` |
| 分类 | `GET/POST /categories`、`PATCH/DELETE /categories/:id`、`POST /categories/:id/move`、`GET /categories/:id/usage` |
| 账户 | `GET/POST /accounts`、`PATCH/DELETE /accounts/:id`、`POST /accounts/:id/move`、`GET /accounts/:id/usage` |
| 余额 | `GET /accounts/balances` —— 每个活账户的余额 + 资产总额,由服务端派生(余额不落库) |
| 转账 | `GET/POST /transfers`、`GET/PATCH/DELETE /transfers/:id`(可带 `?accountId=` 只看某一侧)。转账**不算收入也不算支出**,只改两个账户的余额 |
| 标签 | `GET /tags`、`PATCH /tags`(重命名)、`DELETE /tags/:id` |
| 周期账单 | `GET/POST /recurring/rules`、`PATCH/DELETE /recurring/rules/:id`、`POST /recurring/rules/:id/enabled`、`POST /recurring/generate`、`GET /recurring/occurrences`、`POST /recurring/occurrences/:id/confirm`、`POST /recurring/occurrences/:id/ignore`、`GET /recurring/pending` |
| 统计 | `GET /stats/category-share`、`GET /stats/monthly-trend`、`GET /stats/month-window`、`GET /stats/pool-trend`、`GET /stats/range` |
| AI 设置与兼容接口 | `GET/PUT /ai/config`、`POST /ai/test`、`POST /ai/transaction-draft`、`POST /ai/monthly-evaluation`、`POST /ai/organization-preview|apply|undo`; API key 只在服务端加密保存 |
| AI 对话 | `GET/POST /assistant/conversations`、`GET/POST /assistant/conversations/:id/messages`、`POST /assistant/actions/:id/confirm|cancel`、`DELETE /assistant/conversations/:id`;写入计划必须显式确认，历史只保存有界文本/卡片与附件摘要 |
| 导出 | `GET /export/transactions.csv`、`GET /export/salaries.csv`、`GET /export/recurring.csv`、`GET /export/transfers.csv` |
| 导入(本应用 CSV) | `POST /import/transactions`、`POST /import/transfers`(`Content-Type: text/csv`,body 为文件全文) |
| 导入(微信/支付宝) | `POST /import/platform-bills`。JSON:`{ fileBase64, source, dryRun, fileName?, selectedIds?, categoryOverrides? }`；也支持 octet-stream/text 原文 + query。`selectedIds:null`=全部可入账，`[]`=不导入；`categoryOverrides` 为 `{行id: 分类名}`。dry-run 返回 `rows` 明细表 |
| 备份 | `GET /backups`、`POST /backups` |
| 设置 | `GET /settings`、`PUT /settings`(预算周期起点) |

CLI(`packages/server/dist/cli.js`):

```
set-password                 创建或轮换登录密码(交互式,需终端)
backup <dir> [retain-days]   把数据库快照到 <dir>(默认保留 30 天)
verify <file.db>             检查备份文件是否是可用的数据库
restore <file.db>            用备份替换在线数据库
```

## 部署与运维要点

- 线上:`https://jz.yansuu1.com`,目录 `/opt/jizhang`,镜像 `jizhang:2026-09-18-home-balances`。
- 升级见 [DEPLOY.md §6](./DEPLOY.md):构建镜像 → 改 compose 的 `image` tag → `up -d` → 核对 `sqlite ready`、`/api/v1/health` 与前端 chunk 标记。
- **公网带宽很慢时**优先「上传源码 zip → 在服务器 `docker build`」(约 0.5–1.5MB),不要 `docker save` 整镜像(约 90MB+)。生产 compose 无 `build:`、无宿主机端口,由 Caddy 按容器名 `jizhang:8081` 反代。
- 容器环境必须含 **`TZ: Asia/Shanghai`**(见「口径与日历」)。生产 compose、仓库 `Dockerfile` / `docker-compose.yml` / `.env.example` 均已默认写入。
- 迁移会在启动时自动跑,并把升级前的库备份到 `/data/backups/`。回滚只改 `image` tag,不降级迁移。
- 平台账单导入**无新迁移**;误导入可在应用内删除或走回收站/备份恢复。

已知限制(有意如此,不是遗漏):

- **不做系统通知/Web Push**:iOS 上 PWA 无可靠的本地通知等价物,到期提醒改为应用内"待确认"
- **不做应用锁 PIN**:客户端 PIN 不是安全边界,真正的边界是登录密码与会话(用户已确认删除)
- **不支持多用户、多币种、共享账本、日历视图、批量操作、账单模板**——单用户单账本
- **平台账单分类是关键字粗分**,不是平台官方分类的逐条映射;分不准会落到「其他」,导入后可改
- **平台导入不改写既有本应用 CSV 导入**:两者 id 空间与校验策略不同(平台按行忽略,本应用 CSV 全有或全无)
