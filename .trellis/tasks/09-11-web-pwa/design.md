# 技术设计 · 记账 Web PWA

> 归属父任务 `.trellis/tasks/09-11-web-pwa`。本文只讲技术设计;需求与验收见 `prd.md`。
> 凡引用参考项目源码的地方均为**已核对的事实**,带 `文件:行` 锚点。

## 1. 架构总览

```
                    iPhone Safari (PWA, 已加桌面)
                              │  HTTPS
                              ▼
              ┌───────────────────────────────┐
              │  VPS 上已有的 Nginx / Caddy    │  ← 用户已有,终止 TLS
              │  (不动 80/443)                 │
              └───────────────┬───────────────┘
                              │ proxy_pass → 127.0.0.1:8081
                              ▼
              ┌───────────────────────────────┐
              │  jizhang 容器 (Docker Compose) │
              │  ┌─────────────────────────┐  │
              │  │ Fastify (Node 22)       │  │
              │  │  /api/**  → 路由        │  │
              │  │  /**      → 静态资源     │  │  ← 前端产物同容器托管
              │  └───────────┬─────────────┘  │
              │              │ better-sqlite3 │
              │  ┌───────────▼─────────────┐  │
              │  │ /data/jizhang.db (卷)   │  │  ← 宿主机卷持久化
              │  └─────────────────────────┘  │
              └───────────────────────────────┘
```

**单容器**而非前后端两容器。理由:

- 1核1G/2核2G 的 VPS 上,少一个容器 = 少一份 Node 运行时与内存开销
- 前端是纯静态产物,由 Fastify 的静态插件托管即可,**同源**省掉 CORS 配置与预检请求
- 反代只需转发一个上游端口,共存配置最简单

## 2. Monorepo 结构

用 pnpm workspace。理由:预算引擎的前后端类型契约必须共享,而参考项目里 `budget_engine.dart` 是纯函数、可无副作用单测(`budget_engine.dart:22` 注释声明的设计意图),复刻为共享包能同时在前后端复用与测试。

```
jizhang/
├─ pnpm-workspace.yaml
├─ package.json                  # 根脚本: dev / build / test / lint
├─ docker-compose.yml
├─ Dockerfile                    # 多阶段: build → runtime
├─ .env.example
├─ packages/
│  ├─ shared/                    # 领域模型 + 纯函数 + 常量 (前后端共用)
│  │  └─ src/
│  │     ├─ money.ts             # 分/元换算,格式化
│  │     ├─ budget-engine.ts     # 信封预算引擎(纯函数,复刻参考实现)
│  │     ├─ period.ts            # cycleStartDay 周期边界计算
│  │     ├─ types.ts             # 领域类型(Transaction/Category/...)
│  │     └─ constants.ts         # 内建 id、枚举、预置种子数据
│  ├─ server/                    # Fastify 后端
│  │  └─ src/
│  │     ├─ index.ts             # 启动 + 静态托管 + 优雅退出
│  │     ├─ app.ts               # Fastify 实例装配(可测试)
│  │     ├─ config.ts            # 环境变量解析与校验
│  │     ├─ db/
│  │     │  ├─ index.ts          # better-sqlite3 连接 + PRAGMA
│  │     │  ├─ migrate.ts        # 版本化迁移执行器
│  │     │  └─ migrations/       # 001_init.sql, 002_*.sql ...
│  │     ├─ routes/              # auth / transactions / budgets / categories ...
│  │     ├─ services/            # 业务逻辑(可单测,不碰 HTTP)
│  │     └─ plugins/             # auth 守卫、错误处理、日志
│  └─ web/                       # Vue 3 前端
│     └─ src/
│        ├─ main.ts
│        ├─ App.vue
│        ├─ router/
│        ├─ stores/              # Pinia: auth / transactions / budget / meta
│        ├─ api/                 # 类型化 API 客户端
│        ├─ views/               # 各页面
│        ├─ components/          # 复用组件
│        └─ styles/
└─ .trellis/                     # 工作流(spec / tasks / workspace)
```

## 3. 数据模型(SQLite)

设计原则(继承参考项目已验证的决策):

- **金额一律 `INTEGER` 分** — `transaction.dart:11`,杜绝浮点误差(AC6)
- **主键为客户端生成的 UUID 文本** — 与参考实现一致,便于导入导出
- **软删除**:每张业务表带 `deleted INTEGER NOT NULL DEFAULT 0`
- **`updated_at` INTEGER(epoch ms)**:用于排序与将来的同步,本期不用于冲突解决
- **标签存 JSON 文本数组**,名字即身份 — `app_database.dart:97`
- **算法不物化**:不存模块余额与结余池,全部由 `budget-engine.ts` 实时派生

```sql
-- 001_init.sql (要点摘录,完整版在 T2 交付)

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- argon2id
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,          -- 只存 token 的 SHA-256,库泄露不可直接复用
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       INTEGER NOT NULL,          -- 0=expense 1=income
  icon       TEXT NOT NULL,
  color      INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  type                  INTEGER NOT NULL, -- 0现金 1储蓄卡 2信用卡 3支付宝 4微信 5其他
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_builtin            INTEGER NOT NULL DEFAULT 0,
  deleted               INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  type         INTEGER NOT NULL,        -- 0=expense 1=income
  amount_cents INTEGER NOT NULL,
  category_id  TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  date         INTEGER NOT NULL,        -- epoch ms
  note         TEXT NOT NULL DEFAULT '',
  tags_json    TEXT NOT NULL DEFAULT '[]',
  is_refund    INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_txn_date     ON transactions(date DESC);
CREATE INDEX idx_txn_category ON transactions(category_id);
CREATE INDEX idx_txn_account  ON transactions(account_id);

CREATE TABLE salary_records (
  id           TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  date         INTEGER NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE budget_allocations (       -- 一行 = 一个预算周期
  id                TEXT PRIMARY KEY,
  salary_record_id  TEXT NOT NULL,
  date              INTEGER NOT NULL,   -- 周期起始(发薪日)
  allocations_json  TEXT NOT NULL,      -- [{"categoryId","amountCents"}]
  deleted           INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE budget_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  modules_json TEXT NOT NULL,           -- [{"categoryId","ratio"}]
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 例: settings['budget.cycle_start_day'] = {"day": 15}

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

**取舍说明**:

| 选择 | 替代方案 | 为什么不用替代方案 |
|---|---|---|
| SQLite | Postgres | 单用户(D7)写入极少;Postgres 在 1G 内存上开销大,还多一个容器 |
| better-sqlite3 | Prisma / Drizzle | 同步 API 让事务与单测更简单;零 codegen,`--production` 镜像不需要 prisma engine,build 更小更快 |
| 存 `tags_json` | 标签关联表 | 复刻参考实现"名字即身份"语义,跨设备/导入导出天然合并,免关联查询 |
| 手写版本化迁移 | ORM 迁移工具 | 迁移极少且是一次性成本;省掉一整套工具链依赖 |

**SQLite PRAGMA(连接建立时设置)**:`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`。

## 4. 预算引擎移植(最高风险项)

这是全项目**最容易做错**的部分。参考实现的行为必须逐条复刻。

### 4.1 契约

```ts
// packages/shared/src/budget-engine.ts  (签名草案)

/** 周期模式:自然月 或 固定起始日 */
export type CycleConfig = { kind: 'natural-month' } | { kind: 'start-day'; day: number };

export interface ModuleView {
  categoryId: string;
  budgetCents: number;   // 本周期分配额
  spentCents: number;    // 周期内净消费
  remainingCents: number; // budget - spent
}

export function computeModuleViews(input: {
  allocationsDesc: BudgetAllocation[];   // 按 date DESC
  transactions: Transaction[];           // 含软删除行,内部过滤
  cycle: CycleConfig;
}): ModuleView[];

export function computeCarryoverPool(input: {
  allocationsDesc: BudgetAllocation[];
  transactions: Transaction[];
  currentModuleViews?: ModuleView[];
  cycle: CycleConfig;
}): number;

/** 含 date 的周期起点(短月 clamp 到月末) */
export function periodStartOf(cycle: CycleConfig, date: Date): string; // 'YYYY-MM-DD'
```

### 4.2 必须逐条复刻的规则(源码锚点)

1. **净额口径** — `budget_engine.dart:327` + `transaction.dart:46-51`
   ```ts
   const expenseContribution = (t) => t.type === 0 ? (t.isRefund ? -t.amountCents : t.amountCents) : 0;
   const incomeContribution  = (t) => t.type === 1 ? (t.isRefund ? 0 : t.amountCents) : 0;
   ```
   `_spentBetween` 累加的是 `expenseContribution`,**不是** `amountCents`(`budget_engine.dart:314-331`)。

2. **自然月模式**:按 `year*100+month` 分组降序(`budget_engine.dart:270`),当前组 = 最新一组;
   周期起点 = 组内**最早发薪日**(`_earliestDate`,`budget_engine.dart:278`);区间为 `[start, ∞)`(`budget_engine.dart:52`)。

3. **起始日模式**:`periodStartOf` 若 date 早于当月配置日则归上一月周期,短月 clamp(`budget_engine.dart:226-240`);
   当前周期区间为 `[start, nextPeriodStart)`(`budget_engine.dart:70`)。

4. **同周期多次工资合并**:`_mergeModules` 按 categoryId 相加(`budget_engine.dart:291-304`)。

5. **结余池三步**(`budget_engine.dart:103-204`)——顺序与符号都不能错:
   - ① 历史各周期 `Σ(模块分配 − 该周期内该模块净消费)`,窗口为连续平铺 `[start_i, start_{i+1})`
   - ② 最早周期起点**之前**的消费:`pool -= expenseContribution`(退款贡献为负 → 等于把退款加回池)
   - ③ 当前周期各模块超支借用:`pool -= (spent - budget)` 当 `spent > budget`
   - 边界:`allocationsDesc` 为空时返回 `0`(`budget_engine.dart:109`)

6. **半开区间** `[start, end)`;`end === null` 表示到无穷(`_inCycle`,`budget_engine.dart:307-312`)。

### 4.3 验证策略

**参考项目已有 21 个预算测试,带精确期望值 —— 这是移植的黄金标准,不是我自己推演的用例。**

完整用例表见 `research/budget-engine-behavior-spec.md`(已在 Phase 1.2 提取)。来源:

| 来源文件 | 用例数 | 覆盖 |
|---|---|---|
| `test/budget_engine_test.dart` | 13 | 模块视图、同月合并、跨月分组、结余池、退款抵扣 |
| `test/budget_engine_cycle_test.dart` | 8 | `periodStartOf` clamp、配置周期模式的视图与池 |
| `test/pool_scenario_test.dart` | 1 | 跨月结余池完整场景 |
| `test/charts_data_test.dart` | — | 图表与引擎口径一致性契约 |

**执行方式:先把这些用例逐条转写成 TypeScript 测试,再写实现。测试全绿 = 语义复刻成功。**

转写时必须避开的四个坑(详见行为规格 §8):

1. 分组用 `year*100+month` 整数键 —— 字符串 `'2026-12' < '2026-9'` 会重现原 bug(X1)
2. 退款 = `type: 0` + `isRefund: true`,不是收入;写成 `type: 1` 测试即失败(R1/R2)
3. 结余池**可以为负**(P2),不要用 `Math.max(0, ...)` 归零
4. 半开区间 `[start, end)`;自然月模式 `end = null` 表示无上界

## 5. API 契约

前缀 `/api/v1`。认证用 **httpOnly + Secure + SameSite=Lax Cookie**(PWA 场景比 localStorage 存 JWT 更安全,也不怕 XSS 窃取)。写操作要求自定义头 `X-Requested-With: fetch` 以抵御 CSRF(SameSite=Lax 已挡住跨站表单,双重保险)。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查(容器 healthcheck 用,免认证) |
| GET | `/api/v1/auth/me` | 当前登录态 |
| POST | `/api/v1/auth/login` | `{username, password}` → Set-Cookie |
| POST | `/api/v1/auth/logout` | 清除会话 |
| POST | `/api/v1/auth/password` | 改密码(需旧密码) |
| GET | `/api/v1/transactions` | 查询:月份区间、类型、分类、账户、标签、关键词、分页 |
| POST | `/api/v1/transactions` | 新建 |
| PATCH | `/api/v1/transactions/:id` | 编辑 |
| DELETE | `/api/v1/transactions/:id` | 软删除 |
| GET | `/api/v1/salaries` | 工资记录列表 |
| GET | `/api/v1/salaries/:id` | 工资详情(含分配明细) |
| POST | `/api/v1/salaries` | 记工资(可带微调后的 allocations) |
| PATCH/DELETE | `/api/v1/salaries/:id` | 编辑 / 软删除 |
| GET | `/api/v1/budget/overview` | 模块视图 + 结余池 + 当前周期区间 |
| GET | `/api/v1/categories` | 列表(可按 type 过滤) |
| POST/PATCH/DELETE | `/api/v1/categories[/:id]` | 增改删(软删) |
| GET/POST/PATCH/DELETE | `/api/v1/accounts[/:id]` | 同上 |
| GET/PUT | `/api/v1/templates[/:id]` | 模板读写 |
| GET/PUT | `/api/v1/settings` | 设置(如 `cycle_start_day`) |
| GET | `/api/v1/stats/category-share` | 分类占比(区间参数) |
| GET | `/api/v1/stats/monthly-trend` | 月度收支趋势 |

**错误契约**:统一 `{ error: { code: string, message: string } }`;4xx 为业务错误,5xx 不泄露堆栈。

**预算口径的单一来源**:`/budget/overview` 服务端直接调用 `packages/shared` 的预算引擎。前端**不重算**预算,只渲染。这样净支出口径不会在两处漂移(参考项目曾出现多处重复判断的问题,`transaction.dart:45` 注释明确要求统一)。

## 6. 前端设计

- **状态**:Pinia。store 划分 `auth` / `meta`(分类、账户、模板) / `transactions` / `budget`。
- **数据获取**:进入页面时拉取;写操作后刷新受影响的 store。不用复杂缓存层(单用户、数据量小)。
- **金额输入**:输入框按"元"接收两位小数,提交前 `Math.round(parseFloat(v) * 100)` 转分。
  ⚠️ 禁止 `parseFloat(x) * 100` 直接当整数用浮点结果;必须 `Math.round`(例如 `19.99*100 = 1998.9999...`)。
- **图表**:ECharts(按需引入以控制体积),饼图 + 柱状图。
- **路由**:`/login`、`/`(首页概览)、`/transactions`、`/budget`、`/salary`、`/templates`、`/stats`、`/settings`、`/manage/categories`、`/manage/accounts`。
- **布局**:移动优先,底部 tab 导航(记录 / 预算 / 统计 / 我的),安全区 `env(safe-area-inset-bottom)`,所有可点元素 ≥44px。
- **PWA**:`vite-plugin-pwa` 生成 manifest 与 Workbox Service Worker。
  - 预缓存应用外壳(JS/CSS/图标/字体)→ 离线可打开
  - API 请求:`NetworkFirst`,失败时回落到缓存并给出"离线,数据可能不是最新"的提示
  - 写操作(非 GET):离线时**不发请求**,直接提示"需要联网才能记账"(D4 决定,不做离线队列)

## 7. 部署设计

### 7.1 Dockerfile(多阶段)

```
阶段 1 (builder, node:22-bookworm-slim):
  corepack enable → pnpm install --frozen-lockfile
  → pnpm --filter shared build → pnpm --filter web build → pnpm --filter server build

阶段 2 (runtime, node:22-bookworm-slim):
  仅拷贝 server 的 dist + 生产依赖(node_modules 精简)
  拷贝 web 的 dist 到 /app/public
  better-sqlite3 为原生模块,必须与 runtime 的 Node ABI 一致 → 两个阶段用同一基础镜像
  USER node (非 root 运行)
  EXPOSE 8081
  HEALTHCHECK curl -f http://127.0.0.1:8081/api/v1/health
```

⚠️ **原生模块陷阱**:`better-sqlite3` 是 C++ 原生扩展。若 builder 与 runtime 的 Node 版本或 libc 不一致,运行时会 `MODULE_NOT_FOUND` 或 ABI 报错。必须:两阶段同一基础镜像 + `pnpm install` 时不要 `--ignore-scripts`(否则跳过编译)。

### 7.2 docker-compose.yml(与现有反代共存)

```yaml
services:
  jizhang:
    build: .
    image: jizhang:latest
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data          # SQLite 文件持久化 → AC9
    ports:
      - "127.0.0.1:8081:8081" # 只绑本机回环,由宿主反代转发;不占用公网 80/443
```

**共存原则**:应用只发布到 `127.0.0.1:8081`,绝不在 compose 里抢 80/443。现有 Nginx/Caddy 加一个 server block / site 指向 `127.0.0.1:8081`,TLS 证书仍由其统一管理。这样部署/卸载本应用都不会影响用户其它站点。

### 7.3 环境变量(`.env`,不入库)

| 变量 | 说明 |
|---|---|
| `JIZHANG_USERNAME` | 单用户登录名 |
| `JIZHANG_PASSWORD_HASH` | 初始密码的 argon2id 哈希(不下发明文) |
| `SESSION_TTL_DAYS` | 会话有效期,默认 30 |
| `DATA_DIR` | SQLite 所在目录,默认 `/data` |
| `PORT` | 默认 8081 |
| `TRUST_PROXY` | 置 `true` 让 Fastify 信任反代下发的 `X-Forwarded-*` |

初始化密码改为提供一次性 CLI:`docker compose exec jizhang node dist/cli.js set-password`,避免明文密码进 `.env`。

### 7.4 备份(AC9 配套)

- `sqlite3 jizhang.db ".backup '/backup/jizhang-$(date +%F).db'"` 定时执行(WAL 模式下**不能直接 cp**,必须先 checkpoint 或用 `.backup`)
- 保留最近 N 天,可选同步到对象存储

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 预算引擎移植语义偏差 | 账目数字算错,产品失去信任 | 先写测试再实现;测试用例逐条对照源码锚点(§4.2);T5 单测作为独立验收项 |
| `better-sqlite3` 原生模块在容器内 ABI 不匹配 | 线上起不来 | 两阶段同一基础镜像;T1 就做一次完整容器启动验证,不留到最后 |
| 与现有反代冲突导致用户其它站点中断 | 用户线上事故 | 只绑 `127.0.0.1`,不碰 80/443;上线前先在本地 compose 验证 |
| 1G 内存 VPS 上 OOM | 服务被 kill | 不在服务器构建前端(本地产物),镜像内不装 devDependencies,Node 加 `--max-old-space-size=256` |
| 浮点金额误差 | 数字对不上 | 全程分整数;前端转换强制 `Math.round`;单测覆盖 19.99 类值 |
| PWA 缓存导致更新不生效 | 用户看到旧版本 | Workbox 用 `autoUpdate`;HTML 走 NetworkFirst,静态资源走带 hash 的 Precache |

## 9. 回滚与运维

- 镜像打 tag(如 `jizhang:2026-09-11`),回滚 = 改 compose 的 tag 后 `up -d`
- 迁移只增不改:每次迁移是新的 `NNN_*.sql`,回滚代码时旧库仍可读(新列有默认值)
- 迁移执行前自动备份数据库文件到 `data/backups/`
- 日志:Fastify + pino 输出 JSON 到 stdout,由 `docker logs` / 宿主日志系统收集

## 10. 未决技术项(不阻塞 MVP,记录待查)

- 是否需要把 `packages/shared` 的预算引擎在前端也运行(用于离线查看时本地重算)。当前设计前端不重算,若离线体验要求提高再评估。
- 图表库最终选型(ECharts vs Chart.js)在 T8 用真实数据度量体积后定。
- 是否需要 API 层的响应缓存以减少 iPhone 上的请求次数。数据量小,MVP 不做。
