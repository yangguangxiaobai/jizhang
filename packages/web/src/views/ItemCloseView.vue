/** Dedicated end-of-holding flow for selling or retiring one item. */
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import ItemTransactionPicker from '../components/ItemTransactionPicker.vue';
import { api } from '../api/client.js';
import type { Item, Transaction } from '../api/client.js';
import { useItemsStore } from '../stores/items.js';
import {
  formatCents,
  formatDayLabel,
  formatYuan,
  fromDateInputValue,
  parseOptionalYuanToCents,
  toDateInputValue,
} from '../utils/money.js';

const route = useRoute();
const router = useRouter();
const itemsStore = useItemsStore();
const item = ref<Item | null>(null);
const mode = ref<'sold' | 'retired'>('sold');
const closedDateText = ref(toDateInputValue(Date.now()));
const salePriceText = ref('');
const saleTransactionId = ref<string | null>(null);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref<string | null>(null);

const itemId = computed(() => {
  const value = route.params['id'];
  return typeof value === 'string' && value !== '' ? value : null;
});
const salePriceCents = computed(() => parseOptionalYuanToCents(salePriceText.value));
const salePriceInvalid = computed(
  () => salePriceText.value.trim() !== '' && salePriceCents.value === null,
);

onMounted(async () => {
  const initialMode = route.query['mode'];
  if (initialMode === 'retired') mode.value = 'retired';
  await loadItem();
});

async function loadItem(): Promise<void> {
  if (itemId.value === null) {
    errorMessage.value = '物品编号缺失。';
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const loaded = await api.items.get(itemId.value);
    if (loaded.status !== 'active' && loaded.status !== 'idle') {
      errorMessage.value = '只有使用中或闲置的物品可以结束持有。';
      return;
    }
    item.value = loaded;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function setMode(next: 'sold' | 'retired'): void {
  mode.value = next;
  errorMessage.value = null;
  if (next === 'retired') {
    salePriceText.value = '';
    saleTransactionId.value = null;
  }
}

function onSaleTransactionSelected(transaction: Transaction | null): void {
  if (transaction === null) return;
  salePriceText.value = formatCents(transaction.amountCents);
  closedDateText.value = toDateInputValue(transaction.date);
}

async function save(): Promise<void> {
  if (saving.value || item.value === null) return;
  errorMessage.value = null;
  const closedDate = fromDateInputValue(closedDateText.value);
  if (closedDate === null) {
    errorMessage.value = '请选择有效的结束日期。';
    return;
  }
  if (salePriceInvalid.value) {
    errorMessage.value = '售出价格请输入有效的非负金额。';
    return;
  }

  saving.value = true;
  try {
    if (mode.value === 'sold') {
      await api.items.sell(item.value.id, {
        closedDate,
        salePriceCents: salePriceCents.value,
        saleTransactionId: saleTransactionId.value,
      });
    } else {
      await api.items.retire(item.value.id, { closedDate });
    }
    await itemsStore.reload();
    await router.replace({ name: 'item-detail', params: { id: item.value.id } });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

function cancel(): void {
  if (item.value === null) void router.replace({ name: 'items' });
  else void router.replace({ name: 'item-detail', params: { id: item.value.id } });
}
</script>

<template>
  <section class="item-close-page" aria-label="结束物品持有">
    <header class="close-heading">
      <button class="theme-button ghost close-back" type="button" @click="cancel">
        <AppIcon name="chevron" /> 返回物品
      </button>
      <div>
        <h2>结束持有</h2>
        <p class="hint">记录物品的去向，保留完整持有成本。</p>
      </div>
    </header>

    <p v-if="loading" class="muted" role="status">正在加载物品…</p>
    <p v-else-if="errorMessage !== null && item === null" class="error" role="alert">
      {{ errorMessage }}
    </p>

    <template v-else-if="item !== null">
      <section class="theme-card closing-item" aria-label="当前物品">
        <div class="closing-photo">
          <img v-if="item.photoUrl !== null" :src="item.photoUrl" :alt="item.name" />
          <AppIcon v-else name="box" />
        </div>
        <div class="closing-item-copy">
          <span class="item-state">{{ item.status === 'idle' ? '闲置中' : '使用中' }}</span>
          <strong>{{ item.name }}</strong>
          <span>{{ item.category }} · 购入于 {{ formatDayLabel(item.purchaseDate) }}</span>
        </div>
      </section>

      <div class="close-mode" role="group" aria-label="结束方式">
        <button
          type="button"
          :class="{ active: mode === 'sold' }"
          :aria-pressed="mode === 'sold'"
          @click="setMode('sold')"
        >
          已售出
        </button>
        <button
          type="button"
          :class="{ active: mode === 'retired' }"
          :aria-pressed="mode === 'retired'"
          @click="setMode('retired')"
        >
          已退役
        </button>
      </div>

      <form class="close-form" @submit.prevent="save">
        <section class="theme-card close-fields">
          <label v-if="mode === 'sold'" class="field">
            <span>售出价格（可留空）</span>
            <input
              v-model="salePriceText"
              inputmode="decimal"
              autocomplete="off"
              placeholder="例如：4000.00"
            />
          </label>
          <label class="field">
            <span>{{ mode === 'sold' ? '售出日期' : '退役日期' }}</span>
            <input v-model="closedDateText" type="date" required />
          </label>

          <ItemTransactionPicker
            v-if="mode === 'sold'"
            :model-value="saleTransactionId"
            purpose="sale"
            :disabled="saving"
            @update:model-value="saleTransactionId = $event"
            @selected="onSaleTransactionSelected"
          />
        </section>

        <section class="theme-card holding-summary" aria-label="当前持有记录">
          <div>
            <span>购入价格</span>
            <strong>{{
              item.purchasePriceCents === null ? '未记录' : formatYuan(item.purchasePriceCents)
            }}</strong>
          </div>
          <div>
            <span>已持有</span>
            <strong>{{ item.heldDays }} 天</strong>
          </div>
          <p>
            {{
              mode === 'sold'
                ? '售出收入可关联已有账单；不会重复记账。'
                : '退役只结束持有记录，不会产生账单。'
            }}
          </p>
        </section>

        <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>

        <div class="close-actions">
          <button class="theme-button ghost" type="button" :disabled="saving" @click="cancel">
            取消
          </button>
          <button class="theme-button" type="submit" :disabled="saving || salePriceInvalid">
            {{ saving ? '保存中…' : mode === 'sold' ? '确认售出' : '确认退役' }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.item-close-page {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
  max-width: 42rem;
  margin: 0 auto;
  padding-bottom: 1rem;
}

.close-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.6rem;
}

.close-back {
  min-height: 44px;
  padding-inline: 0.55rem;
  white-space: nowrap;
}

.close-heading h2,
.close-heading p {
  margin: 0;
}

.close-heading h2 {
  font-size: 1.1rem;
}

.close-heading .hint {
  margin-top: 0.15rem;
  font-size: 0.78rem;
}

.closing-item {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
}

.closing-photo {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  overflow: hidden;
  color: var(--accent);
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.closing-photo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.closing-item-copy {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.closing-item-copy strong {
  overflow-wrap: anywhere;
  font-size: 1rem;
}

.closing-item-copy > span:last-child {
  color: var(--muted);
  font-size: 0.78rem;
}

.item-state {
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
}

.close-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.25rem;
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.close-mode button {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-control);
  font: inherit;
}

.close-mode button.active {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 650;
}

.close-form {
  display: grid;
  gap: 0.8rem;
  padding-bottom: 0.2rem;
}

.close-fields,
.holding-summary {
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span,
.holding-summary span {
  color: var(--muted);
  font-size: 0.82rem;
}

.field input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.55rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  box-sizing: border-box;
  font: inherit;
  font-size: 16px;
}

.holding-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.holding-summary > div {
  display: grid;
  gap: 0.25rem;
}

.holding-summary strong {
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}

.holding-summary p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}

.close-actions {
  position: sticky;
  bottom: calc(4.45rem + env(safe-area-inset-bottom));
  z-index: 2;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.55rem;
  padding: 0.45rem 0;
  background: var(--bg);
}

.close-actions button {
  min-height: 48px;
}

@media (min-width: 40rem) {
  .item-close-page,
  .close-form {
    gap: 1rem;
  }

  .closing-item,
  .close-fields,
  .holding-summary {
    padding: 1.15rem;
  }
}
</style>
