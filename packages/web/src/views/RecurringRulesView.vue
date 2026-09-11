<script setup lang="ts">
/**
 * Recurring rules: what repeats, and whether it is still active.
 *
 * A rule on its own posts nothing. The screen therefore leads with the pending count
 * rather than the rule list: "you have 3 bills to confirm" is the thing that needs
 * attention, and the rules below it are the setup.
 *
 * `hasOlderDue` is surfaced explicitly. It means earlier due dates existed than one
 * generation run materialised, and hiding it would let the user believe nothing was
 * missed.
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { TYPE_EXPENSE } from '../api/client.js';
import type { RecurringRule } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { useRecurringStore } from '../stores/recurring.js';
import { formatYuan } from '../utils/money.js';

const recurring = useRecurringStore();
const meta = useMetaStore();
const router = useRouter();

const FREQUENCY_LABELS: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季度',
  yearly: '每年',
};

onMounted(async () => {
  await Promise.all([recurring.loadAll(), meta.load()]);
});

/** `"每月 15 日"` — the cadence plus the day the schedule is anchored to. */
function scheduleLabel(rule: RecurringRule): string {
  const anchor = new Date(rule.anchorDate);
  const base = FREQUENCY_LABELS[rule.frequency] ?? rule.frequency;
  if (rule.frequency === 'daily') return base;
  if (rule.frequency === 'weekly') return `${base}周${'日一二三四五六'[anchor.getDay()]}`;
  if (rule.frequency === 'yearly') {
    return `${base} ${anchor.getMonth() + 1} 月 ${anchor.getDate()} 日`;
  }
  return `${base} ${anchor.getDate()} 日`;
}

function nextDueLabel(rule: RecurringRule): string {
  const date = new Date(rule.nextDueDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The ledger's polarity: an expense reads as a negative amount. */
function displayAmount(rule: RecurringRule): string {
  const cents = rule.type === TYPE_EXPENSE ? -rule.amountCents : rule.amountCents;
  return formatYuan(cents);
}

const hasAnyRule = computed(() => recurring.rules.length > 0);

async function toggle(rule: RecurringRule): Promise<void> {
  await recurring.setRuleEnabled(rule.id, !rule.enabled);
}

async function remove(rule: RecurringRule): Promise<void> {
  if (!window.confirm(`删除规则「${rule.name}」？\n\n该规则不再产生待确认项，已产生的待确认项也会一并移除。`)) {
    return;
  }
  await recurring.deleteRule(rule.id);
}
</script>

<template>
  <section v-if="recurring.pendingCount > 0" class="alert-card" role="status">
    <div>
      <span class="label">待确认</span>
      <strong>{{ recurring.pendingCount }} 笔到期账单</strong>
    </div>
    <button type="button" @click="router.push({ name: 'recurring-pending' })">
      去确认
    </button>
  </section>

  <p v-if="recurring.loading && !hasAnyRule" class="muted">加载中…</p>

  <p v-else-if="recurring.errorMessage !== null" class="error" role="alert">
    {{ recurring.errorMessage }}
  </p>

  <template v-else>
    <section v-if="recurring.truncatedRules.length > 0" class="warn" role="alert">
      有 {{ recurring.truncatedRules.length }} 条规则的更早到期项未生成（每次最多生成最近 12 期）。
      如需补记，请直接录入账单。
    </section>

    <section v-if="!hasAnyRule" class="empty card">
      <h2>还没有周期账单</h2>
      <p class="hint">房租、水电、订阅这类固定支出，定义一次即可每月自动提醒确认。</p>
    </section>

    <ul v-else class="rows">
      <li v-for="rule in recurring.rules" :key="rule.id" :class="{ paused: !rule.enabled }">
        <div class="row">
          <span class="row-main">
            <span class="row-title">{{ rule.name }}</span>
            <span class="row-sub">
              {{ meta.categoryName(rule.categoryId) }} · {{ scheduleLabel(rule) }}
            </span>
            <span class="row-sub">
              {{ rule.enabled ? `下次 ${nextDueLabel(rule)}` : '已暂停' }}
            </span>
          </span>
          <span class="row-amount" :class="{ negative: rule.type === 0 }">
            {{ displayAmount(rule) }}
          </span>
        </div>

        <div class="row-actions">
          <button type="button" class="ghost" :disabled="recurring.busy" @click="toggle(rule)">
            {{ rule.enabled ? '暂停' : '启用' }}
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="recurring.busy"
            @click="router.push({ name: 'recurring-rule-edit', params: { id: rule.id } })"
          >
            编辑
          </button>
          <button type="button" class="danger" :disabled="recurring.busy" @click="remove(rule)">
            删除
          </button>
        </div>
      </li>
    </ul>

    <button type="button" class="primary" @click="router.push({ name: 'recurring-rule-new' })">
      新建周期账单
    </button>
  </template>
</template>

<style scoped>
.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
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

.hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.alert-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-left-width: 4px;
  border-radius: 0.7rem;
}

.alert-card strong {
  font-size: 1.05rem;
}

.alert-card button {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.warn {
  padding: 0.6rem 0.85rem;
  margin-bottom: 1rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 0.6rem;
}

.rows {
  list-style: none;
  margin: 0 0 1rem;
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

.rows li.paused {
  opacity: 0.7;
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
  grid-template-columns: repeat(3, 1fr);
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

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.danger {
  color: var(--danger);
  background: none;
  border: 1px solid var(--danger);
}

.primary {
  width: 100%;
  color: #fff;
  background: var(--accent);
  border: 0;
}

.empty {
  text-align: center;
}
</style>
