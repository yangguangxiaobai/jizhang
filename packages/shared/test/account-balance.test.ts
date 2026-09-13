/**
 * 账户余额口径测试。
 *
 * 这里钉住的是三件容易在后续改动里被"顺手修坏"的事：
 *
 * 1. **退款让余额增加，但不算收入**。两半来自同一对函数（`expenseContribution` /
 *    `incomeContribution`），所以这条断言同时保护了余额和统计页。
 * 2. **余额 = 各部分之和**（`totalBalanceCents` 与逐账户明细一致）。
 * 3. **账户之间不串**：一个账户的流水不会出现在另一个账户里，引用未知账户的行被忽略。
 *
 * 金额一律直接用**分**，避免 `amount * 100` 这种转写歧义。
 */
import { describe, expect, it } from 'vitest';

import {
  computeAccountBalances,
  ledgerFlowCents,
  totalBalanceCents,
  type AccountFlowTransaction,
  type AccountLike,
} from '../src/account-balance.js';
import { TYPE_EXPENSE, TYPE_INCOME } from '../src/types.js';

/** 2026-09-01 本地零点附近的固定时刻；所有用例共用，避免"今天"影响结果。 */
const DAY = Date.UTC(2026, 8, 1);

let sequence = 0;

function txn(partial: {
  accountId: string;
  type: number;
  amountCents: number;
  isRefund?: boolean;
}): AccountFlowTransaction {
  sequence += 1;
  return {
    id: `t-${sequence}`,
    accountId: partial.accountId,
    type: partial.type,
    amountCents: partial.amountCents,
    categoryId: partial.type === TYPE_INCOME ? 'builtin-income-salary' : 'builtin-expense-food',
    date: DAY,
    isRefund: partial.isRefund === true,
  };
}

const alipay: AccountLike = { id: 'acc-alipay', initialBalanceCents: 58_935 };
const bank: AccountLike = { id: 'acc-bank', initialBalanceCents: 564_285 };

describe('ledgerFlowCents：一行账单对一个账户的影响', () => {
  it('支出让钱离开账户', () => {
    expect(ledgerFlowCents(txn({ accountId: 'a', type: TYPE_EXPENSE, amountCents: 1_200 }))).toBe(
      -1_200,
    );
  });

  it('收入让钱进入账户', () => {
    expect(ledgerFlowCents(txn({ accountId: 'a', type: TYPE_INCOME, amountCents: 1_200 }))).toBe(
      1_200,
    );
  });

  it('退款让钱回到账户 —— 正值，不是负值', () => {
    expect(
      ledgerFlowCents(
        txn({ accountId: 'a', type: TYPE_EXPENSE, amountCents: 1_200, isRefund: true }),
      ),
    ).toBe(1_200);
  });
});

describe('computeAccountBalances', () => {
  it('没有流水时余额就是初始余额', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [],
      salaries: [],
    });

    expect(flow).toBeDefined();
    expect(flow?.balanceCents).toBe(58_935);
    expect(flow).toMatchObject({
      initialBalanceCents: 58_935,
      incomeCents: 0,
      expenseCents: 0,
      salaryCents: 0,
    });
  });

  it('支出扣减余额，收入增加余额', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 3_000 }),
        txn({ accountId: alipay.id, type: TYPE_INCOME, amountCents: 500 }),
      ],
      salaries: [],
    });

    // 58935 − 3000 + 500
    expect(flow?.expenseCents).toBe(3_000);
    expect(flow?.incomeCents).toBe(500);
    expect(flow?.balanceCents).toBe(56_435);
  });

  it('退款：余额增加、净支出减少，但收入**不变**', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 10_000 }),
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 4_000, isRefund: true }),
      ],
      salaries: [],
    });

    // 净支出 = 10000 − 4000，余额 = 58935 − 6000
    expect(flow?.expenseCents).toBe(6_000);
    expect(flow?.balanceCents).toBe(52_935);
    // 这是本文件最重要的一条断言：退款是负支出，**永远不是收入**。
    expect(flow?.incomeCents).toBe(0);
  });

  it('退款多于支出时净支出为负，余额高于初始余额', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 1_000 }),
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 2_500, isRefund: true }),
      ],
      salaries: [],
    });

    expect(flow?.expenseCents).toBe(-1_500);
    expect(flow?.balanceCents).toBe(58_935 + 1_500);
  });

  it('工资打进账户', () => {
    const [flow] = computeAccountBalances({
      accounts: [bank],
      transactions: [],
      salaries: [{ accountId: bank.id, amountCents: 1_200_000 }],
    });

    expect(flow?.salaryCents).toBe(1_200_000);
    // 工资记在 salaryCents 桶里，不混进 incomeCents —— 与 monthlyTrend 的口径一致。
    expect(flow?.incomeCents).toBe(0);
    expect(flow?.balanceCents).toBe(564_285 + 1_200_000);
  });

  it('初始余额可以为负（信用卡/透支）', () => {
    const [flow] = computeAccountBalances({
      accounts: [{ id: 'acc-card', initialBalanceCents: -50_000 }],
      transactions: [txn({ accountId: 'acc-card', type: TYPE_EXPENSE, amountCents: 12_000 })],
      salaries: [],
    });

    expect(flow?.balanceCents).toBe(-62_000);
  });

  it('账户之间互不串账', () => {
    const flows = computeAccountBalances({
      accounts: [alipay, bank],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 1_000 }),
        txn({ accountId: bank.id, type: TYPE_INCOME, amountCents: 999 }),
      ],
      salaries: [{ accountId: bank.id, amountCents: 100 }],
    });

    expect(flows).toHaveLength(2);
    const [first, second] = flows;
    expect(first).toMatchObject({ accountId: alipay.id, expenseCents: 1_000, incomeCents: 0 });
    expect(second).toMatchObject({ accountId: bank.id, incomeCents: 999, salaryCents: 100 });
    // 未出现在 accounts 里的账户 id 不会被凭空造出来。
    expect(flows.map((flow) => flow.accountId)).toEqual([alipay.id, bank.id]);
  });

  it('引用不在 accounts 列表里的账户时，该行被忽略且不影响其它账户', () => {
    // 这正是"账户被软删除"的场景：它的行还在账本里，但不再进入资产表。
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [
        txn({ accountId: 'acc-deleted', type: TYPE_EXPENSE, amountCents: 7_777 }),
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 1_000 }),
      ],
      salaries: [{ accountId: 'acc-deleted', amountCents: 5_000 }],
    });

    expect(flow?.expenseCents).toBe(1_000);
    expect(flow?.salaryCents).toBe(0);
    expect(flow?.balanceCents).toBe(57_935);
  });

  it('保持 accounts 传入的顺序（管理页的排序就是它的排序）', () => {
    const flows = computeAccountBalances({
      accounts: [bank, alipay],
      transactions: [],
      salaries: [],
    });

    expect(flows.map((flow) => flow.accountId)).toEqual([bank.id, alipay.id]);
  });
});

describe('totalBalanceCents', () => {
  it('等于各账户余额之和', () => {
    const flows = computeAccountBalances({
      accounts: [alipay, bank],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 2_000 }),
        txn({ accountId: bank.id, type: TYPE_EXPENSE, amountCents: 300, isRefund: true }),
      ],
      salaries: [{ accountId: bank.id, amountCents: 8_888 }],
    });

    expect(totalBalanceCents(flows)).toBe(
      (58_935 - 2_000) + (564_285 + 300 + 8_888),
    );
    expect(totalBalanceCents(flows)).toBe(
      flows.reduce((sum, flow) => sum + flow.balanceCents, 0),
    );
  });

  it('空列表是 0', () => {
    expect(totalBalanceCents([])).toBe(0);
  });
});
