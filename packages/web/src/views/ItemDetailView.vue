/** Detail and lifecycle actions for one possession, without writing to the cash ledger. */
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import ItemTransactionPicker from '../components/ItemTransactionPicker.vue';
import { api } from '../api/client.js';
import type { Item, ItemStatus, Transaction } from '../api/client.js';
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
const purchaseTransaction = ref<Transaction | null>(null);
const purchaseLinkUnavailable = ref(false);
const saleTransaction = ref<Transaction | null>(null);
const saleLinkUnavailable = ref(false);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref<string | null>(null);
const closingMode = ref<'sold' | 'retired' | null>(null);
const closeDateText = ref(toDateInputValue(Date.now()));
const salePriceText = ref('');
const saleTransactionId = ref<string | null>(null);

const itemId = computed(() => {
  const value = route.params['id'];
  return typeof value === 'string' && value !== '' ? value : null;
});

const statusLabels: Record<ItemStatus, string> = {
  active: '使用中',
  idle: '闲置',
  sold: '已售出',
  retired: '已退役',
};

const isOpen = computed(() => item.value?.status === 'active' || item.value?.status === 'idle');

function transactionLabel(transaction: Transaction): string {
  const note = transaction.note.trim() === '' ? '未命名账单' : transaction.note.trim();
  return (
    formatDayLabel(transaction.date) + ' · ' + note + ' · ' + formatYuan(transaction.amountCents)
  );
}

async function loadTransaction(id: string | null): Promise<Transaction | null> {
  if (id === null) return null;
  try {
    return await api.transactions.get(id);
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  if (itemId.value === null) {
    errorMessage.value = '物品编号缺失。';
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  purchaseTransaction.value = null;
  saleTransaction.value = null;
  purchaseLinkUnavailable.value = false;
  saleLinkUnavailable.value = false;
  try {
    const loaded = await api.items.get(itemId.value);
    item.value = loaded;
    const [purchase, sale] = await Promise.all([
      loadTransaction(loaded.purchaseTransactionId),
      loadTransaction(loaded.saleTransactionId),
    ]);
    purchaseTransaction.value = purchase;
    saleTransaction.value = sale;
    purchaseLinkUnavailable.value = loaded.purchaseTransactionId !== null && purchase === null;
    saleLinkUnavailable.value = loaded.saleTransactionId !== null && sale === null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

function editItem(): void {
  if (item.value !== null) {
    void router.push({ name: 'item-edit', params: { id: item.value.id } });
  }
}

function beginClosure(mode: 'sold' | 'retired'): void {
  closingMode.value = mode;
  closeDateText.value = toDateInputValue(Date.now());
  salePriceText.value = '';
  saleTransactionId.value = null;
  errorMessage.value = null;
}

function cancelClosure(): void {
  closingMode.value = null;
  errorMessage.value = null;
}

function onSaleTransactionSelected(transaction: Transaction | null): void {
  if (transaction === null) return;
  salePriceText.value = formatCents(transaction.amountCents);
  closeDateText.value = toDateInputValue(transaction.date);
}

async function saveClosure(): Promise<void> {
  if (saving.value || item.value === null || closingMode.value === null) return;
  errorMessage.value = null;
  const closedDate = fromDateInputValue(closeDateText.value);
  if (closedDate === null) {
    errorMessage.value = '请选择有效的结束日期。';
    return;
  }
  let salePriceCents: number | null = null;
  if (closingMode.value === 'sold') {
    salePriceCents = parseOptionalYuanToCents(salePriceText.value);
    if (salePriceText.value.trim() !== '' && salePriceCents === null) {
      errorMessage.value = '售出价格请输入有效的非负金额。';
      return;
    }
  }

  saving.value = true;
  try {
    if (closingMode.value === 'sold') {
      await api.items.sell(item.value.id, {
        closedDate,
        salePriceCents,
        saleTransactionId: saleTransactionId.value,
      });
    } else {
      await api.items.retire(item.value.id, { closedDate });
    }
    closingMode.value = null;
    await Promise.all([load(), itemsStore.reload()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function reopen(): Promise<void> {
  if (saving.value || item.value === null) return;
  if (!window.confirm('重新启用这件物品？原售出/退役日期与售出金额会清除，账单不会变化。')) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    await api.items.update(item.value.id, { status: 'active' });
    await Promise.all([load(), itemsStore.reload()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function deleteItem(): Promise<void> {
  if (saving.value || item.value === null) return;
  if (!window.confirm('删除这件物品记录？关联的账单不会被删除或修改。')) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    await api.items.remove(item.value.id);
    await itemsStore.reload();
    await router.replace({ name: 'items' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

function amountLabel(value: number | null): string {
  return value === null ? '未记录' : formatYuan(value);
}

function dailyLabel(value: number | null): string {
  return value === null ? '—' : formatYuan(value);
}
</script>

<template>
  <section class="item-detail-page" aria-label="物品详情">
    <header class="detail-heading">
      <button class="theme-button ghost" type="button" @click="router.push({ name: 'items' })">
        <AppIcon name="chevron" /> 物品列表
      </button>
      <div class="detail-heading-actions">
        <button
          class="theme-button ghost"
          type="button"
          :disabled="item === null"
          @click="editItem"
        >
          编辑
        </button>
        <button
          class="theme-button ghost danger-action"
          type="button"
          :disabled="item === null"
          @click="deleteItem"
        >
          删除
        </button>
      </div>
    </header>

    <p v-if="loading" class="muted" role="status">正在加载物品…</p>
    <p v-else-if="errorMessage !== null && item === null" class="error" role="alert">
      {{ errorMessage }}
    </p>

    <template v-else-if="item !== null">
      <section class="theme-card item-hero">
        <div class="item-hero-photo">
          <img v-if="item.photoUrl !== null" :src="item.photoUrl" :alt="item.name" />
          <AppIcon v-else name="box" />
        </div>
        <span class="item-status" :class="'status-' + item.status">{{
          statusLabels[item.status]
        }}</span>
        <h2>{{ item.name }}</h2>
        <p class="hint">{{ item.category }} · 购入于 {{ formatDayLabel(item.purchaseDate) }}</p>
      </section>

      <section class="item-metrics" aria-label="持有成本">
        <article class="theme-card metric-card">
          <span>持有时间</span>
          <strong>{{ item.heldDays }} 天</strong>
        </article>
        <article class="theme-card metric-card">
          <span>日均净成本</span>
          <strong>{{ dailyLabel(item.dailyCostCents) }}</strong>
        </article>
      </section>

      <section class="theme-card detail-card">
        <h3>物品信息</h3>
        <dl>
          <div>
            <dt>购入价格</dt>
            <dd>{{ amountLabel(item.purchasePriceCents) }}</dd>
          </div>
          <div v-if="item.brand !== ''">
            <dt>品牌</dt>
            <dd>{{ item.brand }}</dd>
          </div>
          <div v-if="item.model !== ''">
            <dt>型号</dt>
            <dd>{{ item.model }}</dd>
          </div>
          <div v-if="item.closedDate !== null">
            <dt>{{ item.status === 'sold' ? '售出日期' : '退役日期' }}</dt>
            <dd>{{ formatDayLabel(item.closedDate) }}</dd>
          </div>
          <div v-if="item.status === 'sold'">
            <dt>售出金额</dt>
            <dd>{{ amountLabel(item.salePriceCents) }}</dd>
          </div>
        </dl>
        <p v-if="item.note !== ''" class="detail-note">{{ item.note }}</p>
      </section>

      <section v-if="item.purchaseTransactionId !== null" class="theme-card linked-card">
        <h3>关联的购入账单</h3>
        <p v-if="purchaseTransaction !== null">{{ transactionLabel(purchaseTransaction) }}</p>
        <p v-else-if="purchaseLinkUnavailable" class="hint">
          原账单已删除或不可用；物品记录仍保留。
        </p>
      </section>

      <section v-if="item.saleTransactionId !== null" class="theme-card linked-card">
        <h3>关联的售出账单</h3>
        <p v-if="saleTransaction !== null">{{ transactionLabel(saleTransaction) }}</p>
        <p v-else-if="saleLinkUnavailable" class="hint">原账单已删除或不可用；物品记录仍保留。</p>
      </section>

      <section class="theme-card history-card">
        <h3>持有记录</h3>
        <p>{{ formatDayLabel(item.purchaseDate) }} · 购入并开始记录</p>
        <p v-if="item.closedDate !== null">
          {{ formatDayLabel(item.closedDate) }} · {{ item.status === 'sold' ? '售出' : '退役' }}
        </p>
        <p v-else>今天 · 已持有 {{ item.heldDays }} 天 · {{ statusLabels[item.status] }}</p>
      </section>

      <section v-if="isOpen" class="lifecycle-actions">
        <button
          class="theme-button ghost"
          type="button"
          :disabled="saving"
          @click="beginClosure('retired')"
        >
          标记退役
        </button>
        <button class="theme-button" type="button" :disabled="saving" @click="beginClosure('sold')">
          记录售出
        </button>
      </section>
      <section v-else class="theme-card reopen-card">
        <p class="hint">此物品已结束持有。重新启用会清除结束日期和售出金额，但不会影响账单。</p>
        <button class="theme-button ghost" type="button" :disabled="saving" @click="reopen">
          重新启用
        </button>
      </section>

      <section v-if="closingMode !== null" class="theme-card close-form">
        <h3>{{ closingMode === 'sold' ? '记录售出' : '记录退役' }}</h3>
        <label class="field">
          <span>{{ closingMode === 'sold' ? '售出日期' : '退役日期' }}</span>
          <input v-model="closeDateText" type="date" required />
        </label>
        <template v-if="closingMode === 'sold'">
          <label class="field">
            <span>售出价格（可留空）</span>
            <input v-model="salePriceText" inputmode="decimal" placeholder="例如：4000.00" />
          </label>
          <ItemTransactionPicker
            :model-value="saleTransactionId"
            purpose="sale"
            :disabled="saving"
            @update:model-value="saleTransactionId = $event"
            @selected="onSaleTransactionSelected"
          />
        </template>
        <p class="hint">这里只记录物品生命周期；关联账单是可选的，不会新增或修改账单。</p>
        <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>
        <div class="close-actions">
          <button class="theme-button" type="button" :disabled="saving" @click="saveClosure">
            {{ saving ? '保存中…' : closingMode === 'sold' ? '确认售出' : '确认退役' }}
          </button>
          <button
            class="theme-button ghost"
            type="button"
            :disabled="saving"
            @click="cancelClosure"
          >
            取消
          </button>
        </div>
      </section>

      <p v-if="errorMessage !== null && closingMode === null" class="error" role="alert">
        {{ errorMessage }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.item-detail-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.detail-heading,
.detail-heading-actions,
.lifecycle-actions,
.close-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.detail-heading > button,
.detail-heading-actions button,
.lifecycle-actions button,
.close-actions button {
  min-height: 44px;
}

.detail-heading-actions {
  justify-content: flex-end;
}

.danger-action {
  color: var(--danger);
}

.item-hero {
  display: grid;
  gap: 0.4rem;
  padding: 1rem;
}

.item-hero-photo {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1.7;
  overflow: hidden;
  color: var(--accent);
  background: var(--surface-soft);
  border-radius: var(--radius-card);
}

.item-hero-photo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.item-hero-photo :deep(.app-icon) {
  width: 3rem;
  height: 3rem;
}

.item-status {
  width: fit-content;
  margin-top: 0.2rem;
  padding: 0.18rem 0.55rem;
  color: var(--ok);
  background: var(--ok-subtle);
  border-radius: 999px;
  font-size: 0.78rem;
}

.status-idle {
  color: var(--warning);
  background: var(--warning-subtle);
}

.status-sold,
.status-retired {
  color: var(--muted);
  background: var(--surface-soft);
}

.item-hero h2,
.item-hero p {
  margin: 0;
}

.item-hero h2 {
  font-size: 1.3rem;
}

.item-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.metric-card {
  display: grid;
  gap: 0.35rem;
  padding: 0.85rem;
}

.metric-card span,
.detail-card dt {
  color: var(--muted);
  font-size: 0.82rem;
}

.metric-card strong {
  color: var(--accent);
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
}

.detail-card,
.linked-card,
.history-card,
.reopen-card,
.close-form {
  padding: 1rem;
}

.detail-card h3,
.linked-card h3,
.history-card h3,
.close-form h3 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
}

.detail-card dl {
  display: grid;
  gap: 0.5rem;
  margin: 0;
}

.detail-card dl > div {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
}

.detail-card dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}

.detail-note,
.linked-card p,
.history-card p,
.reopen-card p {
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.history-card p + p {
  margin-top: 0.65rem;
}

.reopen-card {
  display: grid;
  gap: 0.65rem;
}

.reopen-card button {
  min-height: 44px;
}

.close-form {
  display: grid;
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span {
  color: var(--muted);
  font-size: 0.85rem;
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

.close-actions {
  justify-content: flex-start;
}

.close-actions .theme-button {
  flex: 1;
}

@media (min-width: 40rem) {
  .item-detail-page {
    gap: 1rem;
  }

  .item-hero-photo {
    aspect-ratio: 2.4;
  }
}
</style>
