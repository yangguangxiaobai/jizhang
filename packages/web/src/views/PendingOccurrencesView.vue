<script setup lang="ts">
/**
 * The pending queue: due dates waiting for a decision.
 *
 * This is where the feature's core promise is kept — nothing reaches the ledger until a
 * person says so. Each row therefore offers exactly two honest choices: confirm it into a
 * bill, or dismiss it. There is deliberately no "confirm all": a bulk confirm would let
 * one tap post a dozen bills the user never read, which is the failure mode the whole
 * design exists to avoid.
 *
 * Confirmation is idempotent on the server, so a double tap cannot double-count; the
 * button is still disabled while the request is in flight, because a second request that
 * returns `created: false` would be confusing to see acknowledged twice.
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { TYPE_EXPENSE } from '../api/client.js';
import type { RecurringOccurrence } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { useRecurringStore } from '../stores/recurring.js';
import { formatYuan } from '../utils/money.js';

const recurring = useRecurringStore();
const meta = useMetaStore();
const router = useRouter();

onMounted(async () => {
  // Generate first, then read: reading first would show a stale (possibly empty) queue
  // on the app's first open of the day.
  await recurring.generateAndReload();
  await meta.load();
});

const isEmpty = computed(() => recurring.pending.length === 0);

function plannedLabel(item: RecurringOccurrence): string {
  const date = new Date(item.plannedDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The ledger's polarity: an expense reads as a negative amount. */
function displayAmount(item: RecurringOccurrence): number {
  return item.type === TYPE_EXPENSE ? -item.amountCents : item.amountCents;
}

async function confirm(item: RecurringOccurrence): Promise<void> {
  await recurring.confirmOne(item.id);
}

async function ignore(item: RecurringOccurrence): Promise<void> {
  if (!window.confirm(`忽略「${item.note}」这一期？\n\n不会记账，该期也不会再出现在这里。`)) {
    return;
  }
  await recurring.ignoreOne(item.id);
}
</script>

<template>
  <section class="head card">
    <div>
      <span class="label">待确认</span>
      <strong>{{ recurring.pendingCount }} 笔到期账单</strong>
    </div>
    <p class="hint">
      这些是按周期规则到期生成的。确认后才会计入账本与预算。
    </p>
  </section>

  <p v-if="recurring.loading && isEmpty" class="muted">加载中…</p>

  <p v-else-if="recurring.errorMessage !== null" class="error" role="alert">
    {{ recurring.errorMessage }}
  </p>

  <template v-else-if="isEmpty">
    <section class="empty card">
      <h2>没有待确认的账单</h2>
      <p class="hint">周期账单到期后会出现在这里，由你决定是否记账。</p>
      <button type="button" class="ghost" @click="router.push({ name: 'recurring-rules' })">
        管理周期账单
      </button>
    </section>
  </template>

  <ul v-else class="rows">
    <li v-for="item in recurring.pending" :key="item.id">
      <div class="row">
        <span class="row-main">
          <span class="row-title">{{ item.note }}</span>
          <span class="row-sub">
            {{ meta.categoryName(item.categoryId) }} · 到期 {{ plannedLabel(item) }}
          </span>
        </span>
        <span class="row-amount" :class="{ negative: item.type === TYPE_EXPENSE }">
          {{ formatYuan(displayAmount(item)) }}
        </span>
      </div>

      <div class="row-actions">
        <button type="button" class="primary" :disabled="recurring.busy" @click="confirm(item)">
          确认记账
        </button>
        <button type="button" class="ghost" :disabled="recurring.busy" @click="ignore(item)">
          忽略这期
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
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
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
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
  font-size: 0.95rem;
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

.row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.6rem;
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

.primary {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.empty {
  text-align: center;
}

.empty button {
  width: 100%;
  margin-top: 0.5rem;
}
</style>
