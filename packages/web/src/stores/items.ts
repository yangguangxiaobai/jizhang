/** Shared item inventory rows and their server-computed summary. */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ApiError, api } from '../api/client.js';
import type { Item, ItemListQuery, ItemSummary, ItemStatus } from '../api/client.js';

const COMMON_ITEM_CATEGORIES = ['数码', '家居', '摄影', '收藏', '运动', '其他'] as const;

export const useItemsStore = defineStore('items', () => {
  const items = ref<Item[]>([]);
  const summary = ref<ItemSummary | null>(null);
  const total = ref(0);
  const loading = ref(false);
  const summaryLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const summaryErrorMessage = ref<string | null>(null);
  const status = ref<ItemStatus | undefined>(undefined);
  const category = ref('');
  const query = ref('');

  const categories = computed(() =>
    [
      ...new Set([
        ...COMMON_ITEM_CATEGORIES,
        ...items.value.map((item) => item.category).filter((item) => item !== ''),
      ]),
    ].sort((left, right) => left.localeCompare(right, 'zh-CN')),
  );

  function listQuery(): ItemListQuery {
    return {
      status: status.value,
      category: category.value === '' ? undefined : category.value,
      q: query.value.trim() === '' ? undefined : query.value.trim(),
      limit: 200,
    };
  }

  async function load(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const result = await api.items.list(listQuery());
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

  async function loadSummary(): Promise<void> {
    summaryLoading.value = true;
    summaryErrorMessage.value = null;
    try {
      summary.value = await api.items.summary();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) summary.value = null;
      summaryErrorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      summaryLoading.value = false;
    }
  }

  async function reload(): Promise<void> {
    await Promise.all([load(), loadSummary()]);
  }

  function setStatus(value: ItemStatus | undefined): void {
    status.value = value;
    void load();
  }

  function setCategory(value: string): void {
    category.value = value;
    void load();
  }

  function setQuery(value: string): void {
    query.value = value;
    void load();
  }

  async function remove(id: string): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.items.remove(id);
      await reload();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  return {
    items,
    summary,
    total,
    loading,
    summaryLoading,
    errorMessage,
    summaryErrorMessage,
    status,
    category,
    query,
    categories,
    load,
    loadSummary,
    reload,
    setStatus,
    setCategory,
    setQuery,
    remove,
  };
});
