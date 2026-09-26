/** Item inventory list: keeps possessions separate from the cash ledger. */
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import { useItemsStore } from '../stores/items.js';
import type { Item, ItemStatus } from '../api/client.js';
import { formatYuan } from '../utils/money.js';

const router = useRouter();
const store = useItemsStore();
const searchText = ref('');

const statusLabel: Record<ItemStatus, string> = {
  active: '使用中',
  idle: '闲置',
  sold: '已售出',
  retired: '已退役',
};

const summary = computed(() => store.summary);
const categories = computed(() => store.categories);
const statusFilters = computed(() => [
  { value: undefined, label: '全部', count: summary.value?.totalItems ?? store.total },
  { value: 'active' as const, label: '使用中', count: summary.value?.activeItems ?? 0 },
  { value: 'idle' as const, label: '闲置', count: summary.value?.idleItems ?? 0 },
  { value: 'sold' as const, label: '已售出', count: summary.value?.soldItems ?? 0 },
  { value: 'retired' as const, label: '已退役', count: summary.value?.retiredItems ?? 0 },
]);

onMounted(() => {
  void store.reload();
});

function openItem(item: Item): void {
  void router.push({ name: 'item-detail', params: { id: item.id } });
}

function addItem(): void {
  void router.push({ name: 'item-new' });
}

function purchaseLabel(item: Item): string {
  return item.purchasePriceCents === null
    ? '购入价未记录'
    : '购入 ' + formatYuan(item.purchasePriceCents);
}

function heldLabel(item: Item): string {
  return item.heldDays === 0 ? '今天开始' : '持有 ' + item.heldDays + ' 天';
}

function dailyCostLabel(item: Item): string {
  return item.dailyCostCents === null
    ? '日均成本 —'
    : '日均 ' + formatYuan(item.dailyCostCents) + '/天';
}

function submitSearch(): void {
  store.setQuery(searchText.value);
}

function clearFilters(): void {
  searchText.value = '';
  store.setQuery('');
  store.setStatus(undefined);
  store.setCategory('');
}
</script>

<template>
  <section class="items-page" aria-label="物品资产">
    <header class="items-heading">
      <div>
        <h2>物品资产</h2>
        <p class="items-hint">记录每件物品的陪伴时间与真实使用成本。</p>
      </div>
      <button class="theme-button items-add" type="button" @click="addItem">
        <AppIcon name="plus" /> 添加物品
      </button>
    </header>

    <section v-if="summary !== null" class="theme-card item-summary" aria-label="物品概览">
      <div class="summary-purchase">
        <span class="summary-label">在册物品购入总额</span>
        <strong class="summary-total">{{ formatYuan(summary.cumulativePurchaseCents) }}</strong>
        <span class="summary-caption">
          {{ summary.activeItems + summary.idleItems }} 件在册 · 已售出 {{ summary.soldItems }} 件
        </span>
      </div>
      <div class="summary-daily">
        <span class="summary-label">日均持有成本</span>
        <strong>{{ formatYuan(summary.currentDailyCostCents) }}<small> / 天</small></strong>
      </div>
      <div class="summary-status" aria-label="物品状态统计">
        <span>使用中 {{ summary.activeItems }}</span>
        <span>闲置 {{ summary.idleItems }}</span>
        <span>退役 {{ summary.retiredItems }}</span>
      </div>
      <p class="summary-note">物品资产独立于账单，不计入账户余额或收支统计。</p>
    </section>
    <p v-else-if="store.summaryErrorMessage !== null" class="notice notice-warning" role="status">
      物品概览暂时无法加载；你仍可以查看物品列表。
    </p>

    <div class="item-filters">
      <div class="status-filters" role="group" aria-label="按物品状态筛选">
        <button
          v-for="filter in statusFilters"
          :key="filter.label"
          type="button"
          class="filter-chip"
          :class="{ active: store.status === filter.value }"
          :aria-pressed="store.status === filter.value"
          @click="store.setStatus(filter.value)"
        >
          {{ filter.label }} <span>{{ filter.count }}</span>
        </button>
      </div>
      <div class="category-strip" role="group" aria-label="按物品分类筛选">
        <button
          type="button"
          class="category-chip"
          :class="{ active: store.category === '' }"
          :aria-pressed="store.category === ''"
          @click="store.setCategory('')"
        >
          全部分类
        </button>
        <button
          v-for="value in categories"
          :key="value"
          type="button"
          class="category-chip"
          :class="{ active: store.category === value }"
          :aria-pressed="store.category === value"
          @click="store.setCategory(value)"
        >
          {{ value }}
        </button>
      </div>
      <div class="filter-row">
        <form class="item-search" role="search" @submit.prevent="submitSearch">
          <label class="visually-hidden" for="item-search-input">搜索物品</label>
          <AppIcon name="search" />
          <input
            id="item-search-input"
            v-model="searchText"
            type="search"
            placeholder="搜索物品名称或备注"
            autocomplete="off"
          />
          <button class="theme-button ghost" type="submit" aria-label="搜索物品">
            <AppIcon name="arrow" />
          </button>
        </form>
        <span class="sort-caption">按购入时间</span>
      </div>
    </div>

    <p v-if="store.loading && store.items.length === 0" class="muted" role="status">
      正在加载物品…
    </p>
    <p v-else-if="store.errorMessage !== null" class="error" role="alert">
      {{ store.errorMessage }}
    </p>
    <section v-else-if="store.items.length === 0" class="theme-card item-empty">
      <AppIcon name="box" />
      <h3>{{ store.total === 0 ? '还没有记录物品' : '没有符合条件的物品' }}</h3>
      <p class="items-hint">
        {{
          store.total === 0
            ? '可以先添加一件常用物品，记录购入时间和价格。'
            : '试试更换分类、状态或搜索词。'
        }}
      </p>
      <button v-if="store.total === 0" class="theme-button" type="button" @click="addItem">
        添加第一件物品
      </button>
      <button v-else class="theme-button ghost" type="button" @click="clearFilters">
        清除筛选
      </button>
    </section>

    <div v-else class="item-grid" aria-label="物品列表">
      <button
        v-for="item in store.items"
        :key="item.id"
        type="button"
        class="theme-card item-card"
        @click="openItem(item)"
      >
        <span class="item-photo">
          <img v-if="item.photoUrl !== null" :src="item.photoUrl" :alt="item.name" loading="lazy" />
          <AppIcon v-else name="box" />
        </span>
        <span class="item-card-body">
          <span class="item-status" :class="'status-' + item.status">{{
            statusLabel[item.status]
          }}</span>
          <strong class="item-name">{{ item.name }}</strong>
          <span class="item-category">{{ item.category }}</span>
          <span class="item-meta">{{ purchaseLabel(item) }} · {{ heldLabel(item) }}</span>
          <span class="item-daily-cost">{{ dailyCostLabel(item) }}</span>
          <span v-if="item.purchaseTransactionId !== null" class="item-linked">已关联购入账单</span>
        </span>
      </button>
    </div>

    <p v-if="store.total > store.items.length" class="list-cap" role="status">
      当前显示 {{ store.items.length }} 件，共 {{ store.total }} 件。可用搜索进一步筛选。
    </p>

    <button class="theme-button items-add-footer" type="button" @click="addItem">
      <AppIcon name="plus" /> 添加物品
    </button>
  </section>
</template>

<style scoped>
.items-page {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.items-heading,
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.items-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.items-heading > div {
  min-width: 0;
}

.items-heading h2 {
  margin: 0;
  font-size: 1.35rem;
}

.items-hint,
.summary-note,
.list-cap {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.items-heading .theme-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 44px;
  max-width: 100%;
  white-space: normal;
  justify-self: end;
  align-self: start;
}

.items-heading .items-add {
  display: none;
}

.item-summary {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  color: var(--on-hero);
  background: var(--hero);
  border: 0;
  box-shadow: var(--lift-1);
}

.summary-purchase,
.summary-daily {
  display: grid;
  align-content: start;
  gap: 0.2rem;
  min-width: 0;
}

.summary-label,
.summary-caption,
.summary-status,
.summary-note {
  color: var(--hero-muted);
  font-size: 0.85rem;
}

.summary-total {
  display: block;
  color: var(--on-hero);
  font-size: clamp(1.7rem, 6vw, 2.25rem);
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.summary-caption {
  font-size: 0.75rem;
}

.summary-daily strong {
  color: var(--on-hero);
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
}

.summary-daily small {
  color: var(--hero-muted);
  font-size: 0.7em;
  font-weight: 500;
}

.summary-status {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: 0.35rem 0.8rem;
  font-size: 0.75rem;
}

.summary-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.72rem;
}

.status-filters {
  display: flex;
  gap: 0.45rem;
  overflow-x: auto;
  padding: 0.1rem 0 0.25rem;
  scrollbar-width: thin;
}

.filter-chip span {
  margin-left: 0.15rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.item-filters {
  display: grid;
  gap: 0.4rem;
}

.category-strip {
  display: flex;
  overflow-x: auto;
  gap: 0.35rem;
  padding: 0.1rem 0 0.35rem;
  scrollbar-width: none;
}

.category-strip::-webkit-scrollbar {
  display: none;
}

.category-chip {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0.4rem 0.7rem;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 0.8rem;
  white-space: nowrap;
}

.category-chip.active {
  color: var(--accent);
  background: var(--accent-subtle);
  border-color: var(--accent-subtle);
  font-weight: 650;
}

.filter-chip {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0.45rem 0.75rem;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font: inherit;
  font-size: 0.85rem;
}

.filter-chip.active {
  color: var(--accent);
  background: var(--accent-subtle);
  border-color: var(--accent);
  font-weight: 600;
}

.item-search {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding-left: 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}

.item-search > .app-icon {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  color: var(--muted);
}

.item-search input {
  min-width: 0;
  min-height: 44px;
  padding: 0.5rem 0.2rem;
  color: var(--fg);
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 16px;
}

.item-search input {
  flex: 1;
  width: 100%;
}

.item-search .theme-button {
  min-width: 44px;
  min-height: 44px;
  padding: 0.4rem;
  border: 0;
}

.sort-caption {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 0.78rem;
}

.items-add-footer {
  position: sticky;
  bottom: calc(4.35rem + env(safe-area-inset-bottom));
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 48px;
  width: 100%;
  margin-top: 0.1rem;
  box-shadow: var(--lift-1);
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.item-card {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  padding: 0.5rem;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-out),
    box-shadow var(--dur-quick) var(--ease-out);
}

.item-card:active {
  transform: scale(0.985);
}

.item-photo {
  display: grid;
  place-items: center;
  aspect-ratio: 1.55;
  overflow: hidden;
  color: var(--accent);
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.item-photo :deep(.app-icon) {
  width: 2rem;
  height: 2rem;
}

.item-photo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.item-card-body {
  display: grid;
  align-content: start;
  gap: 0.22rem;
  min-width: 0;
  padding: 0.55rem 0.15rem 0.25rem;
}

.item-status {
  width: fit-content;
  padding: 0.1rem 0.4rem;
  color: var(--ok);
  background: var(--ok-subtle);
  border-radius: 999px;
  font-size: 0.7rem;
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

.item-name {
  overflow: hidden;
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-category,
.item-meta,
.item-linked {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-daily-cost {
  color: var(--accent);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.item-linked {
  color: var(--accent);
}

.item-empty {
  display: grid;
  justify-items: center;
  gap: 0.65rem;
  padding: 2rem 1rem;
  text-align: center;
}

.item-empty :deep(.app-icon) {
  width: 2.5rem;
  height: 2.5rem;
  color: var(--accent);
}

.item-empty h3,
.item-empty p {
  margin: 0;
}

.item-empty .theme-button {
  min-height: 44px;
  margin-top: 0.3rem;
}

.list-cap {
  text-align: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (min-width: 40rem) {
  .item-summary {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.65fr) minmax(0, 0.9fr);
    padding: 1.25rem 1.5rem;
  }

  .summary-status {
    grid-column: auto;
    display: grid;
    align-content: center;
    gap: 0.35rem;
    min-height: 4rem;
    padding-left: 1.2rem;
    border-left: 1px solid color-mix(in srgb, var(--hero-muted) 35%, transparent);
  }

  .summary-note {
    grid-column: 1 / -1;
  }

  .item-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
  }

  .item-photo {
    aspect-ratio: 1.8;
  }

  .items-add-footer {
    display: none;
  }

  .items-heading .items-add {
    display: inline-flex;
  }
}

@media (min-width: 64rem) {
  .items-page {
    gap: 1.1rem;
  }

  .items-heading h2 {
    font-size: 1.65rem;
  }

  .item-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }

  .item-card {
    grid-template-columns: minmax(116px, 0.62fr) minmax(0, 1fr);
    grid-template-rows: 1fr;
    gap: 0.85rem;
    align-items: stretch;
    padding: 0.7rem;
  }

  .item-photo {
    aspect-ratio: 0.8;
    min-height: 9.5rem;
  }

  .item-card-body {
    align-content: center;
    gap: 0.4rem;
    padding: 0.3rem 0.15rem;
  }

  .item-name {
    font-size: 1rem;
  }

  .item-category,
  .item-meta,
  .item-linked {
    font-size: 0.8rem;
  }
}
</style>
