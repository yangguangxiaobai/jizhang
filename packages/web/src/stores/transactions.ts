/**
 * Transaction list state: filters, pagination, and month grouping.
 *
 * The list is server-filtered (the API owns the query) and grouped by month for
 * display. Totals are computed from the returned rows with the shared
 * net-expense rule, so the number on screen matches the budget page and the charts
 * for the same period.
 */
import { expenseContribution, incomeContribution } from '@jizhang/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, TYPE_EXPENSE, TYPE_INCOME, api } from '../api/client.js';
import type { Transaction, TransactionListQuery } from '../api/client.js';
import { monthKeyOf, startOfMonth, startOfNextMonth } from '../utils/money.js';

export interface MonthGroup {
  readonly key: number;
  readonly label: string;
  readonly items: Transaction[];
  readonly netExpenseCents: number;
  readonly incomeCents: number;
}

export interface Filters {
  /** First instant of the month being viewed. */
  monthStart: number;
  type: number | undefined;
  categoryId: string | undefined;
  accountId: string | undefined;
  tag: string | undefined;
  q: string;
}

export const useTransactionsStore = defineStore('transactions', () => {
  const items = ref<Transaction[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  const filters = ref<Filters>({
    monthStart: startOfMonth(Date.now()),
    type: undefined,
    categoryId: undefined,
    accountId: undefined,
    tag: undefined,
    q: '',
  });

  /** Whether anything narrows the query beyond the current month. */
  const hasActiveFilters = computed(() => {
    const f = filters.value;
    return (
      f.type !== undefined ||
      f.categoryId !== undefined ||
      f.accountId !== undefined ||
      f.tag !== undefined ||
      f.q.trim() !== ''
    );
  });

  /** Range the current query covers, used for the month subtotal. */
  const range = computed(() => ({
    from: filters.value.monthStart,
    to: startOfNextMonth(filters.value.monthStart),
  }));

  function buildQuery(): TransactionListQuery {
    const f = filters.value;
    return {
      from: range.value.from,
      to: range.value.to,
      type: f.type,
      categoryId: f.categoryId,
      accountId: f.accountId,
      tag: f.tag,
      q: f.q.trim() === '' ? undefined : f.q.trim(),
      limit: 500,
    };
  }

  async function load(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const result = await api.transactions.list(buildQuery());
      items.value = result.items;
      total.value = result.total;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        items.value = [];
        total.value = 0;
      }
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api.transactions.remove(id);
      items.value = items.value.filter((item) => item.id !== id);
      total.value = Math.max(0, total.value - 1);
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  function resetFilters(): void {
    filters.value = {
      monthStart: filters.value.monthStart,
      type: undefined,
      categoryId: undefined,
      accountId: undefined,
      tag: undefined,
      q: '',
    };
  }

  function shiftMonth(delta: number): void {
    const date = new Date(filters.value.monthStart);
    filters.value.monthStart = startOfMonth(
      new Date(date.getFullYear(), date.getMonth() + delta, 1).getTime(),
    );
  }

  /** Rows grouped into months, newest month first. */
  const monthGroups = computed<MonthGroup[]>(() => {
    const groups = new Map<number, Transaction[]>();
    for (const item of items.value) {
      const key = monthKeyOf(item.date);
      const bucket = groups.get(key);
      if (bucket === undefined) groups.set(key, [item]);
      else bucket.push(item);
    }

    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([key, rows]) => {
        const sample = rows[0]?.date ?? 0;
        const date = new Date(sample);
        return {
          key,
          label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
          items: [...rows].sort((a, b) => b.date - a.date || b.updatedAt - a.updatedAt),
          netExpenseCents: rows.reduce(
            (sum, row) => sum + expenseContribution(row),
            0,
          ),
          incomeCents: rows.reduce(
            (sum, row) => sum + incomeContribution(row),
            0,
          ),
        };
      });
  });

  /** Totals for the currently loaded rows. */
  const totals = computed(() => ({
    netExpenseCents: items.value.reduce(
      (sum, row) => sum + expenseContribution(row),
      0,
    ),
    incomeCents: items.value.reduce((sum, row) => sum + incomeContribution(row), 0),
    expenseCount: items.value.filter((row) => row.type === TYPE_EXPENSE).length,
    incomeCount: items.value.filter((row) => row.type === TYPE_INCOME).length,
  }));

  return {
    items,
    total,
    loading,
    errorMessage,
    filters,
    hasActiveFilters,
    monthGroups,
    totals,
    load,
    remove,
    resetFilters,
    shiftMonth,
    range,
  };
});
