<script setup lang="ts">
/**
 * Create or edit one transfer.
 *
 * Two things this form does deliberately:
 *
 * 1. **The two account pickers exclude each other's selection.** The server rejects
 *    `from === to` with a 400, and that check stays the real gate — but offering the user a
 *    choice that cannot be saved and only telling them afterwards is a worse form. Removing the
 *    option is not a second validation, it is the same one expressed earlier.
 * 2. **The amount is neutral.** No income/expense colouring anywhere on this page, because a
 *    transfer is neither.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useMetaStore } from '../stores/meta.js';
import {
  formatYuan,
  fromDateInputValue,
  parseYuanToCents,
  toDateInputValue,
} from '../utils/money.js';

const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const balances = useBalanceStore();

const id = computed(() => {
  const raw = route.params['id'];
  return typeof raw === 'string' && raw !== '' ? raw : null;
});
const isEdit = computed(() => id.value !== null);

const amountText = ref('');
const fromAccountId = ref('');
const toAccountId = ref('');
const dateText = ref(toDateInputValue(Date.now()));
const note = ref('');

const loading = ref(true);
const saving = ref(false);
const errorMessage = ref<string | null>(null);

const amountCents = computed(() => parseYuanToCents(amountText.value));

/** The accounts the other picker may offer: everything except the one already chosen. */
const toOptions = computed(() =>
  meta.accounts.filter((account) => account.id !== fromAccountId.value),
);
const fromOptions = computed(() =>
  meta.accounts.filter((account) => account.id !== toAccountId.value),
);

/** The picked pair, named, for the confirmation line under the amount. */
const previewText = computed(() => {
  const cents = amountCents.value;
  if (cents === null) return '';
  const from = meta.accountName(fromAccountId.value);
  const to = meta.accountName(toAccountId.value);
  if (from === '' || to === '') return '';
  return `${formatYuan(cents)}：${from} → ${to}`;
});

onMounted(async () => {
  await Promise.all([meta.load(), balances.load()]);

  if (isEdit.value && id.value !== null) {
    try {
      const existing = await api.transfers.get(id.value);
      amountText.value = (existing.amountCents / 100).toFixed(2);
      fromAccountId.value = existing.fromAccountId;
      toAccountId.value = existing.toAccountId;
      dateText.value = toDateInputValue(existing.date);
      note.value = existing.note;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  } else {
    // Defaults: out of the same account a new bill would use, into the first other one.
    fromAccountId.value = meta.defaultAccountId() ?? '';
    toAccountId.value = meta.accounts.find((a) => a.id !== fromAccountId.value)?.id ?? '';
  }
  loading.value = false;
});

async function save(): Promise<void> {
  errorMessage.value = null;

  const cents = amountCents.value;
  if (cents === null) {
    errorMessage.value = '请输入大于 0 的金额。';
    return;
  }
  if (fromAccountId.value === '' || toAccountId.value === '') {
    errorMessage.value = '请选择转出和转入账户。';
    return;
  }
  if (fromAccountId.value === toAccountId.value) {
    errorMessage.value = '转出和转入不能是同一个账户。';
    return;
  }
  const date = fromDateInputValue(dateText.value);
  if (date === null) {
    errorMessage.value = '请选择有效日期。';
    return;
  }

  const payload = {
    fromAccountId: fromAccountId.value,
    toAccountId: toAccountId.value,
    amountCents: cents,
    date,
    note: note.value.trim(),
  };

  saving.value = true;
  try {
    if (isEdit.value && id.value !== null) {
      await api.transfers.update(id.value, payload);
    } else {
      await api.transfers.create(payload);
    }
    // Both balances moved, so the cached total on the home screen is stale.
    await balances.load(true);
    await router.push({ name: 'transfers' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <p v-if="loading" class="muted">加载中…</p>

  <form v-else class="form" @submit.prevent="save">
    <label class="field amount-field">
      <span>金额（元）</span>
      <input
        v-model="amountText"
        inputmode="decimal"
        placeholder="0.00"
        autocomplete="off"
        required
      />
      <small v-if="previewText !== ''">{{ previewText }}</small>
    </label>

    <label class="field">
      <span>从</span>
      <select v-model="fromAccountId" required>
        <option v-for="a in fromOptions" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </label>

    <label class="field">
      <span>到</span>
      <select v-model="toAccountId" required>
        <option v-for="a in toOptions" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </label>

    <label class="field">
      <span>日期</span>
      <input v-model="dateText" type="date" required />
    </label>

    <label class="field">
      <span>备注</span>
      <input v-model="note" type="text" placeholder="可选" maxlength="200" />
    </label>

    <p class="hint">
      转账只改变这两个账户的余额：转出账户减少、转入账户增加，总余额不变，也不算收入或支出。
    </p>

    <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>

    <div class="actions">
      <button type="submit" class="primary" :disabled="saving">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button type="button" class="ghost" :disabled="saving" @click="router.back()">取消</button>
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
}

/*
 * Neutral, like the list: the big number on this form is a movement, not a gain or a loss.
 * (`color: var(--fg)` rather than `var(--ok)` — see the component comment.)
 */
.amount-field > input {
  font-size: 1.3rem;
  font-variant-numeric: tabular-nums;
}

small {
  font-size: 0.75rem;
  color: var(--muted);
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted);
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
  font-size: 0.9rem;
  color: var(--danger);
}

.muted {
  color: var(--muted);
}
</style>
