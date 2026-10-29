/**
 * Migration 019 — 工资周期财务执行(Phase 1)的持久化事实。
 *
 * 这一层只存**输入与决策快照**,绝不物化任何派生余额(项目铁律,见
 * `spec/backend/index.md`)。执行金额、缺口、净支出全部由 `@jizhang/shared` 在
 * 读取时从活事实重算。
 *
 * 设计约束(task `10-27-financial-execution-phase1/contract.md`):
 *
 * 1. **追加式修订**:配置、类别映射、已确认周期都是 append-only 的 revision 行,
 *    历史决策永不被后续写入改写(旧修订必须始终可读)。
 * 2. **唯一来源归属**:`financial_period_sources` 上的**部分唯一索引**
 *    (`WHERE active = 1`)在数据库层面保证一笔工资最多属于一个活跃周期;
 *    仅靠应用层检查无法阻止两个并发确认把同一笔工资算两次。
 * 3. **退款分摊独立于 `refund_links`**:旧关系表在软删除时会被整行删除
 *    (`transaction-service.ts` `softDelete`),所以新的分摊事实必须自己带审计,
 *    并且删除/恢复/清除都在同一事务里处理。
 * 4. **操作重放**:`financial_operations` 保存 `operationId` → 原始响应,
 *    作用域是**数据库+用户**,不是会话;重新打开客户端后仍能拿回上次结果。
 * 5. **无外键指向账本表**:金额表的软删除语义与审计可读性要求如此,存在性由
 *    写入时的应用层校验保证(与 `refund_links` 的既有约定一致)。
 *
 * 所有金额是整数分,所有时间是 epoch 毫秒。
 */

/** 账单的可选用途覆盖。`NULL` 表示没有显式覆盖,走类别规则。 */
export const MIGRATION_019_FINANCIAL_EXECUTION = `
-- ── 配置修订(append-only) ─────────────────────────────────────────────────────
-- 每次 PUT /financial-planning/config 追加一行。比例用整数基点(bps)存,
-- 四项之和必须 10000 —— 该约束由 shared 纯函数校验,数据库不重复实现算术规则。
CREATE TABLE financial_config_revisions (
  id                     TEXT    PRIMARY KEY,
  revision               INTEGER NOT NULL UNIQUE,
  enabled                INTEGER NOT NULL,
  ratios_json            TEXT    NOT NULL,
  essential_monthly_cents INTEGER,
  target_months          INTEGER NOT NULL,
  cycle_json             TEXT    NOT NULL,
  time_zone              TEXT    NOT NULL,
  actor_id               TEXT,
  operation_id           TEXT,
  created_at             INTEGER NOT NULL
);

CREATE INDEX idx_financial_config_created ON financial_config_revisions(created_at DESC);

-- ── 类别→用途映射修订(append-only) ────────────────────────────────────────────
-- 规则 + **冻结时的类别拓扑**一起存:后来改名/移动/删除类别,不能让已确认周期
-- 的历史用途被静默重算。
CREATE TABLE financial_mapping_revisions (
  id             TEXT    PRIMARY KEY,
  revision       INTEGER NOT NULL UNIQUE,
  rules_json     TEXT    NOT NULL,
  topology_json  TEXT    NOT NULL,
  topology_token TEXT    NOT NULL,
  actor_id       TEXT,
  operation_id   TEXT,
  created_at     INTEGER NOT NULL
);

-- ── 稳定周期身份 ───────────────────────────────────────────────────────────────
-- 一个财务周期 = 一行。'cycle_key' 是稳定的业务键(组月/冻结边界),唯一。
CREATE TABLE financial_periods (
  id              TEXT    PRIMARY KEY,
  group_month     TEXT    NOT NULL,
  cycle_key       TEXT    NOT NULL,
  active_revision INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_financial_periods_cycle ON financial_periods(cycle_key);
CREATE INDEX idx_financial_periods_group ON financial_periods(group_month);

-- ── 已确认周期修订(append-only,不可变) ───────────────────────────────────────
-- 每个 revision 冻结:窗口、配置/映射修订号、比例/基线/targetMonths、来源快照。
-- 配置改变只影响**未来的**新周期;已有修订的行永不被 UPDATE。
CREATE TABLE financial_period_revisions (
  id                     TEXT    PRIMARY KEY,
  period_id              TEXT    NOT NULL,
  revision               INTEGER NOT NULL,
  group_month            TEXT    NOT NULL,
  cycle_key              TEXT    NOT NULL,
  window_json            TEXT    NOT NULL,
  decision_json          TEXT    NOT NULL,
  sources_json           TEXT    NOT NULL,
  warnings_json          TEXT    NOT NULL,
  reason                 TEXT    NOT NULL,
  config_revision        INTEGER NOT NULL,
  mapping_revision       INTEGER NOT NULL,
  confirmed_income_cents INTEGER NOT NULL,
  actor_id               TEXT,
  operation_id           TEXT,
  created_at             INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_financial_period_revision ON financial_period_revisions(period_id, revision);
CREATE INDEX idx_financial_period_revision_created ON financial_period_revisions(created_at DESC);

-- ── 工资来源的活跃归属 ────────────────────────────────────────────────────────
-- 同一笔工资只能被一个周期**活跃**包含。部分唯一索引是这条不变量的最终防线:
-- 两个并发确认即使同时通过了应用层检查,第二个写入也会在这里失败。
CREATE TABLE financial_period_sources (
  period_id     TEXT    NOT NULL,
  salary_id     TEXT    NOT NULL,
  revision      INTEGER NOT NULL,
  active        INTEGER NOT NULL,
  snapshot_json TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (period_id, salary_id)
);

CREATE UNIQUE INDEX idx_financial_period_sources_active
  ON financial_period_sources(salary_id) WHERE active = 1;
CREATE INDEX idx_financial_period_sources_period
  ON financial_period_sources(period_id, active);

-- ── 退款分摊事实(与旧的 refund_links 相互独立) ──────────────────────────────
-- 旧 'refund_links' 在软删除时整行删除(transaction-service.ts:649-686),
-- 所以"这笔退款分摊了原单多少分"必须自己存,并且独立可审计。
--
-- 'original_facts_json' / 'refund_facts_json' 存**确认那一刻的关键事实**
-- (amountCents/type/isRefund)。它们不是装饰:旧客户端或外部改动可以绕过本模块的
-- 失效传播,把退款从 100 改成 200 —— 这种"金额变了但上限仍然容得下"的情形,
-- 只有把确认时的事实快照和当前行做比较才能发现。类别/日期/账户的变化不在这份
-- 快照里:那些变化不改变分摊的金额所有权,它们各自按用途规则重算。
CREATE TABLE financial_refund_splits (
  id                  TEXT    PRIMARY KEY,
  refund_tx_id        TEXT    NOT NULL,
  original_tx_id      TEXT    NOT NULL,
  amount_cents        INTEGER NOT NULL,
  set_revision        INTEGER NOT NULL,
  state               TEXT    NOT NULL,
  invalid_reason      TEXT,
  original_facts_json TEXT    NOT NULL,
  refund_facts_json   TEXT    NOT NULL,
  operation_id        TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  CHECK (state IN ('active', 'invalidated')),
  CHECK (amount_cents > 0)
);

CREATE UNIQUE INDEX idx_financial_refund_splits_unique
  ON financial_refund_splits(refund_tx_id, original_tx_id);
CREATE INDEX idx_financial_refund_splits_original
  ON financial_refund_splits(original_tx_id, state);
CREATE INDEX idx_financial_refund_splits_refund
  ON financial_refund_splits(refund_tx_id, state);

-- 每次确认/作废/清除都留一条**整集**快照。人生存周期与旧关系表脱钩:
-- 即使原单被硬清除,这里仍能说明当时确认了什么、为什么失效。
-- 'facts_json' 连同关键事实一起存,否则事后无法解释"为什么会失效"。
CREATE TABLE financial_refund_split_sets (
  id           TEXT    PRIMARY KEY,
  refund_tx_id TEXT    NOT NULL,
  revision     INTEGER NOT NULL,
  status       TEXT    NOT NULL,
  reason       TEXT,
  splits_json  TEXT    NOT NULL,
  facts_json   TEXT    NOT NULL,
  operation_id TEXT,
  created_at   INTEGER NOT NULL,
  CHECK (status IN ('confirmed', 'cleared', 'invalidated', 'purged'))
);

CREATE UNIQUE INDEX idx_financial_refund_sets_revision
  ON financial_refund_split_sets(refund_tx_id, revision);

-- ── 账单用途覆盖(与 transaction-service 共用的两列) ──────────────────────────
-- 旧客户端不带这两个字段 => 保持 NULL / 0,行为与今天完全一致。
-- 'financial_purpose_revision' 是乐观并发的比较基准:0 表示"从未有过显式覆盖",
-- 而**第一次**设置覆盖正是用 'expectedRevision: 0' 提交的(0 是合法的期望值);
-- 一旦有过覆盖,修订号从 1 起,旧值 0 再提交就会 409。
ALTER TABLE transactions ADD COLUMN financial_purpose TEXT
  CHECK (financial_purpose IS NULL OR financial_purpose IN ('essentials', 'joy'));
ALTER TABLE transactions ADD COLUMN financial_purpose_revision INTEGER NOT NULL DEFAULT 0;

-- 覆盖变更的审计流水。没有指向 transactions 的外键:硬清除之后,
-- "这里曾经有一个显式用途、被谁改过"仍然必须可读。
CREATE TABLE financial_bill_purpose_events (
  id             TEXT    PRIMARY KEY,
  transaction_id TEXT    NOT NULL,
  revision       INTEGER NOT NULL,
  purpose        TEXT,
  reason         TEXT    NOT NULL,
  operation_id   TEXT,
  actor_id       TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (purpose IS NULL OR purpose IN ('essentials', 'joy'))
);

CREATE UNIQUE INDEX idx_financial_purpose_event_revision
  ON financial_bill_purpose_events(transaction_id, revision);
CREATE INDEX idx_financial_purpose_event_created
  ON financial_bill_purpose_events(created_at DESC);

-- ── 操作重放 ───────────────────────────────────────────────────────────────────
-- operationId → 原始 HTTP 结果。作用域是数据库+用户,不是会话:重新登录、
-- 重开客户端后仍然能拿回"上次到底成功没有"的确切答案。
CREATE TABLE financial_operations (
  operation_id  TEXT    PRIMARY KEY,
  actor_id      TEXT    NOT NULL,
  method        TEXT    NOT NULL,
  resource      TEXT    NOT NULL,
  request_hash  TEXT    NOT NULL,
  status_code   INTEGER NOT NULL,
  response_json TEXT    NOT NULL,
  committed_at  INTEGER NOT NULL
);

CREATE INDEX idx_financial_operations_actor
  ON financial_operations(actor_id, committed_at DESC);
`;
