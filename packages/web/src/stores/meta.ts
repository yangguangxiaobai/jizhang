/**
 * Master data (categories, accounts, tag vocabulary).
 *
 * Fetched once and cached for the session: it changes rarely and every page needs
 * it, so re-fetching per view would be wasteful on a phone connection. T7 adds the
 * management UI. Soft-deleted rows are fetched separately so historical bills can still
 * resolve a name, while the selectable lists and editors keep seeing live rows only.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { TYPE_EXPENSE, TYPE_INCOME, api } from '../api/client.js';
import type { Account, Category, TagCount } from '../api/client.js';
import { categoryCssColor } from '../utils/category-color.js';

export const useMetaStore = defineStore('meta', () => {
  const categories = ref<Category[]>([]);
  const accounts = ref<Account[]>([]);
  const deletedCategories = ref<Category[]>([]);
  const deletedAccounts = ref<Account[]>([]);
  const tags = ref<TagCount[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  const expenseCategories = computed(() =>
    categories.value.filter((category) => category.type === TYPE_EXPENSE),
  );
  const incomeCategories = computed(() =>
    categories.value.filter((category) => category.type === TYPE_INCOME),
  );

  const categoryById = computed(() => {
    const map = new Map<string, Category>();
    for (const category of categories.value) map.set(category.id, category);
    // Deleted rows are history-only: live rows win, so a name shown in old bills is the
    // one they had when they were deleted.
    for (const category of deletedCategories.value) {
      if (!map.has(category.id)) map.set(category.id, category);
    }
    return map;
  });

  const accountById = computed(() => {
    const map = new Map<string, Account>();
    for (const account of accounts.value) map.set(account.id, account);
    for (const account of deletedAccounts.value) {
      if (!map.has(account.id)) map.set(account.id, account);
    }
    return map;
  });

  /** Category display name, falling back to the raw id if it was deleted. */
  function categoryName(id: string): string {
    return categoryById.value.get(id)?.name ?? id;
  }

  /** Account display name, falling back to the raw id. */
  function accountName(id: string): string {
    return accountById.value.get(id)?.name ?? id;
  }

  /** CSS colour for a category; a theme-aware token when the stored colour is a palette slot. */
  function categoryColor(id: string): string {
    const color = categoryById.value.get(id)?.color;
    if (color === undefined) return 'var(--muted)';
    return categoryCssColor(color);
  }

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    errorMessage.value = null;
    try {
      const [categoryResponse, accountResponse, deletedCategoryResponse, deletedAccountResponse, tagResponse] =
        await Promise.all([
        api.categories.list(),
        api.accounts.list(),
        api.categories.list(undefined, true),
        api.accounts.list(true),
        api.tags.list(),
      ]);
      categories.value = categoryResponse.items;
      accounts.value = accountResponse.items;
      deletedCategories.value = deletedCategoryResponse.items.filter(
        (item) => !categoryResponse.items.some((live) => live.id === item.id),
      );
      deletedAccounts.value = deletedAccountResponse.items.filter(
        (item) => !accountResponse.items.some((live) => live.id === item.id),
      );
      tags.value = tagResponse.items;
      loaded.value = true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  async function refreshTags(): Promise<void> {
    try {
      tags.value = (await api.tags.list()).items;
    } catch {
      // A stale tag list is cosmetic; leave the previous one in place.
    }
  }

  /** Default account for a new transaction: the builtin one, else the first. */
  function defaultAccountId(): string | undefined {
    const builtin = accounts.value.find((account) => account.isBuiltin);
    return builtin?.id ?? accounts.value[0]?.id;
  }

  /** First category of a type, used to preselect in the editor. */
  function firstCategoryId(type: number): string | undefined {
    const list = type === TYPE_INCOME ? incomeCategories.value : expenseCategories.value;
    return list[0]?.id;
  }

  return {
    categories,
    accounts,
    tags,
    loaded,
    loading,
    errorMessage,
    expenseCategories,
    incomeCategories,
    categoryById,
    accountById,
    categoryName,
    accountName,
    categoryColor,
    load,
    refreshTags,
    defaultAccountId,
    firstCategoryId,
  };
});
