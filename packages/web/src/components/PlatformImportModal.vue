<script setup lang="ts">
/**
 * WeChat / Alipay platform bill import — full workflow in a modal.
 *
 * Keeps Data page short: source tabs, file, dry-run preview table with per-row
 * category override + selection, then confirm. Soft-duplicates default unchecked.
 */
import { computed, onMounted, ref } from 'vue';
import { ApiError, api, TYPE_INCOME } from '../api/client.js';
import type { PlatformImportResult, PlatformImportRow } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { formatCents } from '../utils/money.js';

const emit = defineEmits<{
  close: [];
  finished: [result: PlatformImportResult];
}>();

const meta = useMetaStore();
const busy = ref(false);
const errorMessage = ref<string | null>(null);
const platformSource = ref<'auto' | 'wechat' | 'alipay'>('auto');
const platformFile = ref<{ name: string; sizeBytes: number; bytes: ArrayBuffer } | null>(null);
const platformResult = ref<PlatformImportResult | null>(null);
const platformPreviewOnly = ref(true);
const selectedRowIds = ref<Set<string>>(new Set());
const categoryOverrides = ref<Record<string, string>>({});

const platformAccept =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const isOffline = computed(() => typeof navigator !== 'undefined' && navigator.onLine === false);

const platformCandidateRows = computed(() =>
  (platformResult.value?.rows ?? []).filter(
    (row) => !row.ignored && !row.alreadyExists && row.amountCents > 0,
  ),
);

const platformIgnoredRows = computed(() =>
  (platformResult.value?.rows ?? []).filter((row) => row.ignored || row.alreadyExists),
);

const selectedCount = computed(() => selectedRowIds.value.size);

const selectedExpenseCents = computed(() => {
  let sum = 0;
  for (const row of platformCandidateRows.value) {
    if (selectedRowIds.value.has(row.id) && row.type !== TYPE_INCOME) sum += row.amountCents;
  }
  return sum;
});

const selectedIncomeCents = computed(() => {
  let sum = 0;
  for (const row of platformCandidateRows.value) {
    if (selectedRowIds.value.has(row.id) && row.type === TYPE_INCOME) sum += row.amountCents;
  }
  return sum;
});

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryOptionsFor(type: number): { id: string; name: string }[] {
  const list = type === TYPE_INCOME ? meta.incomeCategories : meta.expenseCategories;
  return list.map((c) => ({ id: c.id, name: c.name }));
}

function effectiveCategoryName(row: PlatformImportRow): string {
  return categoryOverrides.value[row.id] ?? row.categoryName;
}

function onCategoryChange(row: PlatformImportRow, event: Event): void {
  const target = event.target as HTMLSelectElement;
  const next = target.value;
  if (next === '' || next === row.categoryName) {
    const copy = { ...categoryOverrides.value };
    delete copy[row.id];
    categoryOverrides.value = copy;
    return;
  }
  categoryOverrides.value = { ...categoryOverrides.value, [row.id]: next };
}

function toggleRow(id: string): void {
  const next = new Set(selectedRowIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedRowIds.value = next;
}

function selectAllCandidates(on: boolean): void {
  if (on) {
    selectedRowIds.value = new Set(
      platformCandidateRows.value.filter((row) => !row.possibleDuplicate).map((row) => row.id),
    );
  } else {
    selectedRowIds.value = new Set();
  }
}

function seedSelectionFromPreview(result: PlatformImportResult): void {
  selectedRowIds.value = new Set(
    result.rows
      .filter(
        (row) =>
          !row.ignored && !row.alreadyExists && row.amountCents > 0 && !row.possibleDuplicate,
      )
      .map((row) => row.id),
  );
  categoryOverrides.value = {};
}

function record(error: unknown): void {
  if (error instanceof ApiError && error.isUnauthorized) return;
  errorMessage.value = error instanceof Error ? error.message : String(error);
}

function close(): void {
  if (!busy.value) emit('close');
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  platformResult.value = null;
  platformPreviewOnly.value = true;
  selectedRowIds.value = new Set();
  categoryOverrides.value = {};
  errorMessage.value = null;
  if (file === undefined) {
    platformFile.value = null;
    return;
  }
  try {
    platformFile.value = {
      name: file.name,
      sizeBytes: file.size,
      bytes: await file.arrayBuffer(),
    };
  } catch (error) {
    record(error);
    platformFile.value = null;
  }
}

async function runPlatformPreview(): Promise<void> {
  if (platformFile.value === null || busy.value) return;
  busy.value = true;
  errorMessage.value = null;
  platformResult.value = null;
  try {
    const result = await api.portability.importPlatformBills({
      bytes: platformFile.value.bytes,
      source: platformSource.value,
      dryRun: true,
      fileName: platformFile.value.name,
      selectedIds: null,
      categoryOverrides: {},
    });
    platformResult.value = result;
    platformPreviewOnly.value = true;
    seedSelectionFromPreview(result);
  } catch (error) {
    record(error);
  } finally {
    busy.value = false;
  }
}

async function runPlatformConfirm(): Promise<void> {
  if (platformFile.value === null || busy.value) return;
  busy.value = true;
  errorMessage.value = null;
  try {
    const overrides: Record<string, string> = {};
    for (const row of platformCandidateRows.value) {
      if (!selectedRowIds.value.has(row.id)) continue;
      const name = categoryOverrides.value[row.id];
      if (typeof name === 'string' && name !== '' && name !== row.categoryName) {
        overrides[row.id] = name;
      }
    }
    const result = await api.portability.importPlatformBills({
      bytes: platformFile.value.bytes,
      source: platformSource.value,
      dryRun: false,
      fileName: platformFile.value.name,
      selectedIds: [...selectedRowIds.value],
      categoryOverrides: overrides,
    });
    platformResult.value = result;
    platformPreviewOnly.value = false;
    emit('finished', result);
  } catch (error) {
    record(error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void meta.load();
  window.addEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click="onBackdropClick">
      <div
        class="modal-card import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="微信支付宝账单导入"
      >
        <header class="modal-head">
          <h2>微信 / 支付宝账单导入</h2>
          <button type="button" class="modal-close" aria-label="关闭" @click="close">✕</button>
        </header>

        <div class="modal-body">
          <div class="mode-switch" role="group" aria-label="账单来源">
            <button
              type="button"
              :class="{ active: platformSource === 'auto' }"
              :aria-pressed="platformSource === 'auto'"
              @click="platformSource = 'auto'"
            >
              自动识别
            </button>
            <button
              type="button"
              :class="{ active: platformSource === 'wechat' }"
              :aria-pressed="platformSource === 'wechat'"
              @click="platformSource = 'wechat'"
            >
              微信
            </button>
            <button
              type="button"
              :class="{ active: platformSource === 'alipay' }"
              :aria-pressed="platformSource === 'alipay'"
              @click="platformSource = 'alipay'"
            >
              支付宝
            </button>
          </div>

          <p class="hint">
            微信：账单页 →「···」→ 下载账单；支付宝：账单 → 开具交易流水证明。
            支持 .csv 与微信 .xlsx；支付宝 GBK 请直接上传原文件。流程：预览 → 勾选/改分类 → 确认。
          </p>

          <label class="field">
            <span>选择账单文件</span>
            <input
              type="file"
              :accept="platformAccept"
              :disabled="busy"
              @change="onFileChosen"
            />
          </label>

          <p v-if="platformFile !== null" class="preview">
            已选择 <strong>{{ platformFile.name }}</strong>（{{ sizeLabel(platformFile.sizeBytes) }}）。
          </p>

          <div class="actions actions-3">
            <button
              type="button"
              class="ghost"
              :disabled="busy || isOffline || platformFile === null"
              @click="runPlatformPreview"
            >
              {{ busy && platformPreviewOnly ? '处理中…' : '预览' }}
            </button>
            <button
              type="button"
              class="primary-btn"
              :disabled="
                busy ||
                isOffline ||
                platformResult === null ||
                !platformPreviewOnly ||
                selectedCount === 0
              "
              @click="runPlatformConfirm"
            >
              {{ busy && !platformPreviewOnly ? '导入中…' : `确认导入所选（${selectedCount}）` }}
            </button>
            <button type="button" class="ghost" :disabled="busy" @click="close">关闭</button>
          </div>

          <div
            v-if="platformResult !== null && platformPreviewOnly"
            class="result-panel"
            role="status"
          >
            <p>
              <strong>预览（未写入）</strong>：来源
              {{ platformResult.source === 'wechat' ? '微信' : '支付宝' }}，
              可入账 {{ platformCandidateRows.length }} 条，过滤/已存在
              {{ platformIgnoredRows.length }} 条，共读取 {{ platformResult.total }} 条。
              当前勾选 <strong>{{ selectedCount }}</strong> 条 —
              支出 {{ formatCents(selectedExpenseCents) }} 元、
              收入 {{ formatCents(selectedIncomeCents) }} 元。
            </p>
            <div class="table-actions">
              <button type="button" class="ghost" @click="selectAllCandidates(true)">
                全选可导入
              </button>
              <button type="button" class="ghost" @click="selectAllCandidates(false)">
                全不选
              </button>
            </div>

            <div v-if="platformCandidateRows.length > 0" class="bill-table-wrap">
              <table class="bill-table">
                <thead>
                  <tr>
                    <th scope="col">选</th>
                    <th scope="col">日期</th>
                    <th scope="col">说明</th>
                    <th scope="col">金额</th>
                    <th scope="col">分类</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in platformCandidateRows" :key="row.id">
                    <td>
                      <input
                        type="checkbox"
                        :checked="selectedRowIds.has(row.id)"
                        :aria-label="`选择 ${row.dateLabel} ${row.note}`"
                        @change="toggleRow(row.id)"
                      />
                    </td>
                    <td class="cell-date">{{ row.dateLabel }}</td>
                    <td class="cell-note">
                      <div>{{ row.note }}</div>
                      <div class="cell-sub">
                        {{ row.counterparty }}
                        <span v-if="row.sourceCategory"> · {{ row.sourceCategory }}</span>
                        <span v-if="effectiveCategoryName(row) !== row.categoryName">
                          · 建议「{{ row.categoryName }}」→「{{ effectiveCategoryName(row) }}」
                        </span>
                      </div>
                      <div v-if="row.possibleDuplicate" class="dup-hint">
                        可能与已有账单重复{{
                          row.duplicateOfNote ? `（已有备注：${row.duplicateOfNote}）` : ''
                        }}，已默认不勾选
                      </div>
                    </td>
                    <td class="cell-amount" :class="row.type === TYPE_INCOME ? 'income' : 'expense'">
                      {{ row.type === TYPE_INCOME ? '+' : '−' }}{{ formatCents(row.amountCents) }}
                    </td>
                    <td>
                      <select
                        class="cat-select"
                        :value="effectiveCategoryName(row)"
                        :aria-label="`分类 ${row.note}`"
                        @change="onCategoryChange(row, $event)"
                      >
                        <option
                          v-for="opt in categoryOptionsFor(row.type)"
                          :key="opt.id"
                          :value="opt.name"
                        >
                          {{ opt.name }}
                        </option>
                        <option
                          v-if="
                            !categoryOptionsFor(row.type).some(
                              (o) => o.name === effectiveCategoryName(row),
                            )
                          "
                          :value="effectiveCategoryName(row)"
                        >
                          {{ effectiveCategoryName(row) }}
                        </option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="hint">没有可导入的明细（可能全部被过滤或已存在）。</p>

            <details v-if="platformIgnoredRows.length > 0" class="ignored">
              <summary>已过滤 / 已存在（{{ platformIgnoredRows.length }}）</summary>
              <ul class="ignored-list">
                <li v-for="row in platformIgnoredRows" :key="row.id">
                  {{ row.dateLabel }} · {{ row.note || row.counterparty }} ·
                  {{ formatCents(row.amountCents) }} —
                  {{ row.alreadyExists ? '账本中已存在' : row.ignoreReason || '已过滤' }}
                </li>
              </ul>
            </details>
          </div>

          <div
            v-if="platformResult !== null && !platformPreviewOnly"
            class="result-panel ok"
            role="status"
          >
            <p>
              <strong>导入完成</strong>：新增
              <strong>{{ platformResult.inserted }}</strong> 条，跳过
              {{ platformResult.skipped }} 条，过滤 {{ platformResult.ignored }} 条。
            </p>
            <p>
              本次所选：支出 {{ formatCents(platformResult.expenseCents) }} 元、
              收入 {{ formatCents(platformResult.incomeCents) }} 元。
            </p>
            <button type="button" class="primary-btn" :disabled="busy" @click="emit('close')">
              完成
            </button>
          </div>

          <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>
          <p v-if="isOffline" class="hint" role="status">离线状态下无法导入，请先连接网络。</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 0;
  background: var(--scrim);
  backdrop-filter: blur(2px);
  animation: fadeIn var(--dur-quick) var(--ease-out);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
}

.modal-card.import-modal {
  width: 100%;
  max-width: 40rem;
  max-height: 100dvh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  animation: slideUp var(--dur-base) var(--ease-out);
}

@keyframes slideUp {
  from {
    transform: translateY(12%);
    opacity: 0.6;
  }
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.modal-head h2 {
  flex: 1;
  margin: 0;
  font-size: 1rem;
}

.modal-close {
  width: 44px;
  height: 44px;
  font-size: 1rem;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 0.85rem 1rem 1.25rem;
  -webkit-overflow-scrolling: touch;
}

.hint {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.mode-switch button {
  min-height: 44px;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.mode-switch button.active {
  color: var(--fg);
  background: var(--surface-soft);
  border-color: var(--accent);
}

.field {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.field > span {
  font-size: 0.85rem;
  color: var(--muted);
}

input[type='file'] {
  width: 100%;
  min-height: 44px;
  padding: 0.5rem 0.6rem;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.preview {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  line-height: 1.6;
}

.actions {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.actions-3 {
  grid-template-columns: 1fr 1.4fr 1fr;
}

.actions button,
.table-actions button,
.primary-btn,
.ghost {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.55rem;
  cursor: pointer;
}

.actions button:disabled,
.primary-btn:disabled,
.table-actions button:disabled {
  opacity: 0.55;
  cursor: default;
}

.actions button:not(.ghost),
.primary-btn {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.result-panel {
  margin-top: 0.5rem;
  padding: 0.75rem;
  font-size: 0.82rem;
  line-height: 1.55;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.result-panel.ok {
  border-color: var(--ok);
}

.result-panel p {
  margin: 0 0 0.4rem;
}

.result-panel .primary-btn {
  width: 100%;
  margin-top: 0.4rem;
}

.table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.55rem 0;
}

.bill-table-wrap {
  overflow-x: auto;
  margin: 0.4rem 0 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.bill-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.bill-table th,
.bill-table td {
  padding: 0.45rem 0.5rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
}

.bill-table th {
  font-weight: 600;
  color: var(--muted);
  background: var(--bg);
}

.bill-table tr:last-child td {
  border-bottom: 0;
}

.cell-date {
  white-space: nowrap;
}

.cell-note {
  min-width: 10rem;
  max-width: 16rem;
  word-break: break-word;
}

.cell-sub {
  margin-top: 0.15rem;
  font-size: 0.7rem;
  color: var(--muted);
}

.dup-hint {
  margin-top: 0.25rem;
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--warning);
}

.cell-amount {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cell-amount.expense {
  color: var(--danger);
}

.cell-amount.income {
  color: var(--ok);
}

select,
.cat-select {
  min-height: 44px;
  min-width: 6.5rem;
  max-width: 9rem;
  padding: 0.25rem 0.35rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
}

.ignored summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.ignored-list {
  margin: 0.3rem 0 0.5rem;
  padding-left: 1.1rem;
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--muted);
}

.error {
  margin: 0.75rem 0 0;
  color: var(--danger);
  font-size: 0.82rem;
}

@media (min-width: 40rem) {
  .modal-backdrop {
    align-items: center;
    padding: 1rem;
  }

  .modal-card.import-modal {
    height: auto;
    max-height: min(92dvh, 48rem);
    border-radius: var(--radius-card);
  }
}
</style>
