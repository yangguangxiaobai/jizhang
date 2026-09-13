/**
 * Transfer list state: the rows, the total, and a filter to one account.
 *
 * Same shape as `stores/transactions.ts` — a filtered list with its own loader — because the
 * transfers page and the account drill-down need exactly that and nothing more.
 *
 * Nothing here computes money. A transfer's effect on a balance is the server's figure in
 * `stores/balances.ts`; this store only holds rows.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';
import type { Transfer } from '../api/client.js';

export const useTransfersStore = defineStore('transfers', () => {
  const items = ref<Transfer[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  /** `undefined` = every account. A string narrows to the transfers touching that account. */
  const accountFilter = ref<string | undefined>(undefined);

  async function load(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const result = await api.transfers.list(
        accountFilter.value === undefined ? {} : { accountId: accountFilter.value },
      );
      items.value = result.items;
      total.value = result.total;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api.transfers.remove(id);
      await load();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  function setAccountFilter(accountId: string | undefined): void {
    accountFilter.value = accountId;
  }

  return { items, total, loading, errorMessage, accountFilter, load, remove, setAccountFilter };
});
