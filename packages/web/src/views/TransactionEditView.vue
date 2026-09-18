<script setup lang="ts">
/**
 * Create or edit one transaction.
 *
 * Money enters as yuan and is converted to integer cents with `Math.round` at the
 * boundary — the single place a float could sneak into the database (parent AC6).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { TYPE_EXPENSE, TYPE_INCOME, api } from '../api/client.js';
import type { Transaction } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useMetaStore } from '../stores/meta.js';
import { useTransactionsStore } from '../stores/transactions.js';
import {
  formatCents,
  formatDayLabel,
  formatYuan,
  fromDateInputValue,
  parseYuanToCents,
  toDateInputValue,
} from '../utils/money.js';
import TransactionDetailModal from '../components/TransactionDetailModal.vue';

const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const balances = useBalanceStore();
const list = useTransactionsStore();

const id = computed(() => {
  const raw = route.params['id'];
  return typeof raw === 'string' && raw !== '' ? raw : null;
});
const isEdit = computed(() => id.value !== null);

const type = ref<number>(TYPE_EXPENSE);
const amountText = ref('');
const categoryId = ref('');
const accountId = ref('');
const dateText = ref(toDateInputValue(Date.now()));
const note = ref('');
const tags = ref<string[]>([]);
const tagDraft = ref('');
const isRefund = ref(false);
const refundLinkedTxIds = ref<string[]>([]);
const candidateExpenses = ref<Transaction[]>([]);
const candidatesLoaded = ref(false);
const candidateQuery = ref('');
const detailModalTxId = ref<string | null>(null);

/** Loads candidate expenses the first time the refund checkbox is turned on. */
watch(isRefund, (val) => {
  if (val) void loadCandidates();
});

const loading = ref(false);
const saving = ref(false);
const errorMessage = ref<string | null>(null);

const availableCategories = computed(() =>
  type.value === TYPE_INCOME ? meta.incomeCategories : meta.expenseCategories,
);

/** Live preview of the parsed amount, so a typo is visible before saving. */
const parsedCents = computed(() => parseYuanToCents(amountText.value));

onMounted(async () => {
  await meta.load();

  if (isEdit.value && id.value !== null) {
    loading.value = true;
    try {
      const item: Transaction = await api.transactions.get(id.value);
      type.value = item.type;
      amountText.value = formatCents(item.amountCents);
      categoryId.value = item.categoryId;
      accountId.value = item.accountId;
      dateText.value = toDateInputValue(item.date);
      note.value = item.note;
      tags.value = [...item.tags];
      isRefund.value = item.isRefund;
      refundLinkedTxIds.value = item.refundLinkedTxIds ?? [];
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  } else {
    categoryId.value = meta.firstCategoryId(TYPE_EXPENSE) ?? '';
    accountId.value = meta.defaultAccountId() ?? '';
  }
});

/** Keeps the category valid when switching between expense and income. */
function onTypeChange(): void {
  const stillValid = availableCategories.value.some((c) => c.id === categoryId.value);
  if (!stillValid) {
    categoryId.value = meta.firstCategoryId(type.value) ?? '';
  }
  if (type.value === TYPE_EXPENSE) {
    // Refunds only exist on incomes; a switch must not leave a stale flag behind.
    isRefund.value = false;
    refundLinkedTxIds.value = [];
  }
}

/**
 * When the refund box is turned on, defaults the category to 退款.
 *
 * Deliberately an `@change` handler, not a `watch(isRefund)`: the watch would also
 * fire during the edit-load path and override the category a saved refund already has.
 */
function onRefundChange(): void {
  if (!isRefund.value || isEdit.value) return;
  const refundCategory =
    meta.incomeCategories.find((c) => c.id === 'builtin-income-refund') ??
    meta.incomeCategories.find((c) => c.name === '退款');
  if (refundCategory) categoryId.value = refundCategory.id;
}

function addTag(): void {
  const name = tagDraft.value.trim();
  if (name === '' || tags.value.includes(name)) {
    tagDraft.value = '';
    return;
  }
  tags.value = [...tags.value, name];
  tagDraft.value = '';
}

function removeTag(name: string): void {
  tags.value = tags.value.filter((tag) => tag !== name);
}

/** Loads recent non-refund expenses as refund candidates. Runs once when the refund checkbox is first checked. */
async function loadCandidates(): Promise<void> {
  if (candidatesLoaded.value) return;
  candidatesLoaded.value = true;
  try {
    const result = await api.transactions.list({ type: TYPE_EXPENSE, limit: 100 });
    candidateExpenses.value = result.items.filter((t) => !t.isRefund && t.id !== id.value);
  } catch {
    candidateExpenses.value = [];
  }
}

/** A candidate is already selected when its id is in the linked list. */
function isSelected(candidateId: string): boolean {
  return refundLinkedTxIds.value.includes(candidateId);
}

/** Toggles a candidate expense in/out of the linked list. */
function toggleOriginal(candidateId: string): void {
  if (isSelected(candidateId)) {
    refundLinkedTxIds.value = refundLinkedTxIds.value.filter((id2) => id2 !== candidateId);
  } else {
    refundLinkedTxIds.value = [...refundLinkedTxIds.value, candidateId];
  }
}

/** Opens the read-only detail modal for a candidate expense. */
function showCandidateDetail(candidateId: string): void {
  detailModalTxId.value = candidateId;
}

/** Candidates after the free-text filter (note / category / amount / date). */
const filteredCandidates = computed(() => {
  const q = candidateQuery.value.trim().toLowerCase();
  if (q === '') return candidateExpenses.value;
  return candidateExpenses.value.filter((item) => {
    const hay = [
      item.note,
      meta.categoryName(item.categoryId),
      formatYuan(item.amountCents),
      formatDayLabel(item.date),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
});

async function save(): Promise<void> {
  errorMessage.value = null;

  const amountCents = parsedCents.value;
  if (amountCents === null) {
    errorMessage.value = '请输入大于 0 的金额。';
    return;
  }
  if (categoryId.value === '') {
    errorMessage.value = '请选择分类。';
    return;
  }
  if (isRefund.value && type.value === TYPE_INCOME && refundLinkedTxIds.value.length === 0) {
    errorMessage.value = '退款需要关联至少一笔原始支出。';
    return;
  }
  if (accountId.value === '') {
    errorMessage.value = '请选择账户。';
    return;
  }

  const date = fromDateInputValue(dateText.value);
  if (date === null) {
    errorMessage.value = '请选择有效日期。';
    return;
  }

  const payload = {
    type: type.value,
    amountCents,
    categoryId: categoryId.value,
    accountId: accountId.value,
    date,
    note: note.value.trim(),
    tags: tags.value,
    isRefund: type.value === TYPE_INCOME ? isRefund.value : false,
    refundLinkedTxIds: type.value === TYPE_INCOME && isRefund.value ? refundLinkedTxIds.value : [],
  };

  saving.value = true;
  try {
    if (isEdit.value && id.value !== null) {
      await api.transactions.update(id.value, payload);
    } else {
      await api.transactions.create(payload);
    }
    await Promise.all([list.load(), meta.refreshTags(), balances.load(true)]);
    await router.push({ name: 'transactions' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  if (id.value === null) return;
  if (!window.confirm('删除这笔账单？')) return;
  saving.value = true;
  try {
    await list.remove(id.value);
    await router.push({ name: 'transactions' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <p v-if="loading" class="muted">加载中…</p>

  <form v-else class="form" @submit.prevent="save">
    <div class="type-switch" role="radiogroup" aria-label="类型">
      <button
        type="button"
        role="radio"
        :aria-checked="type === TYPE_EXPENSE"
        :class="{ active: type === TYPE_EXPENSE }"
        @click="
          type = TYPE_EXPENSE;
          onTypeChange();
        "
      >
        支出
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="type === TYPE_INCOME"
        :class="{ active: type === TYPE_INCOME }"
        @click="
          type = TYPE_INCOME;
          onTypeChange();
        "
      >
        收入
      </button>
    </div>

    <label class="field amount-field">
      <span>金额（元）</span>
      <input
        v-model="amountText"
        inputmode="decimal"
        placeholder="0.00"
        autocomplete="off"
        required
      />
      <small v-if="parsedCents !== null">将保存为 {{ parsedCents }} 分</small>
      <small v-else-if="amountText.trim() !== ''" class="invalid">请输入有效的正数金额</small>
    </label>

    <label class="field">
      <span>分类</span>
      <select v-model="categoryId" required>
        <option v-for="c in availableCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </label>

    <label class="field">
      <span>账户</span>
      <select v-model="accountId" required>
        <option v-for="a in meta.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <small v-if="isRefund">
        选这笔钱<strong>实际进到</strong>的账户，可以和当初付款的账户不同。
      </small>
    </label>

    <label class="field">
      <span>日期</span>
      <input v-model="dateText" type="date" required />
    </label>

    <label class="field">
      <span>备注</span>
      <input v-model="note" type="text" placeholder="可选" maxlength="200" />
    </label>

    <fieldset class="field tags">
      <legend>标签</legend>

      <div v-if="tags.length > 0" class="tag-list">
        <button v-for="tag in tags" :key="tag" type="button" class="tag" @click="removeTag(tag)">
          {{ tag }} <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div class="tag-add">
        <input
          v-model="tagDraft"
          type="text"
          placeholder="输入后按回车添加"
          maxlength="32"
          @keydown.enter.prevent="addTag"
        />
        <button type="button" @click="addTag">添加</button>
      </div>

      <div v-if="meta.tags.length > 0" class="tag-suggest">
        <button
          v-for="t in meta.tags.slice(0, 8)"
          :key="t.name"
          type="button"
          :disabled="tags.includes(t.name)"
          @click="tags = [...tags, t.name]"
        >
          {{ t.name }}
        </button>
      </div>
    </fieldset>

    <label v-if="type === TYPE_INCOME" class="field checkbox">
      <input v-model="isRefund" type="checkbox" @change="onRefundChange" />
      <span>这是退款 / 别人还我钱（计入收入，可关联原始支出）</span>
    </label>

    <fieldset v-if="type === TYPE_INCOME && isRefund" class="field">
      <legend>关联原始支出</legend>
      <small>选择这笔退款对应的原始支出（可多选）</small>
      <label v-if="candidateExpenses.length > 5" class="field candidate-search">
        <span class="visually-hidden">搜索支出</span>
        <input
          v-model="candidateQuery"
          type="search"
          placeholder="搜索备注 / 分类 / 金额"
          autocomplete="off"
        />
      </label>
      <div v-if="filteredCandidates.length > 0" class="candidate-list">
        <div
          v-for="item in filteredCandidates"
          :key="item.id"
          class="candidate-row"
          :class="{ selected: isSelected(item.id) }"
        >
          <button type="button" class="candidate-select" @click="toggleOriginal(item.id)">
            <span class="candidate-check">{{ isSelected(item.id) ? '✓' : '○' }}</span>
            <span class="candidate-info">
              <span class="candidate-cat">
                {{ meta.categoryName(item.categoryId) }}
                <span v-if="item.note" class="candidate-note">{{ item.note }}</span>
              </span>
              <span class="candidate-date">{{ formatDayLabel(item.date) }}</span>
            </span>
            <span class="candidate-amount">{{ formatYuan(item.amountCents) }}</span>
          </button>
          <button
            type="button"
            class="candidate-detail"
            @click.stop="showCandidateDetail(item.id)"
          >
            详情
          </button>
        </div>
      </div>
      <p v-else-if="candidateExpenses.length > 0" class="muted">没有匹配的支出记录。</p>
      <p v-else class="muted">没有可关联的支出记录。</p>
    </fieldset>

    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

    <div class="actions">
      <button type="submit" class="primary" :disabled="saving">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button type="button" class="ghost" :disabled="saving" @click="router.back()">取消</button>
      <button v-if="isEdit" type="button" class="danger" :disabled="saving" @click="remove">
        删除
      </button>
    </div>
  </form>
  <TransactionDetailModal
    v-if="detailModalTxId !== null"
    :tx-id="detailModalTxId"
    @close="detailModalTxId = null"
  />
</template>

<style scoped>
.form {
  display: grid;
  gap: 1rem;
}

.type-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  padding: 0.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.type-switch button {
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}

.type-switch button.active {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 600;
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

.amount-field input {
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

small {
  font-size: 0.75rem;
}

small.invalid {
  color: var(--danger);
}

.tags {
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  padding: 0.65rem;
  margin: 0;
}

.tags legend {
  padding: 0 0.35rem;
  font-size: 0.85rem;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

.tag {
  /* 44px minimum touch target: these are removable chips, and a 32px chip is a miss. */
  min-height: 44px;
  padding: 0.2rem 0.7rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 1rem;
  cursor: pointer;
}

.tag-add {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.4rem;
}

.tag-add input {
  font-size: 16px;
  min-height: 44px;
  padding: 0.45rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.tag-add button {
  min-height: 44px;
  padding: 0 0.9rem;
  font: inherit;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.tag-suggest {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.5rem;
}

.tag-suggest button {
  /* 44px minimum touch target. */
  min-height: 44px;
  padding: 0.15rem 0.6rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--muted);
  background: none;
  border: 1px dashed var(--border);
  border-radius: 1rem;
  cursor: pointer;
}

.tag-suggest button:disabled {
  opacity: 0.4;
  cursor: default;
}

.checkbox {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  font-size: 0.85rem;
}

/*
 * A native checkbox is 13–22px, which is below the 44px touch minimum. Rather than
 * shrinking the target, the box is redrawn at the full target size with
 * `appearance: none` and a `background-image` tick — the whole 44px area is the
 * control, so a tap anywhere in it toggles.
 */
.checkbox input {
  appearance: none;
  -webkit-appearance: none;
  width: 44px;
  height: 44px;
  min-height: 44px;
  margin: 0;
  flex: 0 0 auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.checkbox input:checked {
  background-color: var(--accent);
  border-color: var(--accent);
  /* A tick drawn as a background image, so no icon font or SVG asset is needed. */
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='5 13 10 18 19 7'/></svg>");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 22px 22px;
}

.checkbox input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions .primary {
  grid-column: 1 / -1;
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

.ghost,
.danger {
  background: none;
  border: 1px solid var(--border);
  color: var(--fg);
}

.danger {
  color: var(--danger);
}

.actions button:disabled {
  opacity: 0.6;
  cursor: progress;
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

<style scoped>
/* Refund candidate list: each row is a select-toggle plus a detail button */
.candidate-list {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.candidate-row {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  overflow: hidden;
  background: var(--bg);
  transition: border-color var(--dur-quick), background var(--dur-quick);
}

.candidate-row.selected {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.candidate-select {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0.4rem 0.65rem;
  font: inherit;
  color: var(--fg);
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
}

.candidate-check {
  flex: 0 0 auto;
  width: 1.25rem;
  font-size: 1rem;
  color: var(--accent);
  text-align: center;
}

.candidate-info {
  flex: 1;
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.candidate-search {
  margin-bottom: 0.35rem;
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

.candidate-search input {
  width: 100%;
  min-height: 44px;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  padding: 0 0.75rem;
}

.candidate-cat {
  font-size: 0.88rem;
  font-weight: 500;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.candidate-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--muted);
}

.candidate-row.selected .candidate-cat {
  font-weight: 600;
}

.candidate-date {
  font-size: 0.72rem;
  color: var(--muted);
}

.candidate-amount {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
}

.candidate-detail {
  flex: 0 0 auto;
  min-width: 52px;
  min-height: 48px;
  padding: 0 0.6rem;
  font-size: 0.8rem;
  color: var(--accent);
  background: var(--surface);
  border: 0;
  border-left: 1px solid var(--border);
  cursor: pointer;
}

.candidate-detail:hover {
  background: var(--accent-subtle);
}
</style>
