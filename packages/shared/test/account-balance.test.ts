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
  computeBalanceSheet,
  ledgerFlowCents,
  totalBalanceCents,
  transferFlowCents,
  type AccountFlowTransaction,
  type AccountLike,
  type TransferLike,
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

// ---------------------------------------------------------------------------
// 资产 / 欠款 / 净额
// ---------------------------------------------------------------------------

describe('computeBalanceSheet', () => {
  const cash: AccountLike = { id: 'acc-cash', initialBalanceCents: 100_000 };
  const empty: AccountLike = { id: 'acc-empty', initialBalanceCents: 0 };
  const card: AccountLike = { id: 'acc-card', initialBalanceCents: -30_000 };

  function sheet(accounts: readonly AccountLike[]) {
    return computeBalanceSheet(
      computeAccountBalances({ accounts, transactions: [], salaries: [] }),
    );
  }

  it('正余额算资产，负余额算欠款（欠款报正数），零余额两者都不算', () => {
    expect(sheet([cash, empty, card])).toEqual({
      assetsCents: 100_000,
      // 报成正的 300，界面才不用显示「欠款 −¥300」。
      liabilitiesCents: 30_000,
      netCents: 70_000,
    });
  });

  it('没有欠款时净额等于资产', () => {
    expect(sheet([cash])).toEqual({
      assetsCents: 100_000,
      liabilitiesCents: 0,
      netCents: 100_000,
    });
  });

  it('欠款超过资产时净额为负', () => {
    expect(sheet([card])).toEqual({
      assetsCents: 0,
      liabilitiesCents: 30_000,
      netCents: -30_000,
    });
  });

  it('净额与 totalBalanceCents 完全一致（同一个实现，不是两份）', () => {
    const flows = computeAccountBalances({
      accounts: [cash, empty, card],
      transactions: [
        txn({ accountId: cash.id, type: TYPE_EXPENSE, amountCents: 10_000 }),
        txn({ accountId: card.id, type: TYPE_EXPENSE, amountCents: 5_000 }),
      ],
      salaries: [{ accountId: cash.id, amountCents: 1_000 }],
    });

    const parts = computeBalanceSheet(flows);
    expect(parts.netCents).toBe(totalBalanceCents(flows));
    expect(parts.assetsCents - parts.liabilitiesCents).toBe(totalBalanceCents(flows));
    // 余额被花成负数时，它就从资产那一侧挪到欠款那一侧。
    expect(parts.liabilitiesCents).toBe(35_000);
    expect(parts.assetsCents).toBe(91_000);
  });

  it('空列表三个数都是 0', () => {
    expect(computeBalanceSheet([])).toEqual({
      assetsCents: 0,
      liabilitiesCents: 0,
      netCents: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 转账（子任务 B）
// ---------------------------------------------------------------------------

const wechat: AccountLike = { id: 'acc-wechat', initialBalanceCents: 4_912 };

function transfer(partial: {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
}): TransferLike {
  return partial;
}

describe('transferFlowCents', () => {
  const t = transfer({ fromAccountId: alipay.id, toAccountId: bank.id, amountCents: 100_000 });

  it('转出账户是负的', () => {
    expect(transferFlowCents(t, alipay.id)).toBe(-100_000);
  });

  it('转入账户是正的', () => {
    expect(transferFlowCents(t, bank.id)).toBe(100_000);
  });

  it('不相干的账户是 0', () => {
    expect(transferFlowCents(t, wechat.id)).toBe(0);
  });

  /**
   * 这一条是整个转账特性的数学形式，也是「转账不算收入也不算支出」这句话的可执行版本。
   * 用多组账户与金额做属性式断言，而不是只测一组 —— 单组很容易碰巧通过。
   */
  it('所有账户加起来恒为 0：转账不创造也不销毁钱', () => {
    const accounts = [alipay, bank, wechat];
    const transfers = [
      transfer({ fromAccountId: alipay.id, toAccountId: bank.id, amountCents: 100_000 }),
      transfer({ fromAccountId: bank.id, toAccountId: wechat.id, amountCents: 1 }),
      transfer({ fromAccountId: wechat.id, toAccountId: alipay.id, amountCents: 4_912 }),
      transfer({ fromAccountId: alipay.id, toAccountId: wechat.id, amountCents: 999_999 }),
    ];

    for (const t of transfers) {
      const net = accounts.reduce(
        (sum, account) => sum + transferFlowCents(t, account.id),
        0,
      );
      expect(net, JSON.stringify(t)).toBe(0);
    }

    // 而且对任意子集也成立：求和顺序不影响结论。
    for (const account of accounts) {
      const net = transfers.reduce((sum, t) => sum + transferFlowCents(t, account.id), 0);
      expect(Number.isSafeInteger(net)).toBe(true);
    }
    const grand = accounts.reduce(
      (sum, account) =>
        sum + transfers.reduce((inner, t) => inner + transferFlowCents(t, account.id), 0),
      0,
    );
    expect(grand).toBe(0);
  });
});

describe('computeAccountBalances 纳入转账', () => {
  it('转出减少、转入增加，总额完全不变', () => {
    const before = computeAccountBalances({
      accounts: [alipay, bank],
      transactions: [],
      salaries: [],
    });
    const after = computeAccountBalances({
      accounts: [alipay, bank],
      transactions: [],
      salaries: [],
      transfers: [
        transfer({ fromAccountId: alipay.id, toAccountId: bank.id, amountCents: 30_000 }),
      ],
    });

    const [alipayAfter, bankAfter] = after;
    expect(alipayAfter).toMatchObject({
      transferOutCents: 30_000,
      transferInCents: 0,
      balanceCents: 58_935 - 30_000,
    });
    expect(bankAfter).toMatchObject({
      transferInCents: 30_000,
      transferOutCents: 0,
      balanceCents: 564_285 + 30_000,
    });
    expect(totalBalanceCents(after)).toBe(totalBalanceCents(before));
  });

  it('多笔转账按方向累加', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay],
      transactions: [],
      salaries: [],
      transfers: [
        transfer({ fromAccountId: alipay.id, toAccountId: bank.id, amountCents: 5_000 }),
        transfer({ fromAccountId: bank.id, toAccountId: alipay.id, amountCents: 1_200 }),
        transfer({ fromAccountId: alipay.id, toAccountId: wechat.id, amountCents: 800 }),
      ],
    });

    expect(flow?.transferInCents).toBe(1_200);
    expect(flow?.transferOutCents).toBe(5_800);
    expect(flow?.balanceCents).toBe(58_935 + 1_200 - 5_800);
  });

  it('省略 transfers 时行为与改动前完全一致（加法式扩展）', () => {
    const omitted = computeAccountBalances({
      accounts: [alipay],
      transactions: [txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 1_000 })],
      salaries: [{ accountId: alipay.id, amountCents: 2_000 }],
    });
    const emptyList = computeAccountBalances({
      accounts: [alipay],
      transactions: [txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 1_000 })],
      salaries: [{ accountId: alipay.id, amountCents: 2_000 }],
      transfers: [],
    });

    expect(omitted).toEqual(emptyList);
    expect(omitted[0]).toMatchObject({ transferInCents: 0, transferOutCents: 0 });
  });

  /**
   * 转入方被软删除时，**活着的那一侧仍然记账**。
   *
   * 理由：钱确实离开了支付宝。让支付宝的余额假装没这回事，比"总额因为对方不在资产表里而下降"更糟。
   * 这和"删除一个有余额的账户会让总额下降"是同一条规则，不是特例。
   */
  it('转账的对手方不在资产表里时，活着的一侧照常记账', () => {
    const flows = computeAccountBalances({
      accounts: [alipay],
      transactions: [],
      salaries: [],
      transfers: [
        transfer({ fromAccountId: alipay.id, toAccountId: 'acc-deleted', amountCents: 7_777 }),
      ],
    });

    expect(flows[0]?.transferOutCents).toBe(7_777);
    expect(flows[0]?.balanceCents).toBe(58_935 - 7_777);

    // 反方向同理：从已删除账户转进来，活着的一侧余额增加。
    const incoming = computeAccountBalances({
      accounts: [alipay],
      transactions: [],
      salaries: [],
      transfers: [
        transfer({ fromAccountId: 'acc-deleted', toAccountId: alipay.id, amountCents: 1_000 }),
      ],
    });
    expect(incoming[0]?.transferInCents).toBe(1_000);
    expect(incoming[0]?.balanceCents).toBe(58_935 + 1_000);
  });

  it('与账单、退款、工资混在一起时各项各归其位', () => {
    const [flow] = computeAccountBalances({
      accounts: [alipay, bank],
      transactions: [
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 10_000 }),
        txn({ accountId: alipay.id, type: TYPE_EXPENSE, amountCents: 4_000, isRefund: true }),
        txn({ accountId: alipay.id, type: TYPE_INCOME, amountCents: 500 }),
      ],
      salaries: [{ accountId: alipay.id, amountCents: 800_000 }],
      transfers: [
        transfer({ fromAccountId: alipay.id, toAccountId: bank.id, amountCents: 600_000 }),
      ],
    });

    expect(flow).toMatchObject({
      incomeCents: 500,
      expenseCents: 6_000,
      salaryCents: 800_000,
      transferOutCents: 600_000,
      transferInCents: 0,
    });
    // 58_935 + 500 + 800_000 + 0 − 6_000 − 600_000
    expect(flow?.balanceCents).toBe(58_935 + 500 + 800_000 - 6_000 - 600_000);
  });
});
