<script setup lang="ts">
/**
 * Recycle bin: what was deleted, and two ways to act on it.
 *
 * Restoring is safe; emptying is not, so the two are kept visually and textually
 * distinct rather than being a pair of similar-looking buttons. Nothing here computes an
 * amount — the rows are the server's, and the count is the server's `total`.
 *
 * The list is refreshed from the server after every action rather than being edited
 * locally, so the page can never show a row that is already gone.
 */
import { incomeContribution, expenseContribution } from '@jizhang/shared';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { TYPE_EXPENSE } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useMetaStore } from '../stores/meta.js';
import { useTrashStore } from '../stores/trash.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const trash = useTrashStore();
const balances = useBalanceStore();
const meta = useMetaStore();
const router = useRouter();

onMounted(async () => {
  await Promise.all([trash.load(), meta.load()]);
});

/** The primary line: the note, falling back to the category like the bill list does. */
function rowTitle(item: Transaction): string {
  const note = item.note.trim();
  return note === '' ? meta.categoryName(item.categoryId) : note;
}

/** `"9月2日 周三 · 餐饮"`, matching the transaction list's subtitle. */
function rowSubtitle(item: Transaction): string {
  return `${formatDayLabel(item.date)} · ${meta.categoryName(item.categoryId)}`;
}

/** The deletion stamp. `updatedAt` is the deletion time while a row sits in the bin. */
function deletedLabel(item: Transaction): string {
  return `删除于 ${formatDayLabel(item.updatedAt)}`;
}

/**
 * The ledger's own polarity: spending negative, income (refunds included) positive. Kept
 * identical to the bill list so one row never reads `-400` on one screen and `+400`
 * on another.
 */
function displayAmountCents(item: Transaction): number {
  return item.type === TYPE_EXPENSE ? expenseContribution(item) : incomeContribution(item);
}

const totalLabel = computed(() => `${trash.total} 笔已删除账单`);

async function restoreOne(item: Transaction): Promise<void> {
  await trash.restoreOne(item.id);
  // Restoring puts the money back into its account, so the cached balance is stale.
  await balances.load(true);
}

async function purgeOne(item: Transaction): Promise<void> {
  const label = rowTitle(item);
  // The wording has to carry the consequence: this is the one irreversible action here.
  if (!window.confirm(`彻底删除「${label}」？\n\n该账单将被永久删除，此操作不可撤销。`)) return;
  await trash.purgeOne(item.id);
  await balances.load(true);
}

async function restoreAll(): Promise<void> {
  if (!window.confirm(`恢复全部 ${trash.total} 笔账单？\n\n它们会回到账单列表并重新计入统计。`)) return;
  await trash.restoreAll();
  await balances.load(true);
}

async function purgeAll(): Promise<void> {
  if (
    !window.confirm(
      `清空回收站将永久删除 ${trash.total} 笔账单。\n\n此操作不可撤销，请确认。`,
    )
  ) {
    return;
  }
  await trash.purgeAll();
  await balances.load(true);
}
</script>

<template>
  <section class="head card">
    <div>
      <span class="label">回收站</span>
      <strong>{{ totalLabel }}</strong>
    </div>
    <p class="hint">
      这里的账单已从账本中移除，不计入预算与统计。可以随时恢复，或彻底删除。
    </p>
  </section>

  <p v-if="trash.loading && trash.isEmpty" class="muted">加载中…</p>

  <p v-else-if="trash.errorMessage !== null" class="error" role="alert">
    {{ trash.errorMessage }}
  </p>

  <template v-else-if="trash.isEmpty">
    <section class="empty card">
      <h2>回收站是空的</h2>
      <p class="hint">删除的账单会先到这里，之后可以恢复或彻底删除。</p>
      <button type="button" class="ghost" @click="router.push({ name: 'transactions' })">
        返回账单列表
      </button>
    </section>
  </template>

  <template v-else>
    <section class="bulk card">
      <button type="button" class="ghost" :disabled="trash.busy" @click="restoreAll">
        全部恢复
      </button>
      <button type="button" class="danger" :disabled="trash.busy" @click="purgeAll">
        清空回收站
      </button>
    </section>

    <ul class="rows">
      <li v-for="item in trash.items" :key="item.id">
        <div class="row">
          <span class="row-main">
            <span class="row-title">{{ rowTitle(item) }}</span>
            <span class="row-sub">{{ rowSubtitle(item) }}</span>
            <span class="row-sub deleted">{{ deletedLabel(item) }}</span>
          </span>
          <span
            class="row-amount"
            :class="{ negative: displayAmountCents(item) < 0, refund: item.isRefund }"
          >
            {{ formatYuan(displayAmountCents(item)) }}
          </span>
        </div>

        <div class="row-actions">
          <button
            type="button"
            class="ghost"
            :disabled="trash.busy"
            @click="restoreOne(item)"
          >
            恢复
          </button>
          <button
            type="button"
            class="danger"
            :disabled="trash.busy"
            @click="purgeOne(item)"
          >
            彻底删除
          </button>
        </div>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.card {
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
}

.head {
  display: grid;
  gap: 0.3rem;
}

h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.label {
  display: block;
  font-size: 0.78rem;
  color: var(--muted);
}

.head strong {
  font-size: 1.15rem;
}

.hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.bulk {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.55rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

/* The destructive action is named in words as well as coloured, so it is never
   distinguished by colour alone. */
.danger {
  color: var(--danger);
  background: none;
  border: 1px solid var(--danger);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}

.rows li {
  padding: 0.7rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.row-main {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.row-title {
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub {
  font-size: 0.72rem;
  color: var(--muted);
}

.row-amount {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--danger);
}

.refund {
  color: var(--ok);
}

.row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.empty {
  text-align: center;
}

.empty button {
  width: 100%;
  margin-top: 0.5rem;
}
</style>
