# T4 账单 CRUD 与列表筛选

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T3**(认证)。T7/T8/T9 依赖本任务。

## Goal

打通记账的核心写入路径:新增/编辑/删除账单,以及按月分组、可多维筛选的列表查询。这是整个产品最常用的操作。

用户价值:记账要快、要能事后找得到。写在 3 秒内完成,查的时候能按月份/分类/账户/标签/关键词定位。

## Background

- 字段与语义权威来源:参考项目 `lib/data/models/transaction.dart` 与
  `lib/data/db/app_database.dart:86-106`,已核对记录在
  `../09-11-web-pwa/research/reference-project-rules.md` §3 与 §5
- **净支出口径**是本任务的关键语义,必须复刻参考项目 `transaction.dart:44-51`:
  ```ts
  expenseContribution = type === 0 ? (isRefund ? -amountCents : amountCents) : 0
  incomeContribution  = type === 1 ? (isRefund ? 0 : amountCents) : 0
  ```
- 退款是**横切标记** `isRefund`,不是收入:退款行的 `type` 仍是 `0`(支出)

## Requirements

### R1 账单字段

`id`(UUID) · `type`(0=支出 1=收入) · `amountCents`(分,整数) · `categoryId` ·
`accountId` · `date`(epoch ms) · `note` · `tags`(字符串数组)· `isRefund` · `deleted` · `updatedAt`

### R2 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/transactions` | 列表 + 筛选 + 分页 |
| POST | `/api/v1/transactions` | 新建 |
| PATCH | `/api/v1/transactions/:id` | 编辑(部分字段) |
| DELETE | `/api/v1/transactions/:id` | **软删除** |
| GET | `/api/v1/transactions/:id` | 单条详情 |

### R3 金额处理

- 服务端**只接受分(整数)**。请求体带小数或非整数 → 400
- 前端负责"元 → 分"转换,且必须 `Math.round(parseFloat(v) * 100)`
  ⚠️ 禁止直接用浮点结果当整数:`19.99 * 100 === 1998.9999999999998`(父任务 AC6)
- 金额必须为正数;零或负 → 400

### R4 标签

- `tags` 为字符串数组;**名字即身份**(父任务 design.md §3)
- 写入前逐项 `trim`、去空串、**去重但保序**(复刻 `transaction.dart:108-126`)
- 存库为 JSON 文本(`tags_json`);读取时容错:非法 JSON → 空数组,不让查询崩溃
- 单项长度上限(建议 32 字符),防超长文本

### R5 退款

- `isRefund: true` 只对**支出**行有意义;对收入行设置 `isRefund` → 400 或明确忽略(需在实现里定案并写测试)
- 编辑时可切换退款标记

### R6 列表查询与筛选

- 参数:`from` / `to`(日期区间)、`type`、`categoryId`、`accountId`、`tag`、`q`(关键词,匹配备注)、`page` / `pageSize`
- 默认排序:`date DESC`,同日按 `updatedAt DESC`
- 默认只返回 `deleted = 0`
- 响应含总数与分页信息,供前端分页
- `q` 用 `LIKE` 匹配备注(注意转义 `%` 与 `_`)
- 返回结果按月分组所需的信息由前端根据 `date` 自己分组(服务端不预分组)

### R7 软删除

- `DELETE` 只置 `deleted = 1` 并更新 `updatedAt`,不物理删除
- 已被软删的记录不出现在列表与统计中(统计由 T8 负责过滤)
- 提供"包含已删除"的查询开关(供将来回收站复用),但本期不加 UI

### R8 校验与错误

- `categoryId` 必须存在且未被软删 → 否则 400
- `accountId` 必须存在且未被软删 → 否则 400
- `date` 必须是合法时间戳,且在合理范围内(如 2000-01-01 至 当前+1天)
- 统一错误格式 `{error:{code, message}}`

### R9 测试

- CRUD 往返一致(建 → 读 → 改 → 读)
- 软删后不出现在列表,但带 `includeDeleted` 可查到
- 金额边界:`19.99` 元 → `1999` 分;非整数金额被拒
- 标签去重保序:`['a','b','a','']` → `['a','b']`
- 退款贡献:`expenseContribution` 为负,`incomeContribution` 为 0
- 筛选组合正确性(区间 + 分类 + 标签)
- 关键词含 `%` 不被当作通配符

## Acceptance Criteria

- [ ] AC1 新建一笔支出后,`GET /transactions` 能查到且字段完全一致
- [ ] AC2 编辑金额与备注后重新查询,值为新值
- [ ] AC3 `DELETE` 后默认列表查不到;`includeDeleted=true` 能查到且 `deleted=1`
- [ ] AC4 提交 `amountCents = 1998.99` 返回 400(只接受整数分)
- [ ] AC5 前端录入 `19.99` 元后库中为 `1999`(整数)
- [ ] AC6 标签 `['a','b','a','']` 入库为 `["a","b"]`
- [ ] AC7 退款行:`expenseContribution = -amountCents`、`incomeContribution = 0`
- [ ] AC8 按 `type` + `categoryId` + 日期区间组合筛选返回正确子集
- [ ] AC9 关键词搜索含 `%` 的备注能精确匹配,不返回无关记录
- [ ] AC10 引用不存在或已删除的分类/账户 → 400
- [ ] AC11 `pnpm --filter server test` 全绿

## Out of Scope

- 预算相关计算 → T5
- 分类/账户/标签的**管理**界面 → T7(本任务只消费它们)
- 统计图表 → T8
- 批量操作、回收站 UI、重复账单 → 父任务 MVP 范围外
- 语音/图片附件、多币种 → 不做

## Technical Notes

- 时区:统一用 epoch ms;"某个月"的边界由查询方给出具体 `from` / `to`,
  服务端不做本地时区推断,避免跨时区歧义
- 前端提交前把 `date` 归一为**当天 00:00 或当前时刻**?参考项目 `Transaction.date`
  存的是用户选择的日期(含时分秒)。本任务保留原样,不做归一
- 参考项目 `transactions_page.dart` 有 92KB 的列表实现,含分组/搜索/批量等大量功能;
  本期只做 PRD 里列出的部分,**不要照搬其交互复杂度**
- 索引已在 T2 建好(`date` / `category_id` / `account_id`),查询应能走索引
