/**
 * 信封预算引擎行为规格测试。
 *
 * 逐条转写自参考项目的 21 个测试，精确期望值见
 * `.trellis/tasks/09-11-web-pwa/research/budget-engine-behavior-spec.md`。
 *
 * 用例编号与规格文档一一对应：
 * - M1-M3  computeModuleViews 基础
 * - S1-S2  同一自然月多次记工资
 * - X1     跨月分组（整数键回归）
 * - P1-P4  computeCarryoverPool
 * - R1-R3  退款处理（退款计入收入，模块支出保持毛额）
 * - C1-C10 配置周期起始日模式
 *
 * ⚠️ 测试里金额一律直接用**分**，避免参考测试的 `amount * 100` 转写歧义。
 */

import { describe, expect, it } from 'vitest';

import {
  computeCarryoverPool,
  computeModuleViews,
  computePoolTrend,
  formatCents,
  listCycleStarts,
  nextPeriodStart,
  parseYuanToCents,
  periodStartOf,
} from '../src/budget-engine.js';
import { monthKey } from '../src/date-utils.js';
import {
  expenseContribution,
  incomeContribution,
  TYPE_EXPENSE,
  TYPE_INCOME,
  type BudgetAllocation,
  type CycleConfig,
  type ModuleAllocation,
  type Transaction,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// 构造器（对应参考测试的 _allocation / _txn）
// ---------------------------------------------------------------------------

/** 本地日 00:00 的时间戳；容忍传入时分秒，便于复刻带时分秒的用例。 */
function at(
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month1 - 1, day, hour, minute).getTime();
}

function allocation(opts: {
  id?: string;
  date: number;
  modules: ReadonlyArray<readonly [string, number]>;
  salaryRecordId?: string;
}): BudgetAllocation {
  const id = opts.id ?? 'alloc';
  const allocations: ModuleAllocation[] = opts.modules.map(
    ([categoryId, amountCents]) => ({ categoryId, amountCents }),
  );
  return {
    id,
    salaryRecordId: opts.salaryRecordId ?? `sal-${id}`,
    date: opts.date,
    allocations,
  };
}

/** 支出（type 0）。`amountCents` 直接以分给出。 */
function txn(opts: {
  id: string;
  categoryId: string;
  amountCents: number;
  date: number;
  isRefund?: boolean;
  type?: number;
}): Transaction {
  return {
    id: opts.id,
    type: opts.type ?? TYPE_EXPENSE,
    amountCents: opts.amountCents,
    categoryId: opts.categoryId,
    date: opts.date,
    isRefund: opts.isRefund ?? false,
  };
}

const NATURAL: CycleConfig = { kind: 'natural-month' };
const startDay = (day: number): CycleConfig => ({ kind: 'start-day', day });

// ---------------------------------------------------------------------------
// M1-M3  computeModuleViews 基础
// ---------------------------------------------------------------------------

describe('computeModuleViews', () => {
  it('M1 计算模块剩余：预算 − 已消费', () => {
    const current = allocation({
      date: at(2026, 8, 1),
      modules: [
        ['food', 400000],
        ['transport', 100000],
      ],
    });
    const transactions = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 3) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions,
      cycle: NATURAL,
    });

    expect(views).toHaveLength(2);
    const food = views.find((v) => v.categoryId === 'food')!;
    expect(food.budgetCents).toBe(400000);
    expect(food.spentCents).toBe(150000);
    expect(food.remainingCents).toBe(250000);
    expect(food.spentCents).toBeLessThanOrEqual(food.budgetCents);
  });

  it('M2 忽略当前周期之外的消费', () => {
    const current = allocation({
      date: at(2026, 8, 1),
      modules: [['food', 400000]],
    });
    // 该消费在周期开始前，不应计入
    const priorTx = txn({
      id: 't0',
      categoryId: 'food',
      amountCents: 99900,
      date: at(2026, 7, 15),
    });

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: [priorTx],
      cycle: NATURAL,
    });

    expect(views[0]!.spentCents).toBe(0);
  });

  it('M3 超支时剩余为负、已用比例 > 1', () => {
    const current = allocation({
      date: at(2026, 8, 1),
      modules: [['food', 100000]],
    });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 3) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: NATURAL,
    });
    const food = views[0]!;
    expect(food.spentCents > food.budgetCents).toBe(true);
    expect(food.remainingCents).toBe(-50000);
    expect(food.spentCents / food.budgetCents).toBeGreaterThan(1.0);
  });

  it('空分配 → 返回空数组', () => {
    expect(
      computeModuleViews({ allocationsDesc: [], transactions: [], cycle: NATURAL }),
    ).toEqual([]);
  });

  it('已软删除的分配不计入', () => {
    const deleted = { ...allocation({ date: at(2026, 8, 1), modules: [['food', 400000]] }), deleted: true };
    expect(
      computeModuleViews({ allocationsDesc: [deleted], transactions: [], cycle: NATURAL }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S1-S2  同一自然月多次记工资（bug 回归）
// ---------------------------------------------------------------------------

describe('同一自然月多次记工资（bug 回归）', () => {
  it('S1 8/5 记两次工资：合并为当月周期，预算相加，不挤进历史', () => {
    const a = allocation({
      id: 'a1',
      date: at(2026, 8, 5),
      modules: [
        ['food', 300000],
        ['transport', 200000],
      ],
    });
    const b = allocation({
      id: 'a2',
      date: at(2026, 8, 5),
      modules: [
        ['food', 480000],
        ['transport', 320000],
      ],
    });
    // 8/5 当天消费 food 1500 元；注意带时分秒（19:24）
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 5, 19, 24) }),
    ];

    // 倒序：最新 B 在前，同月 → 同一周期
    const views = computeModuleViews({
      allocationsDesc: [b, a],
      transactions: txns,
      cycle: NATURAL,
    });

    const food = views.find((v) => v.categoryId === 'food')!;
    expect(food.budgetCents).toBe(780000);
    expect(food.spentCents).toBe(150000);
    expect(food.remainingCents).toBe(630000);

    const transport = views.find((v) => v.categoryId === 'transport')!;
    expect(transport.budgetCents).toBe(520000);

    const pool = computeCarryoverPool({
      allocationsDesc: [b, a],
      transactions: txns,
      currentModuleViews: views,
      cycle: NATURAL,
    });
    expect(pool).toBe(0);
  });

  it('S2 同月两次工资 + 未超支：池为 0', () => {
    const a = allocation({ id: 'a1', date: at(2026, 8, 5), modules: [['food', 200000]] });
    const b = allocation({ id: 'a2', date: at(2026, 8, 5), modules: [['food', 100000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 5, 19, 24) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [b, a],
      transactions: txns,
      cycle: NATURAL,
    });
    const pool = computeCarryoverPool({
      allocationsDesc: [b, a],
      transactions: txns,
      currentModuleViews: views,
      cycle: NATURAL,
    });

    expect(pool).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// X1  跨月分组（整数键回归）
// ---------------------------------------------------------------------------

describe('跨月分组（bug 回归：月份字符串字典序）', () => {
  it('X1 9/10/12 月工资：最新月为当前周期，不受字符串字典序影响', () => {
    const sep = allocation({ id: 'a9', date: at(2026, 9, 15), modules: [['food', 500000]] });
    const oct = allocation({ id: 'a10', date: at(2026, 10, 12), modules: [['food', 600000]] });
    const dec = allocation({ id: 'a12', date: at(2026, 12, 10), modules: [['food', 700000]] });

    const views = computeModuleViews({
      allocationsDesc: [dec, oct, sep],
      transactions: [],
      cycle: NATURAL,
    });

    expect(views).toHaveLength(1);
    expect(views[0]!.budgetCents).toBe(700000);
  });

  it('monthKey 是整数键，12 月 > 9 月（字符串比较会反）', () => {
    expect(monthKey(at(2026, 12, 1))).toBeGreaterThan(monthKey(at(2026, 9, 1)));
    // 若用 'YYYY-MM' 字符串，'2026-12' < '2026-9' —— 这正是被修掉的 bug
    expect('2026-12' < '2026-9').toBe(true);
  });

  it('跨年分组：1 月比 12 月更新', () => {
    const dec = allocation({ id: 'd', date: at(2025, 12, 10), modules: [['food', 100000]] });
    const jan = allocation({ id: 'j', date: at(2026, 1, 5), modules: [['food', 700000]] });
    const views = computeModuleViews({
      allocationsDesc: [jan, dec],
      transactions: [],
      cycle: NATURAL,
    });
    expect(views[0]!.budgetCents).toBe(700000);
  });
});

// ---------------------------------------------------------------------------
// P1-P4  computeCarryoverPool
// ---------------------------------------------------------------------------

describe('computeCarryoverPool', () => {
  it('P1 历史周期剩余累积到池', () => {
    const history = allocation({ id: 'a1', date: at(2026, 8, 1), modules: [['food', 500000]] });
    const current = allocation({ id: 'a2', date: at(2026, 9, 1), modules: [['food', 500000]] });
    // 8/1 周期内消费 4000，剩 1000 → 池 = 1000 元
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 400000, date: at(2026, 8, 15) }),
    ];

    const pool = computeCarryoverPool({
      allocationsDesc: [current, history],
      transactions: txns,
      cycle: NATURAL,
    });

    expect(pool).toBe(100000);
  });

  it('P2 当前周期超支从池借用（池为负）', () => {
    const current = allocation({ id: 'a2', date: at(2026, 9, 1), modules: [['food', 100000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 9, 5) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: NATURAL,
    });
    const pool = computeCarryoverPool({
      allocationsDesc: [current],
      transactions: txns,
      currentModuleViews: views,
      cycle: NATURAL,
    });

    // 借出 500 元，池 = −500 元。**不能被 Math.max(0, …) 归零**。
    expect(pool).toBe(-50000);
  });

  it('P3 无现役周期时历史分配前的消费从池扣', () => {
    const alloc = allocation({ date: at(2026, 8, 10), modules: [['food', 100000]] });
    const beforeTx = txn({
      id: 'before',
      categoryId: 'food',
      amountCents: 80000,
      date: at(2026, 8, 1),
    });

    const pool = computeCarryoverPool({
      allocationsDesc: [alloc],
      transactions: [beforeTx],
      cycle: NATURAL,
    });

    expect(pool).toBe(-80000);
  });

  it('P4 跨月场景：7 月工资剩余全额进池（8 月为当前周期）', () => {
    const july = allocation({
      id: 'july',
      date: at(2026, 7, 1),
      modules: [
        ['food', 400000],
        ['other', 100000],
      ],
    });
    const august = allocation({
      id: 'aug',
      date: at(2026, 8, 1),
      modules: [
        ['food', 400000],
        ['other', 100000],
      ],
    });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 100000, date: at(2026, 7, 10) }),
    ];

    const pool = computeCarryoverPool({
      allocationsDesc: [august, july],
      transactions: txns,
      cycle: NATURAL,
    });

    // 7 月 food 剩 3000 + other 剩 1000 = 4000 元
    expect(pool).toBe(400000);
  });

  it('空分配 → 池为 0', () => {
    expect(
      computeCarryoverPool({ allocationsDesc: [], transactions: [], cycle: NATURAL }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 退款是收入（已修订：不再冲减支出，计入收入）
// ---------------------------------------------------------------------------

describe('退款计入收入（不再冲减支出）', () => {
  it('R1 模块支出是毛口径：退款不再冲减', () => {
    const current = allocation({ date: at(2026, 8, 1), modules: [['food', 400000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 3) }),
      // 退款 500 元是收入：模块支出保持 1500 元
      txn({
        id: 'r1',
        categoryId: 'food',
        amountCents: 50000,
        date: at(2026, 8, 4),
        isRefund: true,
        type: TYPE_INCOME,
      }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: NATURAL,
    });
    const food = views[0]!;
    expect(food.spentCents).toBe(150000);
    expect(food.remainingCents).toBe(250000);
    expect(food.spentCents > food.budgetCents).toBe(false);
  });

  it('R2 超支按毛支出判断：退款不能把超支变不超支', () => {
    const current = allocation({ date: at(2026, 8, 1), modules: [['food', 100000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 120000, date: at(2026, 8, 3) }),
      // 退款 800 元是收入：支出仍是 1200，超支
      txn({
        id: 'r1',
        categoryId: 'food',
        amountCents: 80000,
        date: at(2026, 8, 4),
        isRefund: true,
        type: TYPE_INCOME,
      }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: NATURAL,
    });
    expect(views[0]!.spentCents).toBe(120000);
    expect(views[0]!.spentCents > views[0]!.budgetCents).toBe(true);
  });

  it('R3 结余池：分配前的支出照常扣减，退款是收入、不进池子计算', () => {
    const alloc = allocation({ id: 'a1', date: at(2026, 8, 10), modules: [['food', 100000]] });
    const beforeRefund = txn({
      id: 'br',
      categoryId: 'food',
      amountCents: 20000,
      date: at(2026, 8, 1),
      isRefund: true,
      type: TYPE_INCOME,
    });

    const pool = computeCarryoverPool({
      allocationsDesc: [alloc],
      transactions: [beforeRefund],
      cycle: NATURAL,
    });

    // 退款不再冲减支出（贡献为 0）：池不因它变化。
    expect(pool).toBe(0);
  });

  it('退款计入收入：收入贡献为 +amount', () => {
    const refundAsIncome = txn({
      id: 'ri',
      categoryId: 'food',
      amountCents: 50000,
      date: at(2026, 8, 4),
      isRefund: true,
      type: TYPE_INCOME,
    });
    // 直接验证口径：退款是收入型账单，计入收入
    expect(refundAsIncome.type).toBe(TYPE_INCOME);
    expect(refundAsIncome.isRefund).toBe(true);
    expect(incomeContribution(refundAsIncome)).toBe(50000);
    expect(expenseContribution(refundAsIncome)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C1-C10  配置周期起始日模式
// ---------------------------------------------------------------------------

describe('periodStartOf / nextPeriodStart（配置周期起始日）', () => {
  it('C1 8 月 10 号周期起点：边界后取当月边界，边界前取上月边界', () => {
    expect(periodStartOf(10, at(2026, 8, 15))).toBe(at(2026, 8, 10));
    expect(periodStartOf(10, at(2026, 8, 10))).toBe(at(2026, 8, 10));
    expect(periodStartOf(10, at(2026, 8, 5))).toBe(at(2026, 7, 10));
  });

  it('C2 短月 clamp 到月末：配置 31 在 4 月为 4/30、2 月为 2/28', () => {
    expect(periodStartOf(31, at(2026, 4, 30))).toBe(at(2026, 4, 30));
    expect(periodStartOf(31, at(2026, 2, 28))).toBe(at(2026, 2, 28));
    // 4/15 早于 4 月 clamp 边界 4/30 → 归属上一周期 3/31
    expect(periodStartOf(31, at(2026, 4, 15))).toBe(at(2026, 3, 31));
  });

  it('C3 nextPeriodStart 在短月也 clamp', () => {
    // 4/30 起始 → 下一周期 5/31
    expect(nextPeriodStart(31, at(2026, 4, 30))).toBe(at(2026, 5, 31));
  });
});

describe('computeModuleViews：配置周期模式', () => {
  it('C4 当前周期消费从配置边界日起算，边界前消费不计入', () => {
    const current = allocation({ date: at(2026, 8, 15), modules: [['food', 400000]] });
    const txns = [
      // 8/5 < 8/10 边界 → 归属 7 月周期，不计入当前
      txn({ id: 'before', categoryId: 'food', amountCents: 100000, date: at(2026, 8, 5) }),
      // 8/12 在 [8/10, 9/10) → 计入当前
      txn({ id: 'in', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 12) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: startDay(10),
    });

    expect(views[0]!.spentCents).toBe(150000);
    expect(views[0]!.remainingCents).toBe(400000 - 150000);
  });

  it('C5 同一配置周期内多次记工资合并为当前周期，预算相加', () => {
    const a = allocation({ id: 'a1', date: at(2026, 8, 15), modules: [['food', 300000]] });
    const b = allocation({ id: 'a2', date: at(2026, 8, 25), modules: [['food', 200000]] });
    // 均在 [8/10, 9/10) → 合并
    const views = computeModuleViews({
      allocationsDesc: [b, a],
      transactions: [],
      cycle: startDay(10),
    });
    expect(views[0]!.budgetCents).toBe(500000);
  });

  it('C6 跨周期：最新周期为当前，只返回当前周期模块', () => {
    const august = allocation({ id: 'aug', date: at(2026, 8, 15), modules: [['food', 300000]] });
    const september = allocation({ id: 'sep', date: at(2026, 9, 11), modules: [['food', 700000]] });
    const views = computeModuleViews({
      allocationsDesc: [september, august],
      transactions: [],
      cycle: startDay(10),
    });
    expect(views).toHaveLength(1);
    expect(views[0]!.budgetCents).toBe(700000);
  });

  it('C6b 9/9 记工资、起算日 10：工资供 9/10 周期，9 月中支出计入已用', () => {
    const salary = allocation({
      id: 'sep9',
      date: at(2026, 9, 9),
      modules: [['food', 564285]],
    });
    const txns = [
      txn({ id: 'e1', categoryId: 'food', amountCents: 51719, date: at(2026, 9, 15) }),
      // 起算日前的支出仍属上一周期，不进本周期已用
      txn({ id: 'e0', categoryId: 'food', amountCents: 10000, date: at(2026, 9, 5) }),
    ];

    const views = computeModuleViews({
      allocationsDesc: [salary],
      transactions: txns,
      cycle: startDay(10),
    });

    expect(views).toHaveLength(1);
    expect(views[0]!.budgetCents).toBe(564285);
    expect(views[0]!.spentCents).toBe(51719);
  });
});

describe('computeCarryoverPool：配置周期模式', () => {
  it('C7 历史周期剩余按配置周期窗口进池', () => {
    // 历史：7/20 → 周期 [7/10, 8/10)，food 5000
    const history = allocation({ id: 'a1', date: at(2026, 7, 20), modules: [['food', 500000]] });
    // 当前：8/15 → 周期 [8/10, 9/10)，food 5000
    const current = allocation({ id: 'a2', date: at(2026, 8, 15), modules: [['food', 500000]] });
    // 7/15 消费 1000 → 历史周期 [7/10, 8/10) 内 → 剩 4000
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 100000, date: at(2026, 7, 15) }),
    ];

    const pool = computeCarryoverPool({
      allocationsDesc: [current, history],
      transactions: txns,
      cycle: startDay(10),
    });
    expect(pool).toBe(400000);
  });

  it('C8 当前周期超支从池借用（配置周期）', () => {
    const current = allocation({ id: 'a2', date: at(2026, 8, 15), modules: [['food', 100000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 150000, date: at(2026, 8, 20) }),
    ];
    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: startDay(10),
    });
    const pool = computeCarryoverPool({
      allocationsDesc: [current],
      transactions: txns,
      currentModuleViews: views,
      cycle: startDay(10),
    });
    expect(pool).toBe(-50000);
  });
});

describe('自然月默认模式（回归）', () => {
  it('C9 自然月分组、最早发薪日为周期起点', () => {
    const current = allocation({ date: at(2026, 8, 1), modules: [['food', 400000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 100000, date: at(2026, 8, 5) }),
    ];
    const views = computeModuleViews({
      allocationsDesc: [current],
      transactions: txns,
      cycle: NATURAL,
    });
    expect(views[0]!.spentCents).toBe(100000);
  });

  it('C10 同月多次记工资合并为自然月周期', () => {
    const a = allocation({ id: 'a1', date: at(2026, 8, 5), modules: [['food', 300000]] });
    const b = allocation({ id: 'a2', date: at(2026, 8, 20), modules: [['food', 200000]] });
    const views = computeModuleViews({
      allocationsDesc: [b, a],
      transactions: [],
      cycle: NATURAL,
    });
    expect(views[0]!.budgetCents).toBe(500000);
  });

  it('省略 cycle 参数时默认自然月模式', () => {
    const a = allocation({ id: 'a1', date: at(2026, 8, 5), modules: [['food', 300000]] });
    const b = allocation({ id: 'a2', date: at(2026, 8, 20), modules: [['food', 200000]] });
    const views = computeModuleViews({ allocationsDesc: [b, a], transactions: [] });
    expect(views[0]!.budgetCents).toBe(500000);
  });
});

// ---------------------------------------------------------------------------
// 图表一致性契约（参考 charts_data_test.dart:416）
// ---------------------------------------------------------------------------

describe('computePoolTrend 与 computeCarryoverPool 口径一致', () => {
  it('趋势最后一点 === 引擎当前池（P1 场景）', () => {
    const history = allocation({ id: 'a1', date: at(2026, 8, 1), modules: [['food', 500000]] });
    const current = allocation({ id: 'a2', date: at(2026, 9, 1), modules: [['food', 500000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 400000, date: at(2026, 8, 15) }),
    ];

    const trend = computePoolTrend({
      allocationsDesc: [current, history],
      transactions: txns,
      cycle: NATURAL,
    });
    const pool = computeCarryoverPool({
      allocationsDesc: [current, history],
      transactions: txns,
      cycle: NATURAL,
    });

    expect(trend.length).toBeGreaterThan(0);
    expect(trend[trend.length - 1]!.poolCents).toBe(pool);
  });

  it('趋势最后一点 === 引擎当前池（P4 跨月场景）', () => {
    const july = allocation({
      id: 'july',
      date: at(2026, 7, 1),
      modules: [
        ['food', 400000],
        ['other', 100000],
      ],
    });
    const august = allocation({
      id: 'aug',
      date: at(2026, 8, 1),
      modules: [
        ['food', 400000],
        ['other', 100000],
      ],
    });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 100000, date: at(2026, 7, 10) }),
    ];

    const trend = computePoolTrend({
      allocationsDesc: [august, july],
      transactions: txns,
      cycle: NATURAL,
    });
    const pool = computeCarryoverPool({
      allocationsDesc: [august, july],
      transactions: txns,
      cycle: NATURAL,
    });

    expect(trend[trend.length - 1]!.poolCents).toBe(pool);
    expect(trend[trend.length - 1]!.poolCents).toBe(400000);
  });

  it('趋势按周期起点升序，退款不再进入池子计算', () => {
    const alloc = allocation({ id: 'a1', date: at(2026, 8, 10), modules: [['food', 100000]] });
    const beforeRefund = txn({
      id: 'br',
      categoryId: 'food',
      amountCents: 20000,
      date: at(2026, 8, 1),
      isRefund: true,
      type: TYPE_INCOME,
    });
    const trend = computePoolTrend({
      allocationsDesc: [alloc],
      transactions: [beforeRefund],
      cycle: NATURAL,
    });
    // 只有一个周期时，趋势只有"该周期开始"这一个点：
    // 退款是收入、贡献为 0，池不因它变化 = 0（当前周期自身的 1000 元分配尚未进池）
    expect(trend).toHaveLength(1);
    expect(trend[0]!.poolCents).toBe(0);

    // 一致性契约：最后一点 === 引擎池（退款作为收入不计入支出）
    const pool = computeCarryoverPool({
      allocationsDesc: [alloc],
      transactions: [beforeRefund],
      cycle: NATURAL,
    });
    expect(trend[trend.length - 1]!.poolCents).toBe(pool);
  });

  it('single-period overspend: the trend ends at the pool the engine reports', () => {
    // The case that exposed the inconsistency: one cycle, overspent, nothing
    // historical. Without `currentModuleViews` the series is a flat 0 (the pool when
    // the cycle began); with them it must end at the borrowed -100,000.
    const only = allocation({ date: at(2026, 8, 1), modules: [['food', 400000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 500000, date: at(2026, 8, 10) }),
    ];

    const withoutViews = computePoolTrend({
      allocationsDesc: [only],
      transactions: txns,
      cycle: NATURAL,
    });
    expect(withoutViews).toHaveLength(1);
    expect(withoutViews[0]!.poolCents).toBe(0);

    const views = computeModuleViews({
      allocationsDesc: [only],
      transactions: txns,
      cycle: NATURAL,
    });
    const withViews = computePoolTrend({
      allocationsDesc: [only],
      transactions: txns,
      currentModuleViews: views,
      cycle: NATURAL,
    });

    expect(withViews[withViews.length - 1]!.poolCents).toBe(-100000);
    // The contract the charts page depends on: the series ends where the engine says.
    expect(withViews[withViews.length - 1]!.poolCents).toBe(
      computeCarryoverPool({
        allocationsDesc: [only],
        transactions: txns,
        currentModuleViews: views,
        cycle: NATURAL,
      }),
    );
  });

  it('single-period no overspend: trend and engine agree at 0 either way', () => {
    const only = allocation({ date: at(2026, 8, 1), modules: [['food', 400000]] });
    const txns = [
      txn({ id: 't1', categoryId: 'food', amountCents: 100000, date: at(2026, 8, 10) }),
    ];
    const views = computeModuleViews({
      allocationsDesc: [only],
      transactions: txns,
      cycle: NATURAL,
    });
    const withViews = computePoolTrend({
      allocationsDesc: [only],
      transactions: txns,
      currentModuleViews: views,
      cycle: NATURAL,
    });
    expect(withViews[withViews.length - 1]!.poolCents).toBe(0);
  });

  it('trend points are ascending by period start', () => {
    const a = allocation({ id: 'a', date: at(2026, 6, 1), modules: [['food', 100000]] });
    const b = allocation({ id: 'b', date: at(2026, 7, 1), modules: [['food', 100000]] });
    const c = allocation({ id: 'c', date: at(2026, 8, 1), modules: [['food', 100000]] });

    const trend = computePoolTrend({
      allocationsDesc: [c, b, a],
      transactions: [],
      cycle: NATURAL,
    });
    expect(trend.length).toBe(3);
    for (let i = 1; i < trend.length; i += 1) {
      expect(trend[i]!.periodStart).toBeGreaterThan(trend[i - 1]!.periodStart);
    }
  });
});

// ---------------------------------------------------------------------------
// 金额工具（父任务 AC6：无浮点误差）
// ---------------------------------------------------------------------------

describe('金额转换与格式化', () => {
  it('19.99 元 → 1999 分（浮点乘法必须取整）', () => {
    // 反例：19.99 * 100 === 1998.9999999999998
    expect(19.99 * 100).not.toBe(1999);
    expect(parseYuanToCents('19.99')).toBe(1999);
  });

  it('0.1 + 0.2 场景以分为单位无误差', () => {
    const a = parseYuanToCents('0.1')!;
    const b = parseYuanToCents('0.2')!;
    expect(a + b).toBe(30);
    expect(formatCents(a + b)).toBe('0.30');
  });

  it('非法或非正数金额被拒', () => {
    expect(parseYuanToCents('')).toBeNull();
    expect(parseYuanToCents('0')).toBeNull();
    expect(parseYuanToCents('-5')).toBeNull();
    expect(parseYuanToCents('abc')).toBeNull();
    expect(parseYuanToCents('Infinity')).toBeNull();
  });

  it('formatCents 处理负数与补零', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(-50000)).toBe('-500.00');
    expect(formatCents(123456)).toBe('1234.56');
  });
});

// ---------------------------------------------------------------------------
// W1-W7  历史周期回看（`periodStart`）与 listCycleStarts
// ---------------------------------------------------------------------------

/**
 * 一个两周期账本：7 月与 8 月各记一次工资，各自有支出。
 *
 * ⚠️ 每个用例都用**两个不同周期**的数据 —— 单周期 fixture 抓不到错误的桶键，
 * 这是 `spec/backend/quality-guidelines.md` 记录的教训。
 */
function twoCycleLedger() {
  const allocationsDesc = [
    // 最新在前（引擎的输入约定）。
    allocation({
      id: 'aug',
      date: at(2026, 8, 5),
      modules: [
        ['food', 400000],
        ['transport', 100000],
      ],
    }),
    allocation({
      id: 'jul',
      date: at(2026, 7, 3),
      modules: [
        ['food', 300000],
        ['transport', 50000],
      ],
    }),
  ];
  const transactions = [
    txn({ id: 'aug-food', categoryId: 'food', amountCents: 120000, date: at(2026, 8, 10) }),
    txn({ id: 'jul-food', categoryId: 'food', amountCents: 200000, date: at(2026, 7, 12) }),
    txn({ id: 'jul-transport', categoryId: 'transport', amountCents: 60000, date: at(2026, 7, 20) }),
  ];
  return { allocationsDesc, transactions };
}

describe('listCycleStarts', () => {
  it('W1 返回全部周期起点,升序', () => {
    const { allocationsDesc } = twoCycleLedger();

    expect(listCycleStarts(allocationsDesc, NATURAL)).toEqual([
      at(2026, 7, 3),
      at(2026, 8, 5),
    ]);
  });

  it('W1 自然月模式下起点是"该月最早的工资日",不是 1 号', () => {
    const { allocationsDesc } = twoCycleLedger();

    // 这是与 `PoolTrendPoint.periodStart` 共用的标识;若误用月键或 1 号,此处会失败。
    const starts = listCycleStarts(allocationsDesc, NATURAL);
    expect(starts[0]).toBe(at(2026, 7, 3));
    expect(starts[0]).not.toBe(at(2026, 7, 1));
  });

  it('W2 与 computePoolTrend 的 periodStart 序列逐点相等（反漂移）', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const fromTrend = computePoolTrend({ allocationsDesc, transactions, cycle: NATURAL }).map(
      (point) => point.periodStart,
    );

    expect(listCycleStarts(allocationsDesc, NATURAL)).toEqual(fromTrend);
  });

  it('W2 起始日模式同样一致', () => {
    const allocationsDesc = [
      allocation({ id: 'b', date: at(2026, 9, 16), modules: [['food', 100000]] }),
      allocation({ id: 'a', date: at(2026, 9, 3), modules: [['food', 100000]] }),
    ];
    const cycle = startDay(15);

    const fromTrend = computePoolTrend({ allocationsDesc, transactions: [], cycle }).map(
      (point) => point.periodStart,
    );

    expect(listCycleStarts(allocationsDesc, cycle)).toEqual(fromTrend);
  });

  it('W3 无分配时为空', () => {
    expect(listCycleStarts([], NATURAL)).toEqual([]);
  });

  it('W3 软删除的分配不产生周期', () => {
    const { allocationsDesc } = twoCycleLedger();
    const withDeleted = allocationsDesc.map((entry) =>
      entry.id === 'jul' ? { ...entry, deleted: true } : entry,
    );

    expect(listCycleStarts(withDeleted, NATURAL)).toEqual([at(2026, 8, 5)]);
  });
});

describe('computeModuleViews 的 periodStart', () => {
  it('W4 省略参数 = 最新周期（既有行为不变）', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const views = computeModuleViews({ allocationsDesc, transactions, cycle: NATURAL });

    const food = views.find((v) => v.categoryId === 'food');
    expect(food?.budgetCents).toBe(400000);
    expect(food?.spentCents).toBe(120000);
  });

  it('W4 显式传最新周期起点,与省略参数逐字段相等', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const omitted = computeModuleViews({ allocationsDesc, transactions, cycle: NATURAL });
    const explicit = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 8, 5),
    });

    // 这条不变式保证新参数没有改变默认路径:两边的分配与支出口径都必须一致。
    expect(explicit.map((v) => v.budgetCents)).toEqual(omitted.map((v) => v.budgetCents));
    expect(explicit.map((v) => v.categoryId)).toEqual(omitted.map((v) => v.categoryId));
  });

  it('W5 回看 7 月:拿到 7 月的预算与 7 月的支出', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const views = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 7, 3),
    });

    const food = views.find((v) => v.categoryId === 'food');
    const transport = views.find((v) => v.categoryId === 'transport');
    expect(food?.budgetCents).toBe(300000);
    expect(food?.spentCents).toBe(200000);
    expect(transport?.budgetCents).toBe(50000);
    expect(transport?.spentCents).toBe(60000);
    // 超支必须被如实反映,而不是被钳制。
    expect(transport?.remainingCents).toBe(-10000);
  });

  it('W5 历史周期的支出不会捡到相邻周期的交易', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const july = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 7, 3),
    });
    const august = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 8, 5),
    });

    // 7 月食品 200000 + 8 月食品 120000;两边各拿各的,谁都不含对方的数。
    expect(july.find((v) => v.categoryId === 'food')?.spentCents).toBe(200000);
    expect(august.find((v) => v.categoryId === 'food')?.spentCents).toBe(120000);
  });

  it('W5 历史回看与当前周期给出不同结果（不是换了标题的同一份数据）', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const july = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 7, 3),
    });
    const august = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 8, 5),
    });

    expect(july).not.toEqual(august);
  });

  it('W6 未知的周期起点返回空数组,而不是回退到最新周期', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const views = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      periodStart: at(2026, 1, 1),
    });

    // 回退会让界面把 8 月的数字显示在 1 月的标题下。
    expect(views).toEqual([]);
  });

  it('W6 带时分秒的时间戳按自然日归一化后仍能匹配', () => {
    const { allocationsDesc, transactions } = twoCycleLedger();

    const views = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle: NATURAL,
      // `group.start` 是 `dateOnly` 后的值,所以请求值也必须归一化。
      periodStart: at(2026, 7, 3, 13, 45),
    });

    expect(views.find((v) => v.categoryId === 'food')?.budgetCents).toBe(300000);
  });

  it('W7 起始日模式下回看上一个周期,窗口止于下一个周期边界', () => {
    // 周期起点 15 号:8/15–9/14 是一个周期,7/15–8/14 是上一个。
    const allocationsDesc = [
      allocation({ id: 'sep', date: at(2026, 8, 20), modules: [['food', 400000]] }),
      allocation({ id: 'aug', date: at(2026, 7, 20), modules: [['food', 300000]] }),
    ];
    const transactions = [
      // 属于 7/15–8/14 窗口。
      txn({ id: 'in-window', categoryId: 'food', amountCents: 50000, date: at(2026, 8, 10) }),
      // 属于 8/15–9/14 窗口,不能计入上一周期。
      txn({ id: 'next-window', categoryId: 'food', amountCents: 70000, date: at(2026, 8, 16) }),
    ];
    const cycle = startDay(15);

    const previous = computeModuleViews({
      allocationsDesc,
      transactions,
      cycle,
      periodStart: at(2026, 7, 15),
    });

    const food = previous.find((v) => v.categoryId === 'food');
    expect(food?.budgetCents).toBe(300000);
    // 只有窗口内的那笔,证明历史周期的上界是"下一个周期的起点"而非无穷。
    expect(food?.spentCents).toBe(50000);
  });
});
