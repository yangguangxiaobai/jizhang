<script setup lang="ts">
/**
 * Transaction list: month switcher, filters, grouped rows, per-month subtotals.
 *
 * Totals come from the shared net-expense rule, so a refund row reduces the month's
 * expense figure instead of appearing as income.
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { TYPE_EXPENSE, TYPE_INCOME } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { useTransactionsStore } from '../stores/transactions.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const store = useTransactionsStore();
const meta = useMetaStore();
const router = useRouter();

const monthLabel = computed(() => {
  const date = new Date(store.filters.monthStart);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
});

onMounted(async () => {
  await Promise.all([meta.load(), store.load()]);
});

async function applyFilters(): Promise<void> {
  await store.load();
}

async function clearFilters(): Promise<void> {
  store.resetFilters();
  await store.load();
}

async function changeMonth(delta: number): Promise<void> {
  store.shiftMonth(delta);
  await store.load();
}

function edit(item: Transaction): void {
  void router.push({ name: 'transaction-edit', params: { id: item.id } });
}

async function remove(item: Transaction): Promise<void> {
  const label = item.note.trim() === '' ? '这笔账单' : `“${item.note}”`;
  if (!window.confirm(`删除${label}？`)) return;
  await store.remove(item.id);
}

/** Signed amount for display: expenses negative, refunds positive (a refund is a credit). */
function signedAmount(item: Transaction): string {
  if (item.type === TYPE_INCOME) return `+${formatYuan(item.amountCents)}`;
  return item.isRefund ? `+${formatYuan(item.amountCents)}` : `-${formatYuan(item.amountCents)}`;
}
</script>

<template>
  <section class="month">
    <button type="button" class="nav" aria-label="上个月" @click="changeMonth(-1)">‹</button>
    <strong>{{ monthLabel }}</strong>
    <button type="button" class="nav" aria-label="下个月" @click="changeMonth(1)">›</button>
  </section>

  <section class="summary">
    <div>
      <span class="label">净支出</span>
      <strong class="expense">{{ formatYuan(store.totals.netExpenseCents) }}</strong>
    </div>
    <div>
      <span class="label">收入</span>
      <strong class="income">{{ formatYuan(store.totals.incomeCents) }}</strong>
    </div>
    <div>
      <span class="label">笔数</span>
      <strong>{{ store.total }}</strong>
    </div>
  </section>

  <details class="filters" :open="store.hasActiveFilters">
    <summary>筛选</summary>
    <div class="filter-grid">
      <label>
        <span>类型</span>
        <select v-model="store.filters.type">
          <option :value="undefined">全部</option>
          <option :value="TYPE_EXPENSE">支出</option>
          <option :value="TYPE_INCOME">收入</option>
        </select>
      </label>

      <label>
        <span>分类</span>
        <select v-model="store.filters.categoryId">
          <option :value="undefined">全部</option>
          <optgroup label="支出">
            <option v-for="c in meta.expenseCategories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </optgroup>
          <optgroup label="收入">
            <option v-for="c in meta.incomeCategories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </optgroup>
        </select>
      </label>

      <label>
        <span>账户</span>
        <select v-model="store.filters.accountId">
          <option :value="undefined">全部</option>
          <option v-for="a in meta.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>

      <label>
        <span>标签</span>
        <select v-model="store.filters.tag">
          <option :value="undefined">全部</option>
          <option v-for="t in meta.tags" :key="t.name" :value="t.name">
            {{ t.name }}（{{ t.count }}）
          </option>
        </select>
      </label>

      <label class="wide">
        <span>关键词</span>
        <input
          v-model="store.filters.q"
          type="search"
          placeholder="搜索备注"
          @keyup.enter="applyFilters"
        />
      </label>
    </div>

    <div class="filter-actions">
      <button type="button" @click="applyFilters">应用</button>
      <button type="button" class="ghost" :disabled="!store.hasActiveFilters" @click="clearFilters">
        清除
      </button>
    </div>
  </details>

  <p v-if="store.loading" class="muted">加载中…</p>
  <p v-else-if="store.errorMessage" class="error" role="alert">{{ store.errorMessage }}</p>

  <p v-else-if="store.monthGroups.length === 0" class="empty">
    {{ store.hasActiveFilters ? '没有符合条件的账单。' : '这个月还没有记账。' }}
  </p>

  <section v-for="group in store.monthGroups" :key="group.key" class="group">
    <header class="group-head">
      <span>{{ group.label }}</span>
      <span class="group-total">
        支出 {{ formatYuan(group.netExpenseCents) }}
        <template v-if="group.incomeCents > 0">· 收入 {{ formatYuan(group.incomeCents) }}</template>
      </span>
    </header>

    <ul>
      <li v-for="item in group.items" :key="item.id">
        <button type="button" class="row" @click="edit(item)">
          <span class="dot" :style="{ background: meta.categoryColor(item.categoryId) }" />
          <span class="row-main">
            <span class="row-title">
              {{ meta.categoryName(item.categoryId) }}
              <span v-if="item.isRefund" class="badge">退款</span>
            </span>
            <span class="row-sub">
              {{ formatDayLabel(item.date) }}
              <template v-if="item.accountId"> · {{ meta.accountName(item.accountId) }}</template>
              <template v-if="item.note"> · {{ item.note }}</template>
            </span>
            <span v-if="item.tags.length > 0" class="row-tags">
              <span v-for="tag in item.tags" :key="tag" class="tag">{{ tag }}</span>
            </span>
          </span>
          <span class="amount" :class="{ income: item.type === TYPE_INCOME, refund: item.isRefund }">
            {{ signedAmount(item) }}
          </span>
        </button>

        <button type="button" class="delete" :aria-label="`删除${item.note || '这笔账单'}`" @click="remove(item)">
          ✕
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.nav {
  min-width: 44px;
  min-height: 44px;
  font-size: 1.3rem;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  padding: 0.85rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

.summary div {
  display: grid;
  gap: 0.2rem;
  text-align: center;
}

.label {
  font-size: 0.75rem;
  color: var(--muted);
}

.summary strong {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.expense {
  color: var(--danger);
}

.income {
  color: var(--ok, #3f9e6a);
}

.filters {
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface);
}

.filters summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 0.85rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.65rem;
  padding: 0 0.85rem 0.5rem;
}

.filter-grid .wide {
  grid-column: 1 / -1;
}

.filter-grid label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}

select,
input {
  font-size: 16px;
  min-height: 44px;
  padding: 0.4rem 0.5rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.filter-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  padding: 0 0.85rem 0.85rem;
}

.filter-actions button {
  min-height: 44px;
  font: inherit;
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}

.filter-actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.filter-actions button:disabled {
  opacity: 0.5;
}

.group {
  margin-bottom: 1.25rem;
}

.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.15rem;
  font-size: 0.82rem;
  color: var(--muted);
}

.group-total {
  font-variant-numeric: tabular-nums;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  overflow: hidden;
  background: var(--surface);
}

li {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
}

li:last-child {
  border-bottom: 0;
}

.row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 56px;
  padding: 0.6rem 0.25rem 0.6rem 0.85rem;
  font: inherit;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  flex: 0 0 auto;
}

.row-main {
  flex: 1;
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.row-title {
  font-size: 0.95rem;
}

.badge {
  margin-left: 0.35rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.7rem;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0.35rem;
}

.row-sub {
  font-size: 0.75rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.15rem;
}

.tag {
  padding: 0.05rem 0.35rem;
  font-size: 0.7rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 0.35rem;
}

.amount {
  flex: 0 0 auto;
  padding-right: 0.35rem;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
}

.amount.income,
.amount.refund {
  color: var(--ok, #3f9e6a);
}

.delete {
  flex: 0 0 auto;
  width: 44px;
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  border-left: 1px solid var(--border);
  cursor: pointer;
}

.delete:hover {
  color: var(--danger);
}

.muted {
  color: var(--muted);
}

.error {
  color: var(--danger);
}

.empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}

@media (min-width: 30rem) {
  .filter-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
