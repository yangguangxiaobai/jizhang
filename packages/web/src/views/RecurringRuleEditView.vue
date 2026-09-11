<script setup lang="ts">
/**
 * Create or edit one recurring rule.
 *
 * One component for both, because the fields are identical and a separate "new" form
 * would be a second place for the frequency list and the validation copy to drift.
 *
 * The anchor date doubles as the first due date. That is worth saying in the UI: a user
 * who wants "rent on the 1st" needs to understand that entering the 1st is what sets the
 * schedule, not a separate concept they have to learn.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { TYPE_EXPENSE, TYPE_INCOME } from '../api/client.js';
import type { RecurringFrequency } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { useRecurringStore } from '../stores/recurring.js';
import { formatCents, fromDateInputValue, parseYuanToCents, toDateInputValue } from '../utils/money.js';

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季度' },
  { value: 'yearly', label: '每年' },
];

const route = useRoute();
const router = useRouter();
const recurring = useRecurringStore();
const meta = useMetaStore();

const ruleId = computed(() => {
  const id = route.params['id'];
  return typeof id === 'string' && id !== '' ? id : null;
});
const isEditing = computed(() => ruleId.value !== null);

const name = ref('');
const type = ref<number>(TYPE_EXPENSE);
const amountText = ref('');
const categoryId = ref('');
const accountId = ref('');
const frequency = ref<RecurringFrequency>('monthly');
const anchorText = ref(toDateInputValue(Date.now()));
const enabled = ref(true);
const saving = ref(false);

const amountCents = computed(() => parseYuanToCents(amountText.value));
const categories = computed(() =>
  type.value === TYPE_INCOME ? meta.incomeCategories : meta.expenseCategories,
);

onMounted(async () => {
  await Promise.all([meta.load(), recurring.loadRules()]);

  accountId.value = meta.defaultAccountId() ?? '';

  if (ruleId.value !== null) {
    const rule = recurring.rules.find((candidate) => candidate.id === ruleId.value);
    if (rule !== undefined) {
      name.value = rule.name;
      type.value = rule.type;
      amountText.value = formatCents(rule.amountCents);
      categoryId.value = rule.categoryId;
      accountId.value = rule.accountId;
      frequency.value = rule.frequency;
      anchorText.value = toDateInputValue(rule.anchorDate);
      enabled.value = rule.enabled;
      return;
    }
  }

  categoryId.value = meta.firstCategoryId(type.value) ?? '';
});

/** Keeps the category valid when the user flips between expense and income. */
function onTypeChange(): void {
  if (!categories.value.some((category) => category.id === categoryId.value)) {
    categoryId.value = meta.firstCategoryId(type.value) ?? '';
  }
}

const canSave = computed(
  () =>
    name.value.trim() !== '' &&
    amountCents.value !== null &&
    categoryId.value !== '' &&
    accountId.value !== '' &&
    fromDateInputValue(anchorText.value) !== null,
);

async function save(): Promise<void> {
  const cents = amountCents.value;
  const anchorDate = fromDateInputValue(anchorText.value);
  if (cents === null || anchorDate === null || saving.value) return;

  saving.value = true;
  try {
    const input = {
      name: name.value.trim(),
      type: type.value,
      amountCents: cents,
      categoryId: categoryId.value,
      accountId: accountId.value,
      frequency: frequency.value,
      anchorDate,
      enabled: enabled.value,
    };

    const ok =
      ruleId.value === null
        ? await recurring.createRule(input)
        : await recurring.updateRule(ruleId.value, input);

    if (ok) await router.push({ name: 'recurring-rules' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field">
      <span>名称</span>
      <input v-model="name" type="text" maxlength="60" placeholder="例如：房租" required />
    </label>

    <fieldset class="field">
      <legend>类型</legend>
      <div class="segmented">
        <button
          type="button"
          :class="{ active: type === TYPE_EXPENSE }"
          :aria-pressed="type === TYPE_EXPENSE"
          @click="
            type = TYPE_EXPENSE;
            onTypeChange();
          "
        >
          支出
        </button>
        <button
          type="button"
          :class="{ active: type === TYPE_INCOME }"
          :aria-pressed="type === TYPE_INCOME"
          @click="
            type = TYPE_INCOME;
            onTypeChange();
          "
        >
          收入
        </button>
      </div>
    </fieldset>

    <label class="field">
      <span>金额（元）</span>
      <input
        v-model="amountText"
        type="text"
        inputmode="decimal"
        placeholder="0.00"
        autocomplete="off"
        required
      />
      <small v-if="amountCents !== null">将保存为 {{ amountCents }} 分</small>
    </label>

    <label class="field">
      <span>分类</span>
      <select v-model="categoryId" required>
        <option v-for="category in categories" :key="category.id" :value="category.id">
          {{ category.name }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>账户</span>
      <select v-model="accountId" required>
        <option v-for="account in meta.accounts" :key="account.id" :value="account.id">
          {{ account.name }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>重复频率</span>
      <select v-model="frequency">
        <option v-for="option in FREQUENCIES" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>起始日期</span>
      <input v-model="anchorText" type="date" required />
      <small>首次到期日也是这一天，之后的日期按频率从这里推算。</small>
    </label>

    <label class="row-toggle">
      <input v-model="enabled" type="checkbox" />
      <span>启用（暂停后不再生成待确认项）</span>
    </label>

    <p v-if="recurring.errorMessage !== null" class="error" role="alert">
      {{ recurring.errorMessage }}
    </p>

    <div class="actions">
      <button type="submit" :disabled="!canSave || saving">
        {{ isEditing ? '保存修改' : '创建' }}
      </button>
      <button type="button" class="ghost" @click="router.push({ name: 'recurring-rules' })">
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
  margin: 0;
  padding: 0;
  border: 0;
}

.field > span,
legend {
  font-size: 0.85rem;
  color: var(--muted);
}

/* 16px minimum: below it, iOS Safari zooms the page on focus. */
input[type='text'],
input[type='date'],
select {
  width: 100%;
  min-height: 44px;
  padding: 0 0.6rem;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

small {
  font-size: 0.72rem;
  color: var(--muted);
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.segmented button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  cursor: pointer;
}

.segmented button.active {
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

/*
 * The label is the row, and the box is redrawn at the full 44px target: a native
 * checkbox is 13–22px, which is below the touch minimum. Same approach as the refund
 * toggle in `TransactionEditView`, so the two checkboxes in the app behave alike.
 */
.row-toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
  font-size: 0.9rem;
}

.row-toggle input {
  appearance: none;
  -webkit-appearance: none;
  width: 44px;
  height: 44px;
  min-height: 44px;
  margin: 0;
  flex: 0 0 auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.row-toggle input:checked {
  background-color: var(--accent);
  border-color: var(--accent);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='5 13 10 18 19 7'/></svg>");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 22px 22px;
}

.row-toggle input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
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
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.55;
  cursor: default;
}

.actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}
</style>
