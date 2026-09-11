/**
 * Recurring bills: rules, and the due dates waiting for a decision.
 *
 * A store rather than page-local state because the pending queue is read by TWO places —
 * the dashboard's reminder card and the pending list page — and both must agree on the
 * count. That is the test in `state-management.md`: "would a second page have to fetch
 * this again and could then disagree?".
 *
 * No arithmetic happens here. Amounts are the server's cents and counts are the server's
 * totals, so this screen can never disagree with the ledger.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type {
  RecurringOccurrence,
  RecurringRule,
  RecurringRuleInput,
} from '../api/client.js';

export const useRecurringStore = defineStore('recurring', () => {
  const rules = ref<RecurringRule[]>([]);
  const pending = ref<RecurringOccurrence[]>([]);
  const occurrences = ref<RecurringOccurrence[]>([]);

  const loading = ref(false);
  /** True while a confirm/ignore is in flight, so the view can disable its controls. */
  const busy = ref(false);
  const errorMessage = ref<string | null>(null);

  const pendingCount = computed(() => pending.value.length);
  /** Rules whose backlog exceeded the generation cap — the UI must say so. */
  const truncatedRules = computed(() => rules.value.filter((rule) => rule.hasOlderDue));

  function record(error: unknown): void {
    if (error instanceof ApiError && error.isUnauthorized) return;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }

  async function loadRules(): Promise<void> {
    try {
      rules.value = (await api.recurring.listRules()).items;
    } catch (error) {
      record(error);
    }
  }

  async function loadPending(): Promise<void> {
    try {
      pending.value = (await api.recurring.listPending()).items;
    } catch (error) {
      record(error);
    }
  }

  async function loadOccurrences(): Promise<void> {
    try {
      occurrences.value = (await api.recurring.listOccurrences()).items;
    } catch (error) {
      record(error);
    }
  }

  /**
   * Materialises due occurrences, then reloads the queue.
   *
   * A write endpoint rather than a side effect of reading, so this must be called
   * explicitly when the app opens. Idempotent on the server, so calling it often is
   * harmless.
   *
   * `rules` is reloaded too: generation moves each rule's cursor and may set
   * `hasOlderDue`, and a stale rule list would hide that warning.
   */
  async function generateAndReload(): Promise<void> {
    try {
      await api.recurring.generate();
      await Promise.all([loadPending(), loadRules()]);
    } catch (error) {
      record(error);
    }
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      await Promise.all([loadRules(), loadPending()]);
    } finally {
      loading.value = false;
    }
  }

  /** Runs a mutating call, then refreshes what it could have changed. */
  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    errorMessage.value = null;
    try {
      await action();
      await Promise.all([loadPending(), loadRules()]);
      return true;
    } catch (error) {
      record(error);
      return false;
    } finally {
      busy.value = false;
    }
  }

  const confirmOne = (id: string): Promise<boolean> => mutate(() => api.recurring.confirm(id));
  const ignoreOne = (id: string): Promise<boolean> => mutate(() => api.recurring.ignore(id));

  async function createRule(input: RecurringRuleInput): Promise<boolean> {
    return mutate(async () => {
      await api.recurring.createRule(input);
    });
  }

  async function updateRule(id: string, changes: RecurringRuleInput): Promise<boolean> {
    return mutate(async () => {
      await api.recurring.updateRule(id, changes);
    });
  }

  async function setRuleEnabled(id: string, enabled: boolean): Promise<boolean> {
    return mutate(() => api.recurring.setRuleEnabled(id, enabled));
  }

  async function deleteRule(id: string): Promise<boolean> {
    return mutate(() => api.recurring.removeRule(id));
  }

  return {
    rules,
    pending,
    occurrences,
    loading,
    busy,
    errorMessage,
    pendingCount,
    truncatedRules,
    loadAll,
    loadRules,
    loadPending,
    loadOccurrences,
    generateAndReload,
    confirmOne,
    ignoreOne,
    createRule,
    updateRule,
    setRuleEnabled,
    deleteRule,
  };
});
