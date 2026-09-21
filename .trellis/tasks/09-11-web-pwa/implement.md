# 执行计划 · 记账 Web PWA

> 归属父任务 `.trellis/tasks/09-11-web-pwa`。
> 父任务**不直接实现**;它是任务地图 + 跨子任务验收 + 最终集成评审。实际编码在每个子任务里做。
> 技术设计见 `design.md`,需求与验收见 `prd.md`。

## 1. 执行顺序与子任务地图

```
T1 项目骨架与部署底座
 └─ T2 数据模型、迁移与播种
     ├─ T3 认证与会话
     │   └─ T4 账单 CRUD 与列表筛选   ← 核心写入路径打通
     │       ├─ T7 基础数据管理页(分类/账户/标签)
     │       ├─ T8 统计图表
     │       └─ T9 PWA 外壳与移动端体验
     └─ T5 信封预算引擎(纯共享包 + 单测)
         └─ T6 记工资与模板管理
              └─ T10 生产部署与验收  ← 汇合 T1..T9
```

**依赖不是树位置暗示的,而是显式写在各子任务 `prd.md` / `implement.md` 里**(Trellis 规则)。
T5 与 T3/T4 可并行:T5 只依赖 T2 的 schema,不依赖 HTTP 层。

## 2. 子任务卡

每个子任务在创建时都要带:`prd.md`(需求 + 可测验收)、`design.md`(若复杂)、`implement.md`(有序清单 + 验证命令),以及真实填写的 `implement.jsonl` / `check.jsonl`。

### T1 项目骨架与部署底座

- **交付物**:pnpm workspace 可运行;Vue 前端 `hello` 页 + Fastify `/api/v1/health`;`Dockerfile` + `docker-compose.yml` 在本地 `docker compose up -d` 起得来;前端产物由后端托管。
- **必须验证**:容器内 `better-sqlite3` 能加载(哪怕只 `require` 一次),否则原生模块 ABI 问题会拖到 T10 才爆炸(design.md §7.1)。
- **验收**:`curl http://127.0.0.1:8081/api/v1/health` 返回 200;浏览器打开首页看到 Vue 页;`docker compose down && up -d` 正常。
- **不阻塞项**:此时还没有数据库表,健康检查不查库。

### T2 数据模型、迁移与播种

- **交付物**:`001_init.sql`(design.md §3 全部表);迁移执行器(按 `schema_migrations` 版本号、幂等、执行前备份);连接 PRAGMA(`WAL` / `foreign_keys` / `busy_timeout`);首次启动播种预置分类、默认账户、默认模板。
- **播种数据来源**:参考项目 `lib/core/seed_service.dart`(18.9KB,含预置分类与默认模板定义)是权威来源。
- **验收**:空卷启动后库里出现预置数据;重启不重复播种(幂等);`schema_migrations` 有版本记录;单测覆盖迁移幂等性。

### T3 认证与会话

- **交付物**:argon2id 哈希;`POST /auth/login|logout`、`GET /auth/me`、`POST /auth/password`;httpOnly Cookie 下发;认证守卫插件;401 统一响应;一次性的 `set-password` CLI。
- **验收**:错误密码登录失败且不泄露"用户不存在 vs 密码错";未认证访问业务接口得 401;改密码后旧会话失效;单测覆盖密码校验与会话过期。

### T4 账单 CRUD 与列表筛选

- **交付物**:`/transactions` 五个端点;金额分处理;标签 JSON 去重保序(复刻 `transaction.dart:108-126`);退款标记;列表筛选(月份区间/类型/分类/账户/标签/关键词)+ 分页;软删除。
- **验收**:CRUD 往返一致;软删后列表不返回但库中仍在;`19.99` 元存为 `1999` 分;筛选组合返回正确子集。

### T5 信封预算引擎

- **交付物**:`packages/shared/src/budget-engine.ts` + `period.ts`,**先写测试**(design.md §4.3 的九个用例),再写实现;`/api/v1/budget/overview` 端点。
- **最高风险项** —— 必须逐条对照 design.md §4.2 的源码锚点。
- **验收**:九个行为用例全绿;`periodStartOf` 的 2 月 clamp 用例通过;空分配返回 0 与空数组。

### T6 记工资与模板管理

- **交付物**:`POST /salaries` 按模板比例生成各模块金额(允许请求体覆盖为微调值);工资记录列表/详情/编辑/软删;模板读写与"设为默认";比例校验(累计 ≈100%)。
- **参考**:`lib/features/budget/salary_entry_page.dart`、`salary_allocation_validation.dart`、`template_validation.dart`。
- **验收**:记 10000 元工资 + 模板 40/30/30 → 三模块 4000/3000/3000;请求体带微调值时以微调值为准;比例和不为 100% 时被拒。

### T7 基础数据管理页

- **交付物**:分类 / 账户 / 标签管理 UI + 对应 API;内建项保护(不可删);排序。
- **验收**:新增分类后在记账页可选;删除已被账单引用的分类有明确行为(软删 + 历史账单仍显示名称)。

### T8 统计图表

- **交付物**:`/stats/category-share`、`/stats/monthly-trend`;ECharts 饼图 + 柱状图;区间切换。
- **口径红线**:必须走 `expenseContribution` / `incomeContribution`(design.md §4.2 第 1 条),退款不得计为收入。
- **验收**:造一笔支出 + 一笔同额退款 → 该分类净占比为 0,而非"支出与收入各一笔"。

### T9 PWA 外壳与移动端体验

- **交付物**:`vite-plugin-pwa` manifest + Workbox;App 图标(含 iOS `apple-touch-icon`,180×180);底部 tab 导航;安全区适配;≥44px 触摸目标;离线提示;`autoUpdate` 更新策略。
- **验收**:Lighthouse PWA 可安装;断网刷新仍能打开并看到缓存数据;iPhone 加桌面后无地址栏;底部导航不被 home indicator 遮挡。

### T10 生产部署与验收

- **交付物**:VPS 上线;与现有反代共存的配置片段(不抢 80/443);HTTPS 生效;`.env` 密钥;备份脚本 + 定时任务;AC1..AC11 逐条实测记录。
- **前置**:T1 的镜像与 compose 已在本地验证过(T1 已做容器冒烟),这里只是换到真实 VPS。
- **验收**:见父任务 `prd.md` 的 AC1..AC11;每条都要有实测证据(截图或命令输出)。

## 3. 验证命令(每个子任务交付前都要跑)

```bash
pnpm install --frozen-lockfile     # 依赖一致性
pnpm -r run lint                    # 静态检查
pnpm -r run typecheck               # 类型检查(TypeScript 项目不可跳过)
pnpm -r run test                    # 单元测试
pnpm --filter web run build         # 前端产物可构建
docker compose build && docker compose up -d   # 容器可启动(T1 之后每次涉及后端改动)
curl -fsS http://127.0.0.1:8081/api/v1/health  # 冒烟
```

## 4. 风险检查点(必须显式通过,不可默认跳过)

| 检查点 | 时机 | 通过标准 |
|---|---|---|
| R1 原生模块 ABI | T1 结束 | 容器内 `node -e "require('better-sqlite3')"` 成功 |
| R2 迁移幂等 | T2 结束 | 连续启动两次,播种数据不重复 |
| R3 预算语义 | T5 结束 | 九个行为用例全绿,且逐条对应 design.md §4.2 |
| R4 反代共存 | T1 本地 + T10 线上 | 只绑 `127.0.0.1:8081`,不影响宿主其它站点 |
| R5 卷持久化 | T10 | `docker compose down && up -d` 后数据仍在 |
| R6 离线可看 | T9 结束 | 断网下首页与账单列表可渲染 |
| R7 spec 填写 | 各子任务 Phase 3.3 | `.trellis/spec/` 对应层填入真实约定(AC11) |

## 5. 回滚点

- 每个子任务一个提交批次,失败可 `git revert` 到上一个子任务边界
- 数据库迁移只增不改;回滚代码后旧库仍可读(新列均有默认值,design.md §9)
- 线上回滚 = 改 compose 里的镜像 tag 后 `up -d`

## 6. 启动前复查清单(Phase 1.4 gate)

- [ ] `prd.md` / `design.md` / `implement.md` 已写并被用户审阅
- [ ] 用户明确批准最新规划摘要
- [ ] 子任务已创建且各自 `prd.md` 有可测验收标准
- [ ] 子任务 `implement.jsonl` / `check.jsonl` 有真实条目(非 `_example` 种子行)
- [ ] `.trellis/spec/` 的占位内容已知悉(首个触及该层的子任务负责填写)
- [ ] 参考项目源码可访问(路径 `E:\.01study\Projects\flutterProjects\keepingaccounts`)
