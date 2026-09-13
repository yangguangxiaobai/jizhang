/**
 * Account balances: how much money is in each account, and in total.
 *
 * This is a store rather than a view-local `ref` for the reason `state-management.md` gives:
 * the test is "would a second page have to fetch this again and could then disagree?", and
 * two pages show these numbers — the home screen's asset card and the accounts section of
 * 我的. A local ref in each would be two fetches that can disagree.
 *
 * The store does **no** arithmetic. `totalBalanceCents` is the server's own figure and each
 * row's `balanceCents` is the server's; adding `incomeCents` and `expenseCents` up here would
 * be a second implementation of the refund rule, which lives in `@jizhang/shared`.
 *
 * Refresh is explicit, matching the rest of the app: a view that changes money calls
 * `load(true)` and awaits it. There is no reactive invalidation to forget.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client.js';
import type { AccountBalance } from '../api/client.js';

export const useBalanceStore = defineStore('balances', () => {
  const items = ref<AccountBalance[]>([]);
  const totalBalanceCents = ref(0);
  const loaded = ref(false);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  /** `accountId` → balance, for the management screen's rows. */
  const balanceById = computed(() => {
    const map = new Map<string, number>();
    for (const item of items.value) map.set(item.accountId, item.balanceCents);
    return map;
  });

  /** The balance of one account, or `undefined` before the first load. */
  function balanceOf(accountId: string): number | undefined {
    return balanceById.value.get(accountId);
  }

  /**
   * Fetches the balances.
   *
   * @param force refetch even when already loaded — what a view calls after a write.
   */
  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    errorMessage.value = null;
    try {
      const result = await api.accounts.balances();
      items.value = result.items;
      totalBalanceCents.value = result.totalBalanceCents;
      loaded.value = true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  return {
    items,
    totalBalanceCents,
    loaded,
    loading,
    errorMessage,
    balanceById,
    balanceOf,
    load,
  };
});
