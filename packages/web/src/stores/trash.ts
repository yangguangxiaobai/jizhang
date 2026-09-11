/**
 * Recycle-bin state.
 *
 * A store rather than page-local `ref`s, which is the opposite call from the dashboard.
 * The reason is the test in `state-management.md`: "would a second page have to fetch
 * this again and could then disagree?". Restoring or emptying the bin changes what the
 * transaction list and the budget page show, and the bin is the *reverse* entry point
 * into that same data — so the writes need a nameable place to live and a clear reload
 * point, instead of being buried inside one component.
 *
 * This store never computes a total. Row counts come from the server's `total`, and the
 * amounts it renders are the server's cents, so the bin cannot disagree with the list.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type { Transaction } from '../api/client.js';

export const useTrashStore = defineStore('trash', () => {
  const items = ref<Transaction[]>([]);
  const total = ref(0);
  const loading = ref(false);
  /** True while a restore/purge is in flight, so the view can disable its controls. */
  const busy = ref(false);
  const errorMessage = ref<string | null>(null);

  const isEmpty = computed(() => items.value.length === 0);

  /** Swallows a 401 (the router is already redirecting) but surfaces everything else. */
  function record(error: unknown): void {
    if (error instanceof ApiError && error.isUnauthorized) return;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }

  async function load(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const result = await api.trash.list();
      items.value = result.items;
      total.value = result.total;
    } catch (error) {
      record(error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Runs one mutating call and reloads the bin.
   *
   * Reloading rather than editing `items` locally: the server decides the resulting
   * order and count, and a purge removes a row entirely, so a local splice would be a
   * second implementation of the endpoint's behaviour.
   */
  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    errorMessage.value = null;
    try {
      await action();
      await load();
      return true;
    } catch (error) {
      record(error);
      return false;
    } finally {
      busy.value = false;
    }
  }

  const restoreOne = (id: string): Promise<boolean> => mutate(() => api.trash.restore(id));
  const purgeOne = (id: string): Promise<boolean> => mutate(() => api.trash.purge(id));
  const restoreAll = (): Promise<boolean> => mutate(() => api.trash.restoreAll());
  const purgeAll = (): Promise<boolean> => mutate(() => api.trash.purgeAll());

  return {
    items,
    total,
    loading,
    busy,
    errorMessage,
    isEmpty,
    load,
    restoreOne,
    purgeOne,
    restoreAll,
    purgeAll,
  };
});
