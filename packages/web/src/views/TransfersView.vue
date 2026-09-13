<script setup lang="ts">
/**
 * Transfers: money moved between the user's own accounts.
 *
 * A transfer is neither income nor expense, and this page says so in the most direct way it
 * can: the amount is rendered in the **neutral** foreground colour, never in `--ok` or
 * `--danger`. Green would read as "money came in" and red as "money went out", and both are
 * wrong — the same total is still there, just in a different pocket.
 *
 * The row's direction is carried by the arrow and by which account is named first, not by
 * colour, so the meaning survives a monochrome screen and a colour-blind reader.
 */
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useBalanceStore } from '../stores/balances.js';
import { useMetaStore } from '../stores/meta.js';
import { useTransfersStore } from '../stores/transfers.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const transfers = useTransfersStore();
const balances = useBalanceStore();
const meta = useMetaStore();
const route = useRoute();
const router = useRouter();

/** When narrowed to one account, its name — otherwise `null`. */
const accountFilterName = computed(() => {
  const id = transfers.accountFilter;
  return id === undefined ? null : meta.accountName(id);
});

onMounted(async () => {
  // A drill-down arrives as `?accountId=…`; seed the filter before the first load so the list
  // never paints unfiltered and then jumps.
  const requested = route.query.accountId;
  transfers.setAccountFilter(
    typeof requested === 'string' && requested !== '' ? requested : undefined,
  );
  await Promise.all([meta.load(), balances.load(), transfers.load()]);
});

function clearFilter(): void {
  transfers.setAccountFilter(undefined);
  void transfers.load();
}

function edit(id: string): void {
  void router.push({ name: 'transfer-edit', params: { id } });
}

async function remove(id: string, amountCents: number): Promise<void> {
  if (!window.confirm(`删除这笔 ${formatYuan(amountCents)} 的转账？两个账户的余额会还原。`)) {
    return;
  }
  const ok = await transfers.remove(id);
  // Deleting a transfer puts the money back where it came from, so the cached balances are
  // stale the moment it succeeds.
  if (ok) await balances.load(true);
}
</script>

<template>
  <p v-if="accountFilterName !== null" class="account-note">
    <span>正在按「{{ accountFilterName }}」筛选</span>
    <button type="button" class="link" @click="clearFilter">清除筛选</button>
  </p>

  <p v-if="transfers.loading && transfers.items.length === 0" class="muted">加载中…</p>

  <p v-else-if="transfers.errorMessage !== null" class="error" role="alert">
    {{ transfers.errorMessage }}
  </p>

  <p v-else-if="transfers.items.length === 0" class="empty hint">
    还没有转账记录。转账是把钱从一个账户挪到另一个账户，不算收入也不算支出。
  </p>

  <ul v-else class="rows">
    <li v-for="item in transfers.items" :key="item.id">
      <div class="row-main">
        <span class="route">
          {{ meta.accountName(item.fromAccountId) }}
          <span class="arrow" aria-hidden="true">→</span>
          {{ meta.accountName(item.toAccountId) }}
        </span>
        <span class="sub">
          {{ formatDayLabel(item.date) }}<template v-if="item.note"> · {{ item.note }}</template>
        </span>
      </div>
      <span class="amount">{{ formatYuan(item.amountCents) }}</span>
      <span class="row-actions">
        <button
          type="button"
          :disabled="transfers.loading"
          :aria-label="`编辑 ${formatDayLabel(item.date)} 的转账`"
          @click="edit(item.id)"
        >
          编辑
        </button>
        <button
          type="button"
          class="danger"
          :disabled="transfers.loading"
          :aria-label="`删除 ${formatDayLabel(item.date)} 的转账`"
          @click="remove(item.id, item.amountCents)"
        >
          删除
        </button>
      </span>
    </li>
  </ul>

  <p class="hint note">
    转账只改变两个账户的余额：转出减少、转入增加，总余额不变。它<strong>不算收入也不算支出</strong>，
    不进账单列表，也不影响预算与统计。
  </p>

  <div class="actions">
    <button type="button" class="primary" @click="router.push({ name: 'transfer-new' })">
      记一笔转账
    </button>
    <button type="button" class="ghost" @click="router.back()">返回</button>
  </div>
</template>

<style scoped>
.account-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.78rem;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.link {
  /* 44px minimum touch target. */
  min-width: 44px;
  min-height: 44px;
  padding: 0 0.5rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

.rows {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.rows li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.row-main {
  display: grid;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
}

.route {
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrow {
  color: var(--muted);
  padding: 0 0.15rem;
}

.sub {
  font-size: 0.72rem;
  color: var(--muted);
}

/*
 * Neutral on purpose. A transfer is not income and not an expense, so neither `--ok` nor
 * `--danger` may appear here — see the component comment.
 */
.amount {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}

.row-actions {
  display: flex;
  gap: 0.25rem;
  flex: 0 0 auto;
}

.row-actions button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 0.4rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  cursor: pointer;
}

.row-actions .danger {
  color: var(--danger);
}

.row-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.note {
  margin-bottom: 1rem;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions button {
  min-height: 48px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.6rem;
  cursor: pointer;
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

.hint {
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted);
}

.empty {
  padding: 2rem 1rem;
  text-align: center;
}

.muted {
  color: var(--muted);
}

.error {
  color: var(--danger);
}
</style>
