# 周期账单 — 技术设计

> 前置阅读:`prd.md`、`.trellis/spec/backend/index.md`、`.trellis/spec/backend/database-guidelines.md`

## 1. 关键约束与由此推出的设计

| 约束 | 推出的设计 |
|---|---|
| 不得静默入账(PRD R3) | 生成的是 `pending` **到期项**,不是账单;只有 `confirm` 才写 `transactions` |
| 重复确认 = 重复记账,最危险 | `confirm` 必须在**单事务**内"查状态 → 写账单 → 改状态",且对已确认项提前返回 |
| 1核1G,不得引入常驻定时任务 | 生成**在请求时**执行(`POST /recurring/generate`),不加 cron |
| 月分组键必须是整数(第一阶段真实 bug) | **不引入 `'2026-09'` 这类字符串 periodKey**;幂等键用 `(rule_id, planned_date)`,两者都是整数 |
| 路由必须在 `authModule.extraRoutes` 内 | 新路由加进 `app.ts:111-118` 的数组;单测逐个断言 401 |
| 业务行软删除 | 两张新表都带 `deleted`;`occurrences` 的唯一索引是**部分索引** `WHERE deleted = 0`,否则软删除后无法重新生成 |
| 测试必须跨两个周期 | 生成与推进的测试都构造两个不同到期日的场景 |
| 月末规则不得漂移(AC8) | 推进**始终从 `anchorDate` 推算**,绝不从上次到期日加一个月 |

## 2. 为什么用"到期项"表而不是即时推算

备选:不建 `occurrences` 表,每次请求时按规则 + 已有账单现算"哪些周期还没记账"。

为什么不这么做:

1. **无法表达"忽略"**。用户明确说"这期不记",即时推算没有地方记住这个决定,下一轮又会冒出来。
2. **无法可靠判断"已确认"**。只能靠"账单表里有没有一笔金额/日期都吻合的行"来猜,而用户可能同时手工记了一模一样的账单——那就会把用户手记的那笔误判为本规则已处理。
3. **参考项目就是这么做业务语义的**(`RecurringOccurrence` 有 `status` 三态与 `transactionId`),逐条复刻比自创更安全。

代价是多一张表与一个 `generate` 步骤。这个代价换来了"忽略"与"已确认"的**可审计性**,值得。

## 3. 数据模型(迁移 002)

```sql
-- 规则:一条周期账单的定义。next_due_date 是生成游标。
CREATE TABLE recurring_rules (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  type          INTEGER NOT NULL,            -- 0 支出 / 1 收入
  amount_cents  INTEGER NOT NULL,
  category_id   TEXT    NOT NULL,
  account_id    TEXT    NOT NULL,
  frequency     TEXT    NOT NULL,            -- daily|weekly|monthly|quarterly|yearly
  anchor_date   INTEGER NOT NULL,            -- 推算基准日(本地日 00:00)
  next_due_date INTEGER NOT NULL,            -- 下一个待生成的到期日
  has_older_due INTEGER NOT NULL DEFAULT 0,  -- 仍有更早的到期项未生成(UI 必须提示)
  enabled       INTEGER NOT NULL DEFAULT 1,
  deleted       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

-- 到期项:某条规则某个日期的生成结果。确认后才变成账单。
CREATE TABLE recurring_occurrences (
  id             TEXT    PRIMARY KEY,
  rule_id        TEXT    NOT NULL REFERENCES recurring_rules(id),
  planned_date   INTEGER NOT NULL,
  status         TEXT    NOT NULL,           -- pending|confirmed|ignored
  transaction_id TEXT,                       -- 确认后生成的账单 id
  type           INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL,
  category_id    TEXT    NOT NULL,
  account_id     TEXT    NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  deleted        INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

-- 幂等键。PARTIAL 索引:软删除的行不占用这个键,因此规则被重新启用后
-- 可以再次生成同一天的到期项。
CREATE UNIQUE INDEX idx_recurring_occurrence_slot
  ON recurring_occurrences(rule_id, planned_date) WHERE deleted = 0;
CREATE INDEX idx_recurring_occurrence_pending
  ON recurring_occurrences(status, planned_date) WHERE deleted = 0;
```

**到期项在生成时**快照 `type` / `amount_cents` / `category_id` / `account_id` / `note`。理由:用户之后改了规则的金额,已生成的待确认项应保持当时的预期,否则"这期待确认 3000 元"会在用户没看的时候悄悄变成 3500。改动只影响**未来**的到期项。

`account_id` 不参与幂等键,但必须快照,否则确认时用到的是"当前默认账户"而不是当时的账户。

## 4. 日期推算(`shared`,纯函数 + 单测)

放在 `packages/shared/src/recurring.ts`,与预算引擎同级:纯函数、无 IO、可独立测试。

```ts
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** 从 anchor 推算:anchor 之后第一个严格晚于 after 的到期日。 */
export function nextDueAfter(
  frequency: RecurringFrequency,
  anchorDate: number,
  after: number,
): number;
```

**关键语义(AC8)**:`monthly`/`quarterly`/`yearly` **始终以 `anchorDate` 的年月日为基准**做 `n` 期偏移,而不是在上一个到期日上加一个月:

```
monthly, anchor = 1/31:
  第 1 期 = 1/31(锚定日)
  第 2 期 = 2/28   ← clamp 到当月最后一天
  第 3 期 = 3/31   ← 回到 31,而不是 3/28
```

若在"上一个到期日"上加一个月,2/28 会变成 3/28 并**永久漂移**。参考项目 `_monthly`(`recurring_transaction_repository.dart:401-406`)正是"先算目标年月,再 `clamp(1, lastDay)`",本实现照此。

`daily` = anchor + 7n 天(按天整数加),`weekly` = anchor + 7n 天。两者都不受月末影响。

需要 `daysInMonth(year, month)` —— `date-utils.ts` 已有 `daysInMonth`,复用,不新写。

## 5. 服务层(`RecurringService`)

| 方法 | 语义 |
|---|---|
| `listRules()` | 未删除规则 |
| `createRule(input)` / `updateRule(id, changes)` | 校验 + 写库;创建时 `nextDueDate = anchorDate` |
| `setRuleEnabled(id, enabled)` | 启停。**重新启用时 `nextDueDate` 重置为 `nextDueAfter(freq, anchor, now)`**,避免补生成一大段历史 |
| `deleteRule(id)` | 软删除规则;**其未处理的 pending 到期项一并软删除**(否则会留下永远处理不掉的孤儿提示) |
| `generateDue()` | 对已启用规则生成到期项,返回新建条数 |
| `listPending()` | `status = 'pending'` 且 `deleted = 0`,按 `planned_date` 升序 |
| `listOccurrences()` | 全部到期项(含已处理),供列表页展示历史 |
| `confirmOccurrence(id)` | **单事务**:读状态 → 若非 pending 则提前返回 → 建账单 → 置 confirmed + transactionId |
| `ignoreOccurrence(id)` | 置 ignored;不建账单 |

### 5.1 生成算法

```
generateDue():
  对每条 enabled 且 deleted=0 且 nextDueDate <= today 的规则:
    dates = []
    d = nextDueDate
    while d <= today and dates.length <= MAX_LOOKBACK_PERIODS:
      dates.push(d); d = nextDueAfter(freq, anchorDate, d)
    // 循环结束后 d 已是今天之后的下一个到期日
    overflow = dates.length > MAX_LOOKBACK_PERIODS
    selected = overflow ? dates.slice(-MAX_LOOKBACK_PERIODS) : dates
    事务内:
      对 selected 中每个日期:若 (ruleId, plannedDate) 无未删除行 → 插入 pending
      更新规则:nextDueDate = d,hasOlderDue = overflow
```

**`MAX_LOOKBACK_PERIODS = 12`**,与参考项目一致(`:81-84`)。上限存在的原因是**防止**一条被遗忘多年的 `daily` 规则一次生成上千行;取最近 12 个而不是最旧 12 个,是因为用户要处理的是眼前这几期。

`overflow === true` 时 `hasOlderDue = 1`,UI 必须显示"还有更早的到期项未生成"。**静默丢弃是不允许的**(AC9)。

循环条件用 `dates.length <= MAX` 多取一个,是为了让 `d` 在循环结束后**已经越过今天**,从而不需要额外判断"是否还有更多"。边界见单测。

### 5.2 `confirmOccurrence` 的幂等(最危险路径)

```
confirmOccurrence(id):
  return db.transaction(() => {
    row = SELECT * FROM recurring_occurrences WHERE id = ? AND deleted = 0
    if (!row) throw NotFoundError
    if (row.status === 'confirmed') return { transactionId: row.transaction_id, created: false }
    if (row.status === 'ignored') throw ConflictError('该到期项已被忽略')
    txn = createTransaction(快照字段)          // 复用 TransactionService
    UPDATE ... SET status='confirmed', transaction_id=?, updated_at=?
    return { transactionId: txn.id, created: true }
  })()
```

单事务保证"写账单"与"改状态"要么都成、要么都不成;提前返回保证重复确认**不产生第二笔账单**(AC5)。`ignored` 走 `ConflictError`(409)而不是静默成功,因为那意味着调用方状态错位。

### 5.3 生成时机

`POST /api/v1/recurring/generate` 由前端在**首页挂载**与**进入待确认列表**时调用。

为什么不在 `GET /pending` 里顺带生成:
- 读接口产生写副作用会让重试、预取、并发读都变成写;
- **不能**在应用启动时生成:服务端重启不等于用户打开应用,而 `now` 是服务端时钟,规则到期判断用服务端日期是正确且稳定的。

漏生成的风险由"每次打开应用都调用"覆盖;即使某天没打开,下次打开会一次补齐(受 12 期上限保护)。

## 6. 路由(`routes/recurring.ts`)

| 方法 | 路径 |
|---|---|
| GET | `/api/v1/recurring/rules` |
| POST | `/api/v1/recurring/rules` |
| PATCH | `/api/v1/recurring/rules/:id` |
| DELETE | `/api/v1/recurring/rules/:id` |
| POST | `/api/v1/recurring/rules/:id/enabled` |
| POST | `/api/v1/recurring/generate` |
| GET | `/api/v1/recurring/occurrences` |
| GET | `/api/v1/recurring/pending` |
| POST | `/api/v1/recurring/occurrences/:id/confirm` |
| POST | `/api/v1/recurring/occurrences/:id/ignore` |

**路由顺序**:`generate` 是静态段,`occurrences/:id/...` 是参数段,前缀不同(`recurring/generate` vs `recurring/occurrences/...`),无歧义。`rules/:id/enabled` 与 `rules/:id` 也是不同长度路径。仍用 e2e 断言各路径命中正确处理器,不靠对框架的理解下结论。

注册进 `app.ts` 的 `authModule.extraRoutes` 数组,**必须在这个数组内**。

## 7. 前端

| 文件 | 内容 |
|---|---|
| `api/client.ts` | `recurring` 命名空间(10 个方法)+ 类型 |
| `stores/recurring.ts` | 规则、待确认项、全部到期项;`generate()` 后刷新 |
| `views/RecurringRulesView.vue` | 规则列表 + 启停 + 删除 + 入口到编辑 |
| `views/RecurringRuleEditView.vue` | 新建/编辑表单(复用 TransactionEditView 的字段形状与 44px / 16px 约定) |
| `views/PendingOccurrencesView.vue` | 待确认列表:确认 / 忽略 |
| `views/DashboardView.vue` | **接通 T11 预留的待确认卡片**(有则显示真实条数并跳转,无则不渲染) |
| `router/index.ts` | 三条新路由,`meta.nav = 'settings'`(规则管理)与 `'dashboard'`(待确认) |
| `views/SettingsView.vue` | 「周期账单」入口 |

首页的 `onMounted` 增加 `recurring.generate()` 再 `loadPending()`,**串行**(先生成后读),否则会读到生成前的空列表。失败不得阻断首页的其它数据(单独 `try/catch`,不污染 `errorMessage`)。

## 8. Tradeoffs

| 选择 | 备选 | 为什么 |
|---|---|---|
| 独立 `occurrences` 表 | 即时推算 | 见 §2:即时推算无法表达"忽略",也无法可靠区分"已确认"与"用户手记了同样的账单" |
| 幂等键 `(rule_id, planned_date)` | 参考项目的字符串 `periodKey` | 本项目明确规定月分组键必须是整数;`planned_date` 是 epoch 毫秒整数,天然可排序,不需要再维护一套 periodKey 格式 |
| 部分唯一索引 `WHERE deleted = 0` | 无条件唯一索引 | 无条件索引会让软删除的行永久占用键,规则重新启用后无法再生成同一天 |
| 快照到期项字段 | 确认时读当前规则 | 否则用户改规则会让已生成的待确认项在用户没看时改变金额 |
| 生成是显式 POST | 在 `GET /pending` 里顺带生成 | 读接口不应有写副作用(重试/预取都会变成写) |
| 服务端时钟判到期 | 客户端传今天 | 客户端时钟可被用户随意改;服务端 `now` 可注入,便于测试 |
| 重新启用时重置 `nextDueDate` | 保留原值并补齐 | 一条禁用半年的规则会一次生成几十行;用户重新启用是要"从现在开始",不是"补历史" |
| 上限取最近 12 期 | 最旧 12 期 / 无上限 | 用户要处理的是眼前这几期;无上限会让被遗忘的 daily 规则生成上千行 |
| 无系统通知 | Web Push | iOS PWA 无可靠等价物(PRD R6) |

## 9. 兼容性与迁移

- **新增迁移 002**,只 `CREATE TABLE` / `CREATE INDEX`,不改任何既有表 → 既有数据零风险。
- 迁移前会自动备份(既有 `runMigrations` 行为:`migrate.ts:122-131`,仅当已有迁移记录时)。
- **既有 API 全部不变**;`/transactions`、`/budget/**`、`/stats/**` 一个字符都不改。
- 确认生成的账单是 `transactions` 的普通行,因此账单列表、预算、统计**自动**把它算进去,无需任何新口径。
- **回滚**:新路由 + 新服务 + 新前端页面;迁移 002 可保留(空表无害),不需要降级脚本。
- **e2e 基线必须扩展**:`scripts/lib/e2e-reset.mjs` 需要新增 `DELETE FROM recurring_occurrences` 与 `DELETE FROM recurring_rules`,否则 `e2e-recurring` 会污染其它套件、也会被其它套件污染。

## 10. 验证方案

| 层次 | 验证 | 对应 AC |
|---|---|---|
| `shared` 单测(`test/recurring.test.ts`) | 5 种频率;月末夹取与**回到锚定日**(1/31 → 2/28 → 3/31);闰年 2/29;`nextDueAfter` 严格晚于 `after` | AC8, AC11 |
| 服务层单测(`test/recurring.test.ts`) | 生成幂等(重复调用不新增);上限 12 与 `hasOlderDue`;禁用规则不生成;确认幂等(**重复确认不产生第二笔账单**);忽略不产生账单;确认后预算数字变化;删除规则连带清理 pending | AC2–AC9 |
| 路由单测 | 10 个端点未认证一律 401;缺 CSRF → 403 | — |
| e2e(`scripts/e2e-recurring.mjs`) | 建规则 → 生成 → 确认 → 账单出现且预算变化 → 重复确认不重复记账 → 忽略 → 禁用后不再生成 | AC1–AC9 |
| 浏览器实测(`scripts/render-recurring.mjs`,复用 `lib/browser.mjs`) | 待确认列表可渲染、确认/忽略按钮 ≥ 44px、375px 无横向溢出;首页待确认卡片在有/无时分别显示/消失 | AC10, AC12 |
| 全量 | 既有单测 + 全部容器 e2e 零回归 | AC13 |
