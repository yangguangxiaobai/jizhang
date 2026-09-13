<script setup lang="ts">
/**
 * Record a salary — the action that starts a budget cycle.
 *
 * The preview uses the SAME `allocateSalaryCents` function the server uses, so what
 * the user sees before saving is exactly what gets stored. The rule is: every module
 * but the last is `round(total × ratio)`, and the **last module absorbs the rounding
 * remainder**, which is why the parts always add up to the salary.
 */
import { allocateSalaryCents } from '@jizhang/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import type { AllocationItem } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';
import {
  formatCents,
  formatYuan,
  fromDateInputValue,
  parseYuanToCents,
  toDateInputValue,
} from '../utils/money.js';

const budget = useBudgetStore();
const balances = useBalanceStore();
const meta = useMetaStore();
const router = useRouter();

const amountText = ref('');
const dateText = ref(toDateInputValue(Date.now()));
const note = ref('');
const templateId = ref('');
/** Which account receives the money. Required by the server; preselected like a new bill. */
const accountId = ref('');
/** Per-category overrides, keyed by categoryId, as yuan strings. */
const overrides = ref<Record<string, string>>({});
const saving = ref(false);
const errorMessage = ref<string | null>(null);

const salaryCents = computed(() => parseYuanToCents(amountText.value));

const template = computed(
  () => budget.templates.find((t) => t.id === templateId.value) ?? budget.defaultTemplate,
);

/** Template amounts, before any manual override. */
const previewAmounts = computed<AllocationItem[]>(() => {
  const total = salaryCents.value;
  const modules = template.value?.modules ?? [];
  if (total === null || modules.length === 0) return [];
  return allocateSalaryCents(total, modules).map((item) => ({
    categoryId: item.categoryId,
    amountCents: item.amountCents,
  }));
});

/** Effective amount per category: the override when present, else the preview. */
const effectiveAmounts = computed<AllocationItem[]>(() =>
  previewAmounts.value.map((item) => {
    const raw = overrides.value[item.categoryId];
    if (raw === undefined || raw.trim() === '') return item;
    const cents = parseYuanToCents(raw);
    return { categoryId: item.categoryId, amountCents: cents ?? 0 };
  }),
);

const assignedCents = computed(() =>
  effectiveAmounts.value.reduce((total, item) => total + item.amountCents, 0),
);

/** Difference between what is allocated and the salary; must be 0 to save. */
const differenceCents = computed(() =>
  salaryCents.value === null ? 0 : salaryCents.value - assignedCents.value,
);

const isBalanced = computed(() => differenceCents.value === 0);

const hasOverride = computed(() =>
  Object.values(overrides.value).some((value) => value.trim() !== ''),
);

onMounted(async () => {
  await Promise.all([budget.loadAll(), meta.load()]);
  templateId.value = budget.defaultTemplate?.id ?? '';
  // The same helper the bill editor uses, so "which account is preselected" cannot give two
  // different answers on two screens.
  accountId.value = meta.defaultAccountId() ?? '';
});

// A changed template or amount invalidates manual edits, which would otherwise
// silently disagree with the new preview.
watch([templateId, amountText], () => {
  overrides.value = {};
});

function categoryName(categoryId: string): string {
  return meta.categoryName(categoryId);
}

function resetOverrides(): void {
  overrides.value = {};
}

async function save(): Promise<void> {
  errorMessage.value = null;

  const total = salaryCents.value;
  if (total === null) {
    errorMessage.value = '请输入大于 0 的工资额。';
    return;
  }
  const date = fromDateInputValue(dateText.value);
  if (date === null) {
    errorMessage.value = '请选择有效日期。';
    return;
  }
  if (accountId.value === '') {
    errorMessage.value = '请选择收款账户。';
    return;
  }
  if (!isBalanced.value) {
    errorMessage.value =
      differenceCents.value > 0
        ? `还有 ${formatCents(differenceCents.value)} 元未分配。`
        : `已超出工资额 ${formatCents(-differenceCents.value)} 元。`;
    return;
  }

  saving.value = true;
  try {
    await api.salaries.create({
      amountCents: total,
      date,
      note: note.value.trim(),
      accountId: accountId.value,
      templateId: template.value?.id,
      // Always send the effective amounts: the preview is the contract, and the
      // server re-checks that they add up.
      allocations: effectiveAmounts.value,
    });
    // The account's balance just changed, so the cached one on the home screen is stale.
    await Promise.all([budget.loadOverview(), budget.loadSalaries(), balances.load(true)]);
    await router.push({ name: 'budget' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <p v-if="budget.loading && budget.templates.length === 0" class="muted">加载中…</p>

  <form v-else class="form" @submit.prevent="save">
    <label class="field">
      <span>工资金额（元）</span>
      <input
        v-model="amountText"
        inputmode="decimal"
        placeholder="0.00"
        autocomplete="off"
        required
      />
      <small v-if="salaryCents !== null">将保存为 {{ salaryCents }} 分</small>
    </label>

    <label class="field">
      <span>发薪日</span>
      <input v-model="dateText" type="date" required />
    </label>

    <!-- Asked before "how is it split": where the money landed is the plainer question. -->
    <label class="field">
      <span>收款账户</span>
      <select v-model="accountId" required>
        <option v-for="a in meta.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </label>

    <label class="field">
      <span>分配模板</span>
      <select v-model="templateId">
        <option v-for="t in budget.templates" :key="t.id" :value="t.id">
          {{ t.name }}{{ t.isDefault ? '（默认）' : '' }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>备注</span>
      <input v-model="note" type="text" placeholder="可选" maxlength="200" />
    </label>

    <section v-if="previewAmounts.length > 0" class="allocations">
      <header class="alloc-head">
        <h2>各模块预算</h2>
        <button
          v-if="hasOverride"
          type="button"
          class="link"
          @click="resetOverrides"
        >
          重置微调
        </button>
      </header>

      <ul>
        <li v-for="item in effectiveAmounts" :key="item.categoryId">
          <span class="cat">{{ categoryName(item.categoryId) }}</span>
          <input
            v-model="overrides[item.categoryId]"
            inputmode="decimal"
            :placeholder="formatCents(item.amountCents)"
            :aria-label="`${categoryName(item.categoryId)} 金额`"
          />
          <span class="auto">{{ formatYuan(item.amountCents) }}</span>
        </li>
      </ul>

      <p class="balance" :class="{ ok: isBalanced, bad: !isBalanced }">
        <template v-if="isBalanced">
          已分配 {{ formatYuan(assignedCents) }} · 与工资一致 ✓
        </template>
        <template v-else-if="differenceCents > 0">
          已分配 {{ formatYuan(assignedCents) }} · 还有
          {{ formatYuan(differenceCents) }} 未分配
        </template>
        <template v-else>
          已分配 {{ formatYuan(assignedCents) }} · 超出
          {{ formatYuan(-differenceCents) }}
        </template>
      </p>

      <p class="hint">
        留空表示使用模板比例算出的金额；直接输入可微调，但各模块之和必须等于工资额。
      </p>
    </section>

    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

    <div class="actions">
      <button type="submit" class="primary" :disabled="saving || !isBalanced">
        {{ saving ? '保存中…' : '保存并开始新周期' }}
      </button>
      <button type="button" class="ghost" :disabled="saving" @click="router.back()">
        取消
      </button>
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.field input,
.field select {
  font-size: 16px;
  min-height: 44px;
  padding: 0.5rem 0.65rem;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.field > input:first-of-type {
  font-size: 1.3rem;
  font-variant-numeric: tabular-nums;
}

small {
  font-size: 0.75rem;
}

.allocations {
  padding: 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
}

.alloc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}

h2 {
  margin: 0;
  font-size: 0.95rem;
}

.link {
  /* 44px minimum touch target. */
  min-height: 44px;
  padding: 0 0.4rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

.allocations ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.allocations li {
  display: grid;
  grid-template-columns: 1fr 6.5rem 5.5rem;
  align-items: center;
  gap: 0.5rem;
}

.cat {
  font-size: 0.88rem;
}

.allocations input {
  font-size: 16px;
  min-height: 44px;
  padding: 0.4rem 0.5rem;
  text-align: right;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  font-variant-numeric: tabular-nums;
}

.auto {
  font-size: 0.78rem;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.balance {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.balance.ok {
  color: var(--ok);
}

.balance.bad {
  color: var(--danger);
}

.hint {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted);
}

.actions {
  display: grid;
  grid-template-columns: 1fr;
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

.actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
}

.muted {
  color: var(--muted);
}
</style>
