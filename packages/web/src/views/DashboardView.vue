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
import { useRecurringStore } from '../stores/recurring.js';
import { budgetTone } from '../utils/budget-tone.js';
import { formatDayLabel, formatMonthLabel, formatYuan } from '../utils/money.js';

/** How many recent rows the dashboard shows, matching the reference dashboard. */
const RECENT_LIMIT = 5;

const budget = useBudgetStore();
const meta = useMetaStore();
const recurring = useRecurringStore();
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

  // Recurring bills are a separate concern and must not be able to break the dashboard:
  // this generates any due occurrences and loads the count for the reminder card. The
  // store swallows its own errors, so a failure here leaves the rest of the page intact.
  await recurring.generateAndReload();
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

/** The tone of the whole-cycle bar, from the same rule the budget page applies per module. */
const cycleTone = computed(() => {
  const overview = budget.overview;
  if (overview === null) return 'normal';
  return budgetTone(overview.totalSpentCents, overview.totalBudgetCents);
});

/**
 * One sentence describing what is wrong with the cycle, or `null` when nothing is, with the
 * tone it should be shown in.
 *
 * Assembled as a single string rather than as sibling conditional fragments in the
 * template: concatenating fragments produced a dangling leading comma whenever only
 * the pool was negative, which read as a broken sentence on screen.
 *
 * Overspending and borrowing are the danger tier; a module that is merely close to its
 * limit is the warning tier, and is only mentioned when nothing worse is.
 */
const budgetAlert = computed<{ text: string; tone: 'warning' | 'danger' } | null>(() => {
  const overspent = budget.overBudgetModules.length;
  const nearLimit = budget.nearLimitModules.length;
  const borrowed = budget.poolIsNegative;
  if (overspent > 0 && borrowed) {
    return { text: `有 ${overspent} 个模块超支，已从结余池借用`, tone: 'danger' };
  }
  if (overspent > 0) return { text: `有 ${overspent} 个模块超支`, tone: 'danger' };
  if (borrowed) return { text: '结余池已被透支，本周期支出超过了预算', tone: 'danger' };
  if (nearLimit > 0) return { text: `有 ${nearLimit} 个模块接近上限`, tone: 'warning' };
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

    <!--
      Rendered only when there is something to confirm, and with the server's real count.
      The task that added it was explicit that a permanent "0 items" card would be worse
      than no card at all.
    -->
    <section v-if="recurring.pendingCount > 0" class="pending-card" role="status">
      <div>
        <span class="label">待确认</span>
        <strong>{{ recurring.pendingCount }} 笔到期账单</strong>
      </div>
      <button type="button" @click="router.push({ name: 'recurring-pending' })">去确认</button>
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
          <span
            class="fill"
            :class="cycleTone"
            :style="{ '--fill': Math.min(1, budgetPercent / 100) }"
          />
        </div>
        <p class="hint">
          {{ formatYuan(budget.overview.totalSpentCents) }} / {{ formatYuan(budget.overview.totalBudgetCents) }} 已用
        </p>
        <p v-if="budgetAlert !== null" class="alert notice" :class="`notice-${budgetAlert.tone}`">
          {{ budgetAlert.text }}
        </p>
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

/* The reminder that something needs a decision. */
.pending-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-left-width: 4px;
  border-radius: 0.7rem;
  /* Raised above the cards around it: this is the one block on the page that is asking
     for something, and depth is how the design says so without adding another colour. */
  box-shadow: var(--lift-2);
  /*
   * And it is the only element in the app that overshoots. Everything else rises into
   * place on `--ease-out`; this one arrives on `--ease-pop` and lands a hair past its
   * size, which is the single deliberate exaggeration in the interface. It is reserved
   * for the one card whose entire purpose is to be noticed — spend it anywhere else and
   * it stops meaning anything.
   *
   * It overrides the generic arrival from `.view-slot > *` (a scoped component rule wins
   * that tie) and keeps the same position in the sequence.
   */
  animation: pop-in var(--dur-base) var(--ease-pop) backwards;
  animation-delay: calc(var(--stagger) * 2);
}

.pending-card strong {
  font-size: 1.05rem;
}

.pending-card button {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
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

/*
 * The fill's width is expressed as a `transform: scaleX()` rather than as a `width`
 * percentage, and the reason is the animation: `width` is a layout property, so animating
 * it re-runs layout for the whole track on every frame. `scaleX` is handed to the
 * compositor and costs the main thread nothing. The track clips it, so the geometry on
 * screen is identical — this is the same bar, drawn a cheaper way.
 *
 * `--fill` is a unit interval rather than a percentage so the arithmetic lives in the
 * template (which the view already does for `budgetPercent`) and the stylesheet only
 * interpolates.
 */
.fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transform: scaleX(var(--fill, 0));
  transform-origin: left center;
  transition: transform var(--dur-slow) var(--ease-out);
  /* Grows into place on arrival, so the length reads as a measurement rather than as a
     bar that was simply always that long. */
  animation: fill-grow var(--dur-slow) var(--ease-out) backwards;
}

@keyframes fill-grow {
  from {
    transform: scaleX(0);
  }
}

.fill.warning {
  background: var(--warning);
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

/* Colours from `.notice` in main.css; this only places it under the figures. */
.alert {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
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
