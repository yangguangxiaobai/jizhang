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
 * The one row-level computation this file owns is the display sign: refunds read as
 * positive "money back" rows here, while the shared net-expense rule still keeps them
 * as negative spending for totals and budgets.
 */
import AppIcon from '../components/AppIcon.vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, TYPE_EXPENSE, TYPE_INCOME } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';
import { useRecurringStore } from '../stores/recurring.js';
import { budgetTone } from '../utils/budget-tone.js';
import { formatDayLabel, formatMonthLabel, formatYuan } from '../utils/money.js';

/** How many recent rows the dashboard shows, matching the reference dashboard. */
const RECENT_LIMIT = 5;

const budget = useBudgetStore();
const balances = useBalanceStore();
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
    // Balances ride the same wave as the month summary. Loading them after the first
    // paint left a gap where the asset card was missing until /accounts/balances
    // returned — the page looked like it had lost the total. The store swallows its
    // own errors, so a balance failure cannot take down the rest of the dashboard.
    const [trend, list] = await Promise.all([
      api.stats.monthlyTrend(1),
      api.transactions.list({ limit: RECENT_LIMIT }),
      budget.loadOverview(),
      meta.load(),
      balances.load(true),
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
  // this generates any due occurrences and loads the count for the reminder card.
  void recurring.generateAndReload();
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

/** Signed row amount, matching the transaction list: income and refunds read as credits. */
function displayAmount(item: Transaction): string {
  if (item.type === TYPE_INCOME) return `+${formatYuan(item.amountCents)}`;
  return `-${formatYuan(item.amountCents)}`;
}

function isRefund(item: Transaction): boolean {
  return item.isRefund;
}
</script>

<template>
  <p v-if="loading" class="muted">加载中…</p>

  <p v-else-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>

  <template v-else>
    <!--
      The asset card answers a different question from the summary below it: the summary is
      this month's FLOW (earned, spent, left over) while this is the STOCK of money that
      exists right now. They are deliberately separate blocks with separate headings, because
      putting a total beside "结余" is how the two get read as the same number.

      Numbers only once the server has answered. While balances are still in flight the
      card keeps its place as a skeleton — removing it made the first paint look broken.
      Printing ¥0.00 would report a figure that was never computed.
    -->
    <section v-if="balances.loaded" class="theme-card card asset">
      <div class="row section-head asset-head">
        <h2><AppIcon name="wallet" /> 总余额</h2>
        <span class="asset-caption">所有账户</span>
      </div>
      <strong class="asset-total" :class="{ negative: balances.totalBalanceCents < 0 }">
        {{ formatYuan(balances.totalBalanceCents) }}
      </strong>

      <!--
        The breakdown appears only when something is owed. A credit card, 抖音月付 or 花呗 is
        just an account with a negative balance, so the headline number already nets it out —
        which means buying a coffee on 抖音月付 makes 总余额 drop, and that reads as a bug
        unless the screen says why. Users with no debts see exactly what they saw before: no
        extra line, and no pair of ¥0.00 to scroll past.
      -->
      <p v-if="balances.hasLiabilities" class="asset-split">
        <span>资产 {{ formatYuan(balances.totalAssetsCents) }}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>欠款 {{ formatYuan(balances.totalLiabilitiesCents) }}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>净 {{ formatYuan(balances.totalBalanceCents) }}</span>
      </p>

      <ul v-if="balances.items.length > 0" class="asset-rows">
        <li class="row" v-for="item in balances.items" :key="item.accountId">
          <span class="asset-name">{{ item.name }}</span>
          <span class="asset-amount" :class="{ negative: item.balanceCents < 0 }">
            {{ formatYuan(item.balanceCents) }}
          </span>
        </li>
      </ul>

      <!--
        Moving money between accounts is the one action that belongs on this card rather than a
        menu: it is the only thing a user does *to* the balances they are looking at.
      -->
      <button type="button" class="theme-button ghost" @click="router.push({ name: 'transfers' })">
        <AppIcon name="transfer" />转账<AppIcon class="action-arrow" name="arrow" />
      </button>
    </section>

    <section
      v-else-if="balances.errorMessage === null"
      class="theme-card card asset asset-skeleton"
      aria-busy="true"
    >
      <div class="row section-head asset-head">
        <h2><AppIcon name="wallet" /> 总余额</h2>
        <span class="asset-caption">所有账户</span>
      </div>
      <div class="skeleton-line skeleton-total" aria-hidden="true" />
      <div class="skeleton-line" aria-hidden="true" />
      <div class="skeleton-line short" aria-hidden="true" />
      <p class="muted skeleton-hint">总余额加载中…</p>
    </section>

    <p v-else class="error" role="alert">
      总余额读取失败：{{ balances.errorMessage }}
    </p>

    <section class="theme-card summary card">
      <div class="row section-head">
        <h2>{{ monthLabel }}</h2>
        <span class="label">月度收支</span>
      </div>
      <div class="figures">
        <div class="figure">
          <span class="label">收入</span>
          <strong class="income">{{ formatYuan(incomeCents) }}</strong>
        </div>
        <div class="figure">
          <span class="label">支出</span>
          <strong class="expense">{{ formatYuan(netExpenseCents) }}</strong>
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
    <section v-if="recurring.pendingCount > 0" class="row pending-card" role="status">
      <div>
        <span class="label">待确认</span>
        <strong>{{ recurring.pendingCount }} 笔到期账单</strong>
      </div>
      <button
        class="theme-button"
        type="button"
        @click="router.push({ name: 'recurring-pending' })"
      >
        去确认
      </button>
    </section>

    <section class="theme-card card budget">
      <template v-if="budget.overview?.hasBudget">
        <h2>本周期预算</h2>
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
          {{ formatYuan(budget.overview.totalSpentCents) }} /
          {{ formatYuan(budget.overview.totalBudgetCents) }} 已用
        </p>
        <p v-if="budgetAlert !== null" class="alert notice" :class="`notice-${budgetAlert.tone}`">
          {{ budgetAlert.text }}
        </p>
      </template>

      <template v-else>
        <h2>还没有预算周期</h2>
        <p class="hint">记一次工资，系统会按模板比例自动分配各模块预算。</p>
      </template>

      <button type="button" class="theme-button ghost" @click="router.push({ name: 'budget' })">
        {{ budget.overview?.hasBudget ? '查看预算' : '去记工资' }}<AppIcon name="chevron" />
      </button>
    </section>

    <section class="recent">
      <div class="row section-head">
        <h2>最近账单</h2>
        <button
          type="button"
          class="theme-button link"
          @click="router.push({ name: 'transactions' })"
        >
          查看全部<AppIcon name="chevron" />
        </button>
      </div>

      <p v-if="recent.length === 0" class="hint empty">还没有账单，点底部「记一笔」记录第一笔。</p>

      <ul v-else class="theme-card rows">
        <li v-for="item in recent" :key="item.id">
          <button
            type="button"
            class="theme-button row txn"
            @click="router.push({ name: 'transaction-edit', params: { id: item.id } })"
          >
            <span class="txn-main">
              <span class="txn-title">{{ rowTitle(item) }}</span>
              <span class="txn-sub">{{ rowSubtitle(item) }}</span>
            </span>
            <span
              class="txn-amount"
              :class="{ negative: item.type === TYPE_EXPENSE, refund: isRefund(item) }"
            >
              {{ displayAmount(item) }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.label,
.asset-head h2,
.asset-caption,
.asset-split,
.hint,
.alert,
.link,
.txn-sub {
  font-size: 0.8rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: space-between;
  flex-wrap: wrap;
}

.card,
.recent,
.pending-card {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
}

.label,
.hint,
.muted {
  color: var(--muted);
}

.asset {
  padding: 1.35rem 1.25rem 0.25rem;
  color: var(--on-hero);
  background: var(--hero);
  border: 0;
  box-shadow: var(--lift-1);
}

.asset-head .app-icon {
  color: var(--hero-decor);
}

.section-head {
  margin-bottom: 0.9rem;
}

.row h2 {
  margin: 0;
}

.asset-head,
.asset-name,
.asset-split {
  color: var(--hero-muted);
}

.asset-total {
  display: block;
  margin-bottom: 1.25rem;
  font-size: clamp(2rem, 8.5vw, 2.65rem);
  font-weight: 650;
  line-height: 1.2;
}

/* Placeholder while /accounts/balances is in flight — keeps the card's height so
   the month summary does not jump when the real numbers arrive. */
.asset-skeleton {
  padding-bottom: 1.25rem;
}

.skeleton-line {
  height: 0.85rem;
  margin-bottom: 0.65rem;
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--hero-muted) 28%, transparent);
}

.skeleton-line.skeleton-total {
  width: 55%;
  height: 2.4rem;
  margin-bottom: 1.15rem;
}

.skeleton-line.short {
  width: 40%;
}

.skeleton-hint {
  margin: 0.25rem 0 0;
  color: var(--hero-muted);
}

.asset-rows {
  font-size: 0.85rem;
  list-style: none;
  margin: 0;
  padding: 0.75rem 0;
  display: grid;
  gap: 0.35rem;
  border-top: 1px solid color-mix(in srgb, var(--hero-muted) 24%, transparent);
}

.asset-rows li {
  align-items: baseline;
  gap: 0.3rem 0.75rem;
}

.asset-name {
  flex: 1 1 7rem;
  min-width: 0;
}

.asset-amount {
  max-width: 100%;
  margin-left: auto;
  text-align: right;
}

.asset-split {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
}

.asset .negative {
  color: var(--hero-danger);
}

.asset .ghost {
  display: flex;
  gap: 0.5rem;
  margin-top: 0;
  padding-inline: 0;
  color: var(--on-hero);
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--hero-muted) 24%, transparent);
  border-radius: 0;
}

.asset .ghost:focus-visible {
  outline-color: var(--on-hero);
  outline-offset: -2px;
}

.action-arrow {
  margin-left: auto;
}

.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
}

.figure {
  display: grid;
  align-content: start;
  gap: 0.3rem;
}

.figure + .figure {
  border-left: 1px solid var(--border);
  padding-left: 0.6rem;
}

.income,
.txn-amount.refund {
  color: var(--ok);
}

.expense,
.negative,
.txn-amount.negative,
.error {
  color: var(--danger);
}

.pending-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-left-width: 4px;
  border-radius: var(--radius-card);
  /* Only this decision card keeps the existing overshoot and higher elevation. */
  box-shadow: var(--lift-2);
  animation: pop-in var(--dur-base) var(--ease-pop) backwards;
  animation-delay: calc(var(--stagger) * 2);
}

.pending-card button {
  padding: 0 1rem;
}

.budget {
  background: var(--surface-soft);
}

.budget .row {
  margin-bottom: 0.85rem;
}

.row strong {
  font-size: 1.3rem;
}

.track {
  height: 6px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
}

/* Preserve the compositor-only fill motion; width is never animated. */
.fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transform: scaleX(var(--fill, 0));
  transform-origin: left center;
  transition: transform var(--dur-slow) var(--ease-out);
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
  margin: 0.5rem 0 0;
  line-height: 1.6;
}

.alert {
  margin: 0.65rem 0 0;
}

.ghost,
.link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem;
  background: none;
}

.ghost {
  width: 100%;
  margin-top: 0.8rem;
  font-weight: 600;
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}

.link {
  font-size: 0.8rem;
  color: var(--accent);
}

.recent .section-head {
  margin-bottom: 0.3rem;
}

.empty {
  margin-top: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0.15rem 0.9rem;
}

.rows li + li {
  border-top: 1px solid var(--border);
}

.txn {
  gap: 0.4rem 0.75rem;
  width: 100%;
  min-height: 64px;
  font-weight: 400;
  padding: 0.7rem 0;
  text-align: left;
  color: var(--fg);
  background: none;
}

.txn-main {
  display: grid;
  flex: 1 1 8rem;
  gap: 0.2rem;
  min-width: 0;
}

.txn-title {
  font-size: 0.92rem;
}

.txn-sub {
  color: var(--muted);
}

.txn-amount {
  max-width: 100%;
  margin-left: auto;
  font-weight: 600;
}
</style>
