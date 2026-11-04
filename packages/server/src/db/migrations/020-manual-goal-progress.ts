/**
 * Migration 020 — 手动存钱与投资进度(C4/F08+F09)的**隔离**事实表。
 *
 * 这一层与账本、工资、转账、账户余额完全无关:起始值、存入/取出记录与操作重放
 * 各自成表,不引用 `transactions` / `salaries` / `transfers`,也不被任何旧聚合读取。
 * 因此:
 *
 * 1. **不改旧账**:技能消费不会自动变成投资投入,预留也不会自动变成已投入;
 *    旧 `financial.plan.v1` 的 reserve/scenario 数据不会被迁移到这里。
 * 2. **起点是事实,不是收入**:`manual_goal_openings` 一行一个目标,记录用户显式
 *    确认的起始余额与起始时间;它不产生任何收入/账单/转账。
 * 3. **软删除 + 单调修订**:`manual_goal_entries.deleted_at` 是软删除时间,
 *    行永不物理删除,`revision` 每次更正 +1,所以历史始终可读。
 * 4. **一个全局修订号**:`manual_goal_state`(单行)保存单用户服务的**目标状态**
 *    修订号,所有四类写入共用它做 CAS。首次写入时才插入该行,不把运行状态当
 *    种子数据写进迁移。
 * 5. **独立的重放表**:`manual_goal_operations` 与 `financial_operations` 分开,
 *    手动进度的事实与财务执行的确认不会因为同一个 `operationId` 互相顶掉。
 *
 * 所有金额是整数分,所有时间是 epoch 毫秒;约束在数据库层也写一遍(金额 > 0、
 * 目标/方向枚举),因为一个绕过服务层的写入同样会污染整段历史重放。
 */
export const MIGRATION_020_MANUAL_GOAL_PROGRESS = `
-- ── 起始值(每目标一行,可显式更正) ─────────────────────────────────────────
CREATE TABLE manual_goal_openings (
  goal          TEXT    PRIMARY KEY,
  opening_cents INTEGER NOT NULL,
  opening_at    INTEGER NOT NULL,
  revision      INTEGER NOT NULL,
  actor_id      TEXT,
  operation_id  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  CHECK (goal IN ('reserve', 'investment')),
  CHECK (opening_cents >= 0),
  CHECK (revision >= 1)
);

-- ── 手动进度记录(软删除;日期索引服务按目标重放整段历史) ───────────────────
CREATE TABLE manual_goal_entries (
  id            TEXT    PRIMARY KEY,
  goal          TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL,
  date          INTEGER NOT NULL,
  note          TEXT    NOT NULL DEFAULT '',
  revision      INTEGER NOT NULL,
  actor_id      TEXT,
  operation_id  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  CHECK (goal IN ('reserve', 'investment')),
  CHECK (kind IN ('deposit', 'withdrawal')),
  CHECK (amount_cents > 0),
  CHECK (revision >= 1)
);

CREATE INDEX idx_manual_goal_entries_goal_date
  ON manual_goal_entries(goal, date, id);
CREATE INDEX idx_manual_goal_entries_live
  ON manual_goal_entries(goal, deleted_at, date);

-- ── 全局目标状态修订(单行,首次写入时插入) ────────────────────────────────
CREATE TABLE manual_goal_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  revision   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (revision >= 0)
);

-- ── 操作重放(operationId → 原始 HTTP 结果,作用域 = 数据库 + 用户) ──────────
CREATE TABLE manual_goal_operations (
  operation_id  TEXT    PRIMARY KEY,
  actor_id      TEXT    NOT NULL,
  method        TEXT    NOT NULL,
  resource      TEXT    NOT NULL,
  request_hash  TEXT    NOT NULL,
  status_code   INTEGER NOT NULL,
  response_json TEXT    NOT NULL,
  committed_at  INTEGER NOT NULL
);

CREATE INDEX idx_manual_goal_operations_actor
  ON manual_goal_operations(actor_id, committed_at DESC);
`;
