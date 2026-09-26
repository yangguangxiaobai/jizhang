/** Optional read-only link to an existing purchase or sale transaction. */
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, TYPE_EXPENSE, TYPE_INCOME } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const props = defineProps<{
  modelValue: string | null;
  purpose: 'purchase' | 'sale';
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
  selected: [transaction: Transaction | null];
}>();

const transactions = ref<Transaction[]>([]);
const current = ref<Transaction | null>(null);
const unavailableCurrentId = ref<string | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const searchText = ref('');

const transactionType = computed(() => (props.purpose === 'purchase' ? TYPE_EXPENSE : TYPE_INCOME));
const title = computed(() =>
  props.purpose === 'purchase' ? '关联已有支出 · 可选' : '关联已有收入 · 可选',
);
const help = computed(() =>
  props.purpose === 'purchase' ? '只建立关联，不会重复记账。' : '只建立关联，不会自动新增收入。',
);

function label(item: Transaction): string {
  const note = item.note.trim() === '' ? '未命名账单' : item.note.trim();
  return formatDayLabel(item.date) + ' · ' + note + ' · ' + formatYuan(item.amountCents);
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    const result = await api.transactions.list({
      type: transactionType.value,
      limit: 100,
      q: searchText.value.trim() === '' ? undefined : searchText.value.trim(),
    });
    transactions.value = result.items.filter((item) => !item.isRefund);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }

  await resolveCurrent(props.modelValue);
}

async function resolveCurrent(id: string | null): Promise<void> {
  if (id !== null) {
    const inList = transactions.value.find((item) => item.id === id);
    if (inList !== undefined) {
      current.value = inList;
      unavailableCurrentId.value = null;
      return;
    }
    try {
      const item = await api.transactions.get(id);
      if (item.type === transactionType.value && !item.isRefund) {
        current.value = item;
        unavailableCurrentId.value = null;
        return;
      }
    } catch {
      // Preserve the old id in the item record; never restore or mutate a deleted bill.
    }
    current.value = null;
    unavailableCurrentId.value = id;
  } else {
    current.value = null;
    unavailableCurrentId.value = null;
  }
}

function change(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const id = select.value === '' ? null : select.value;
  const selected = transactions.value.find((item) => item.id === id) ?? null;
  current.value = selected;
  unavailableCurrentId.value = null;
  emit('update:modelValue', id);
  emit('selected', selected);
}

const currentOutsideResults = computed(
  () => current.value !== null && !transactions.value.some((item) => item.id === current.value?.id),
);

onMounted(load);
watch(
  () => props.modelValue,
  (value) => void resolveCurrent(value),
);
</script>

<template>
  <section class="item-transaction-picker">
    <label>
      <span class="picker-title">{{ title }}</span>
      <span class="picker-help">{{ help }}</span>
      <span class="transaction-search">
        <input
          v-model="searchText"
          type="search"
          :disabled="disabled || loading"
          placeholder="搜索较早的账单"
          autocomplete="off"
        />
        <button
          class="theme-button ghost"
          type="button"
          :disabled="disabled || loading"
          @click="load"
        >
          {{ loading ? '查找中…' : '查找' }}
        </button>
      </span>
      <select :value="modelValue ?? ''" :disabled="disabled || loading" @change="change">
        <option value="">不关联账单</option>
        <option v-if="currentOutsideResults && current !== null" :value="current.id">
          {{ label(current) }}
        </option>
        <option v-if="unavailableCurrentId !== null" :value="unavailableCurrentId" disabled>
          原关联账单已删除或不可用
        </option>
        <option v-for="item in transactions" :key="item.id" :value="item.id">
          {{ label(item) }}
        </option>
      </select>
    </label>
    <p v-if="current !== null" class="linked-preview">当前关联：{{ label(current) }}</p>
    <p v-else-if="unavailableCurrentId !== null" class="linked-missing">
      原账单已不可用；物品记录仍保留，不会改动账单。
    </p>
    <p v-else-if="errorMessage !== null" class="picker-error" role="status">
      暂时无法加载账单列表，仍可独立保存物品。
    </p>
  </section>
</template>

<style scoped>
.item-transaction-picker {
  display: grid;
  gap: 0.35rem;
}

label {
  display: grid;
  gap: 0.35rem;
}

.picker-title {
  color: var(--fg);
  font-size: 0.9rem;
  font-weight: 600;
}

.picker-help,
.linked-preview,
.linked-missing,
.picker-error {
  color: var(--muted);
  font-size: 0.8rem;
}

select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.55rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font: inherit;
  font-size: 16px;
}

.transaction-search {
  display: flex;
  gap: 0.45rem;
}

.transaction-search input {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.5rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font: inherit;
  font-size: 16px;
}

.transaction-search button {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0.4rem 0.7rem;
}

.linked-preview,
.linked-missing,
.picker-error {
  margin: 0;
}
</style>
