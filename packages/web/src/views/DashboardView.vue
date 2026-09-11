<script setup lang="ts">
/**
 * Dashboard: the first screen after login.
 *
 * It answers "how is this month going, and how much budget is left" without making
 * the user open the transaction list and count.
 *
 * Every accounting figure is fetched, never derived. The month's income and net
 * expense come from the stats endpoint that the charts page already uses, and the
 * cycle figures come from the budget store — both computed by the server from
 * `@jizhang/shared`. Adding the returned rows up here would be a second implementation
 * of the net-expense rule, and that is how two pages start disagreeing.
 *
 * The one thing this file does compute is the *sign* used for display on a refund row
 * (`displayAmountCents`), and it does that through the shared contribution helpers so
 * the rule still has a single source.
 */
import { incomeContribution, expenseContribution } from '@jizhang/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, TYPE_EXPENSE } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';
import { formatDayLabel, formatMonthLabel, formatYuan } from '../utils/money.js';

/** How many recent rows the dashboard shows, matching the reference dashboard. */
const RECENT_LIMIT = 5;

const budget = useBudgetStore();
const meta = useMetaStore();
const router = useRouter();

const loading = ref(true);
const errorMessage = ref<string | null>(null);
const recent = ref<Transaction[]>([]);
const monthStart = ref<number | null>(null);
const incomeCents = ref(0);
const netExpenseCents = ref(0);

onMounted(async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const [trend, list] = await Promise.all([
      api.stats.monthlyTrend(1),
      api.transactions.list({ limit: RECENT_LIMIT }),
      budget.loadOverview(),
      meta.load(),
    ]);

    // The trend always ends with the current month. `noUncheckedIndexedAccess` is on,
    // so this has to be an explicit check rather than a `!`.
    const current = trend.items[trend.items.length - 1];
    if (current !== undefined) {
      monthStart.value = current.monthStart;
      incomeCents.value = current.incomeCents;
      netExpenseCents.value = current.netExpenseCents;
    }
    recent.value = list.items;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
});

/** Label straight off the server's own month key, so the header cannot drift. */
const monthLabel = computed(() =>
  monthStart.value === null ? '本月概览' : `${formatMonthLabel(monthStart.value)}概览`,
);

const balanceCents = computed(() => incomeCents.value - netExpenseCents.value);

const budgetRemainingCents = computed(() => {
  const overview = budget.overview;
  if (overview === null) return 0;
  return overview.totalBudgetCents - overview.totalSpentCents;
});

const budgetPercent = computed(() => {
  const overview = budget.overview;
  if (overview === null || overview.totalBudgetCents <= 0) return 0;
  return Math.round((overview.totalSpentCents / overview.totalBudgetCents) * 100);
});

/**
 * One sentence describing what is wrong with the cycle, or `null` when nothing is.
 *
 * Assembled as a single string rather than as sibling conditional fragments in the
 * template: concatenating fragments produced a dangling leading comma whenever only
 * the pool was negative, which read as a broken sentence on screen.
 */
const budgetAlert = computed(() => {
  const overspent = budget.overBudgetModules.length;
  const borrowed = budget.poolIsNegative;
  if (overspent > 0 && borrowed) return `有 ${overspent} 个模块超支，已从结余池借用`;
  if (overspent > 0) return `有 ${overspent} 个模块超支`;
  if (borrowed) return '结余池已被透支，本周期支出超过了预算';
  return null;
});

/** `"9月2日 周三"` plus the category name, the row's secondary line. */
function rowSubtitle(item: Transaction): string {
  return `${formatDayLabel(item.date)} · ${meta.categoryName(item.categoryId)}`;
}

/** The primary line: the note, falling back to the category like the reference does. */
function rowTitle(item: Transaction): string {
  const note = item.note.trim();
  return note === '' ? meta.categoryName(item.categoryId) : note;
}

/**
 * The row's signed amount, in the ledger's own polarity: spending is negative and a
 * refund shows as a negative expense that shrank the month.
 *
 * Deliberately NOT flipped to a positive "money back" figure. A negative amount
 * sitting among other expenses is unambiguous, and it keeps the sign identical to the
 * transaction list, so the same row never reads `-400` on one screen and `+400` on
 * another.
 */
function displayAmountCents(item: Transaction): number {
  return item.type === TYPE_EXPENSE ? expenseContribution(item) : incomeContribution(item);
}

function isRefund(item: Transaction): boolean {
  return item.type === TYPE_EXPENSE && item.isRefund;
}
</script>

<template>
  <p v-if="loading" class="muted">加载中…</p>

  <p v-else-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>

  <template v-else>
    <section class="summary card">
      <h2>{{ monthLabel }}</h2>
      <div class="figures">
        <div class="figure">
          <span class="label">收入</span>
          <strong class="income">{{ formatYuan(incomeCents) }}</strong>
        </div>
        <div class="figure">
          <span class="label">支出</span>
          <strong>{{ formatYuan(netExpenseCents) }}</strong>
        </div>
        <div class="figure">
          <span class="label">结余</span>
          <strong :class="{ negative: balanceCents < 0 }">{{ formatYuan(balanceCents) }}</strong>
        </div>
      </div>
    </section>

    <section class="card budget">
      <template v-if="budget.overview?.hasBudget">
        <div class="row">
          <span class="label">本周期剩余</span>
          <strong :class="{ negative: budgetRemainingCents < 0 }">
            {{ formatYuan(budgetRemainingCents) }}
          </strong>
        </div>
        <div
          class="track"
          role="progressbar"
          :aria-valuenow="budgetPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="本周期预算已用比例"
        >
          <span class="fill" :class="{ over: budgetPercent > 100 }" :style="{ width: `${Math.min(100, budgetPercent)}%` }" />
        </div>
        <p class="hint">
          {{ formatYuan(budget.overview.totalSpentCents) }} / {{ formatYuan(budget.overview.totalBudgetCents) }} 已用
        </p>
        <p v-if="budgetAlert !== null" class="alert">{{ budgetAlert }}</p>
      </template>

      <template v-else>
        <h2>还没有预算周期</h2>
        <p class="hint">记一次工资，系统会按模板比例自动分配各模块预算。</p>
      </template>

      <button type="button" class="ghost" @click="router.push({ name: 'budget' })">
        {{ budget.overview?.hasBudget ? '查看预算' : '去记工资' }}
      </button>
    </section>

    <section class="recent">
      <div class="section-head">
        <h2>最近账单</h2>
        <button type="button" class="link" @click="router.push({ name: 'transactions' })">
          查看全部
        </button>
      </div>

      <p v-if="recent.length === 0" class="hint empty">
        还没有账单，点底部「记一笔」记录第一笔。
      </p>

      <ul v-else class="rows">
        <li v-for="item in recent" :key="item.id">
          <button
            type="button"
            class="txn"
            @click="router.push({ name: 'transaction-edit', params: { id: item.id } })"
          >
            <span class="txn-main">
              <span class="txn-title">{{ rowTitle(item) }}</span>
              <span class="txn-sub">{{ rowSubtitle(item) }}</span>
            </span>
            <span class="txn-amount" :class="{ negative: displayAmountCents(item) < 0, refund: isRefund(item) }">
              {{ formatYuan(displayAmountCents(item)) }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.card {
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
}

h2 {
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
}

.label {
  font-size: 0.78rem;
  color: var(--muted);
}

.figures {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.figure {
  display: grid;
  gap: 0.15rem;
}

.figure strong {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.income {
  color: var(--ok);
}

.negative {
  color: var(--danger);
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.row strong {
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.track {
  height: 8px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
}

.fill.over {
  background: var(--danger);
}

.hint {
  margin: 0.4rem 0 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.alert {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--danger);
}

.ghost {
  width: 100%;
  min-height: 44px;
  margin-top: 0.7rem;
  font: inherit;
  font-weight: 600;
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  cursor: pointer;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.section-head h2 {
  margin: 0;
}

.link {
  min-height: 44px;
  padding: 0 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

.empty {
  margin-top: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.txn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 44px;
  padding: 0.55rem 0.85rem;
  font: inherit;
  text-align: left;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  cursor: pointer;
}

.txn-main {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.txn-title {
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.txn-sub {
  font-size: 0.72rem;
  color: var(--muted);
}

.txn-amount {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.txn-amount.refund {
  color: var(--ok);
}
</style>
