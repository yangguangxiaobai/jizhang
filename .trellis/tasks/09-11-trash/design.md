# 回收站 — 技术设计

> 前置阅读:`prd.md`、`.trellis/spec/backend/index.md`、`.trellis/spec/frontend/state-management.md`

## 1. 关键约束与由此推出的设计

| 约束(来源) | 推出的设计 |
|---|---|
| `TransactionDto` 不含 `deleted`,而 `includeDeleted=true` 返回混合列表(`:390-392`) | 必须新增一条**只返回已删除**的通路,不能在客户端过滤混合结果 |
| 前端只渲染不算账 | 恢复/彻底删除后重新拉取,不做本地增量 |
| 软删除是默认,`purge` 是唯一被授权的物理删除例外 | `purge` 只允许作用于**已删除**的行,否则 409 |
| 6 项导航已定,且 375px 下刚好容纳 | 不加 tab;入口放 `SettingsView` 的「数据管理」分组 |
| `transactions` 无任何外键指向(`001-init.ts:71` 无 `REFERENCES`;唯一的 FK 是 `sessions → users`) | 物理删除不会留下悬挂引用,**无需级联清理** |
| `updated_at` 被 `softDelete` 用作删除时间代理(`transaction-service.ts:349`) | 回收站按 `updated_at DESC` 排序,而不是按账单日期 |
| 新增能力须有测试 | 单测(service + 路由)+ 新 e2e 套件 + 浏览器实测 |

## 2. 为什么新增端点而不是扩展 `list`

两个备选,都劣于新增:

1. **给 `list` 加 `onlyDeleted` 参数,并把 `deleted` 加进 `TransactionDto`。**
   可行,但会污染一个被 45 项 e2e 与整个账单页依赖的接口:DTO 多一个字段、查询多一个分支,而 `includeDeleted=true` 的既有语义("已删除 + 未删除")必须原样保留,于是**两个含义相近的布尔参数并存**,以后极易误用。
2. **客户端用 `includeDeleted=true` 拉全量再自己过滤。**
   直接违反"前端不重算"的精神(这里是过滤而非聚合,但同样是让客户端承担服务端职责),而且**根本做不到**:DTO 里没有 `deleted`。要让它可行,还是得回到方案 1 去改 DTO。

新增 `/api/v1/trash` 的收益是**契约清晰**:回收站的响应**只**包含已删除的行,不需要调用方理解任何标志位。`includeDeleted` 的既有语义完全不动,AC10 因此由结构保证(那条通路物理上拿不到未删除的行)。

代价是多一组端点。考虑到本任务同时需要恢复/物理删除/批量语义,本来就要新增端点,这个代价不存在。

## 3. 后端设计

### 3.1 新增端点(`packages/server/src/routes/trash.ts`)

| 方法 | 路径 | 语义 |
|---|---|---|
| GET | `/api/v1/trash` | 只列出已删除账单,`updated_at DESC` |
| POST | `/api/v1/trash/:id/restore` | 恢复单条(幂等) |
| DELETE | `/api/v1/trash/:id` | 彻底删除单条(仅限已删除行) |
| POST | `/api/v1/trash/restore-all` | 恢复全部 |
| DELETE | `/api/v1/trash` | 清空回收站 |

**为什么批量用两个专用端点而非 `POST /api/v1/trash/restore { ids }`:** 参考项目的两个批量动作是"全部恢复"与"全部清空",不是"对选中项批量操作"。传 `ids` 会引入"空数组是什么意思"的歧义(是清空?还是无操作?)。专用端点让破坏性动作**必须被显式命名**,这与"物理删除必须是显式用户动作"的护栏一致。

**路由注册顺序警告:** `/api/v1/trash/restore-all` 与 `/api/v1/trash/:id` 必须在同一插件内注册,且 Fastify 的**静态段优先**规则要生效。`restore-all` 是静态路径,不会与 `:id` 冲突;但**`DELETE /api/v1/trash` 与 `DELETE /api/v1/trash/:id` 是两个不同路径**,不存在歧义。需要在实现后用 e2e 断言两条路径各自命中正确处理器(见 implement.md 阶段 0)。

`registerTrashRoutes` 必须与其他路由一样**注册进 `app.ts` 的 `authModule.extraRoutes` 数组**(`app.ts:111-118`),否则会重演第一阶段"钩子与路由不在同一封装上下文 → 路由完全无鉴权"的那个事故。**这是本项目最贵的教训,不能靠记忆,要靠 e2e 断言 401。**

### 3.2 `TransactionService` 新增方法

```ts
/** Deleted rows only, most recently deleted first. */
listDeleted(limit = 200): TransactionDto[]

/** Idempotent: restoring an already-active row is a no-op, not an error. */
restore(id: string): TransactionDto          // 已存在(:353),语义确认

/** Hard delete. Refuses a row that is not already soft-deleted. */
purge(id: string): void

/** All-or-nothing bulk operations, each in one transaction. */
restoreAll(): number
purgeAll(): number
```

**`purge` 的护栏(AC4):** 必须区分两种失败,因为它们对用户意味着不同的事:

- 行不存在 → `NotFoundError`(404)
- 行存在但**未被删除** → `ConflictError`(409),消息说明"只能彻底删除回收站里的账单"

不得用"查得到就删"的简化实现——那会让一个拼错的 id 或一次界面状态错位直接抹掉正常账单。

**`restore` 幂等(AC5):** 现有实现(`:354-360`)已经查 `getById(id, true)` 后无条件 `UPDATE deleted = 0`,因此对未删除的行是**无副作用的幂等操作**(只是把 `updated_at` 又 bump 了一次)。问题在于**它会改写 `updated_at`**:对一个未删除的账单调用恢复,会把它的 `updated_at` 推到现在,而 `updated_at` 正是账单列表的次级排序键(`ORDER BY date DESC, updated_at DESC`)。这会让一行在列表内**跳位**。

因此 `restore` 需要一个小改动:**若目标行已经 `deleted === 0`,直接返回该行,不执行 UPDATE。** 这样 AC5 的"不改变其状态"才真正成立,而不只是"不报错"。

### 3.3 `updated_at` 作为删除时间

沿用参考项目的代理做法(`trash_page.dart` 注释)。`listDeleted` 不做任何"删除时间"字段的推导,直接把 `updatedAt` 作为删除时间返回并在 UI 标注为"删除于";避免新增列与迁移。

已知局限(必须在 UI 与 spec 里说清):**恢复后 `updated_at` 不再等于删除时间**。这不是问题,因为回收站只展示当前处于已删除状态的行。

### 3.4 错误类型

`ConflictError` 若不存在则新增,`statusCode = 409`,沿用 `ValidationError` 的既有形状(`transaction-service.ts:73-76`):带 `statusCode` 与 `code`,由 `app.ts` 的统一错误处理器转成 `{ error: { code, message } }`。需先核实 `error-handling.md` 与既有实现,不要另立错误形状。

## 4. 前端设计

### 4.1 状态放哪

**新增 `packages/web/src/stores/trash.ts`**,而不是像 `DashboardView` 那样用局部 `ref`。

理由与首页相反,这正是 `state-management.md` 给出的判断标准("会不会有第二个页面需要它,且可能取到不一致的值"):恢复或清空之后,**账单列表页与预算页的数字都变了**。回收站是这些数据的"反方向"入口,把它做成一个带 `load()` 的小 store,写操作后可以明确地重新拉取,而不是把"我刚刚改变了另一页的数据"这件事埋在一个组件的局部状态里。

`load()` 之外的写方法(`restoreOne` / `purgeOne` / `restoreAll` / `purgeAll`)在成功后重新 `load()` 自己;调用方(视图)负责在必要时让账单 store 与预算 store 也重新拉取。

### 4.2 页面(`packages/web/src/views/TrashView.vue`)

结构与参考项目对齐:

- 顶部:条数摘要 + 两个批量按钮(**全部恢复** / 清空回收站)
- 列表:每行显示 备注或分类名(与账单列表一致的取值方式)、`账单日期 · 删除于 …`、带符号金额
- 每行两个按钮:**恢复** 与 **彻底删除**
- 空状态:说明回收站是空的,并给出回账单列表的入口
- 破坏性动作二次确认:
  - 单条:`彻底删除「备注」?此操作不可撤销。`
  - 批量:`清空回收站将永久删除 N 笔账单,此操作不可撤销。`
- `busy` 标志在操作期间禁用按钮(参考项目 `_busy`)
- 错误用 `role="alert"` 显示真实的 `ApiError.message`,不吞掉

**"不能只靠颜色区分"**:恢复按钮用描边(`ghost`),彻底删除按钮用 `--danger` 文字 + **明确的文字标签**("彻底删除"),而不是只有一个图标。

### 4.3 入口

`packages/web/src/views/SettingsView.vue:108` 的「数据管理」分组新增一个按钮,跳到 `trash`。该分组已有三个同形按钮(分类与账户 / 分配模板 / 工资记录),新增第四个不改变布局。

路由 `meta: { title: '回收站', nav: 'settings' }`,使底部「我的」保持高亮(既有 `activeNav` 机制,`AppShell.vue:18`)。**不新增 tab。**

### 4.4 `api/client.ts`

新增 `TrashListResult`(`items` + `total`)与四个方法。所有请求继续走既有 `request()` 单一 JSON 边界,因此自动获得 CSRF 头与 `ApiError`/`OfflineError` 语义。`DELETE` 已在 `Method` 联合类型中。

## 5. Tradeoffs

| 选择 | 备选 | 为什么这样选 |
|---|---|---|
| 新增 `/api/v1/trash` | 扩展 `list` + 给 DTO 加 `deleted` | 契约清晰,且不动被 45 项 e2e 依赖的接口;AC10 由结构保证而非靠约定 |
| 两个批量专用端点 | `POST /trash/restore { ids }` | 破坏性动作必须被显式命名;避免空数组歧义 |
| `purge` 对未删除行报 409 | 静默当作成功 / 静默删掉 | 409 是唯一能在"界面状态错位"时保住正常账单的选择 |
| `restore` 对未删除行**提前返回** | 无条件 UPDATE | 无条件 UPDATE 会 bump `updated_at` 并让该行在列表里跳位,AC5 的"不改变其状态"就无法成立 |
| 新增 `stores/trash.ts` | 视图内局部 `ref`(如首页) | 首页没有第二个页面共享它;回收站会改变账单页与预算页的数据,需要明确的刷新点 |
| 批量操作单事务,全成或全不成 | 逐条独立提交,返回部分成功 | 部分成功会让 UI 必须表达"3 条成功 2 条失败",而单用户本地 SQLite 下这种失败几乎只来自程序错误;全成或全不成更简单也更安全 |
| 用 `updated_at` 代理删除时间 | 加 `deleted_at` 列 + 迁移 | 免迁移,且与参考项目一致;代价是"恢复后再删除"才更新删除时间,这本来也是正确行为 |
| 不做回收站自动过期 | 定时清理 | 1核1G VPS 上引入定时任务不划算,且参考项目也没有 |

## 6. 兼容性与迁移

- **数据库:** 无 schema 变更,无迁移。
- **API:** 纯新增。`GET/POST/PATCH/DELETE /api/v1/transactions/**` 的行为**完全不变**,`includeDeleted` 语义不变。
- **行为变化(需明确告知):** `restore` 对未删除的行从"bump `updated_at`"变为"直接返回"。现有调用方需要核实:搜索 `restore(` 的使用点。这是**修正**而非破坏——它让"恢复一个正常账单"不再有副作用。
- **`purge` 不可逆**,且是项目里第一个真正的物理删除。`spec/backend/database-guidelines.md` 的软删除约定需要补一条明确例外。
- **回滚:** 后端为新增文件 + service 方法,前端为新增文件 + 两个文件的小改;单 commit 可整体 revert,数据库无需回滚(物理删除掉的行无法恢复,这正是功能语义)。

## 7. 验证方案

| 层次 | 验证 | 对应 AC |
|---|---|---|
| 单测(`test/transactions.test.ts` 或新增 `test/trash.test.ts`) | `listDeleted` 只返回已删除、按 `updated_at DESC`;`purge` 拒绝未删除行(409)、拒绝不存在(404);`restore` 幂等且**不改动未删除行的 `updated_at`**;批量恢复/清空;`purge` 后 `getById` 与 `list` 都不再返回 | AC1–AC8, AC10 |
| 单测(鉴权) | 五个 trash 端点全部未认证返回 401 | 防回归(钩子上下文事故) |
| e2e(`scripts/e2e-trash.mjs`,新增) | 完整闭环:建账单 → 软删 → 出现在回收站 → 恢复 → 回到列表且预算数字复原 → 再删 → 彻底删除 → 任何接口都查不到 | AC1–AC3, AC6–AC8 |
| e2e(既有 266 项) | 全绿,证明 `includeDeleted` 与账单接口未被破坏 | AC12 |
| 前端构建 | `check-mobile.mjs` / `check-pwa.mjs` 通过 | AC11 |
| 浏览器实测(复用 `render-dashboard.mjs` 的测量逻辑,参数化路由) | 回收站页面 375px 无横向溢出、无 <44px 控件、空状态可读、导航「我的」高亮 | AC9, AC11 |
