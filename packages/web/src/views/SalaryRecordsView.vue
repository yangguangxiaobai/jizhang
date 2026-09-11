<script setup lang="ts">
/**
 * Salary records: what each pay cheque was allocated to, and the ability to delete
 * one (which removes its budget cycle from the overview).
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import type { SalaryDetail } from '../api/client.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const budget = useBudgetStore();
const meta = useMetaStore();
const router = useRouter();

const expanded = ref<Record<string, SalaryDetail>>({});
const busyId = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([budget.loadSalaries(), meta.load()]);
});

async function toggle(id: string): Promise<void> {
  if (expanded.value[id] !== undefined) {
    const next = { ...expanded.value };
    delete next[id];
    expanded.value = next;
    return;
  }

  busyId.value = id;
  try {
    const detail = await api.salaries.get(id);
    expanded.value = { ...expanded.value, [id]: detail };
  } finally {
    busyId.value = null;
  }
}

async function remove(id: string, amountCents: number): Promise<void> {
  if (!window.confirm(`删除这笔 ${formatYuan(amountCents)} 的工资记录？该周期的预算分配会一并移除。`)) {
    return;
  }
  busyId.value = id;
  try {
    await budget.deleteSalary(id);
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <p v-if="budget.salaries.length === 0" class="empty">
    还没有工资记录。记一次工资就会开始一个预算周期。
  </p>

  <ul v-else class="records">
    <li v-for="record in budget.salaries" :key="record.id">
      <div class="head">
        <button type="button" class="toggle" @click="toggle(record.id)">
          <span class="date">{{ formatDayLabel(record.date) }}</span>
          <span class="amount">{{ formatYuan(record.amountCents) }}</span>
          <span class="chevron" aria-hidden="true">
            {{ expanded[record.id] !== undefined ? '▾' : '▸' }}
          </span>
        </button>

        <button
          type="button"
          class="delete"
          :disabled="busyId === record.id"
          :aria-label="`删除 ${formatDayLabel(record.date)} 的工资记录`"
          @click="remove(record.id, record.amountCents)"
        >
          ✕
        </button>
      </div>

      <p v-if="record.note" class="note">{{ record.note }}</p>

      <p v-if="busyId === record.id && expanded[record.id] === undefined" class="muted">
        加载中…
      </p>

      <dl v-if="expanded[record.id]" class="allocations">
        <div
          v-for="item in expanded[record.id]?.allocations ?? []"
          :key="item.categoryId"
        >
          <dt>{{ meta.categoryName(item.categoryId) }}</dt>
          <dd>{{ formatYuan(item.amountCents) }}</dd>
        </div>
      </dl>
    </li>
  </ul>

  <div class="actions">
    <button type="button" @click="router.push({ name: 'salary-new' })">记工资</button>
    <button type="button" class="ghost" @click="router.push({ name: 'budget' })">
      返回预算
    </button>
  </div>
</template>

<style scoped>
.records {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}

.records li {
  padding: 0.35rem 0.75rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.head {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
}

.toggle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 44px;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.date {
  font-size: 0.9rem;
  color: var(--muted);
}

.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.chevron {
  color: var(--muted);
}

.delete {
  width: 44px;
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  cursor: pointer;
}

.delete:hover {
  color: var(--danger);
}

.note {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.allocations {
  margin: 0.35rem 0 0;
  padding-top: 0.4rem;
  border-top: 1px dashed var(--border);
}

.allocations div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}

.allocations dt {
  color: var(--muted);
}

.allocations dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}

.muted {
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
