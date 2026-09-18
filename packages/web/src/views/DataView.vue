<script setup lang="ts">
/**
 * Data: export, import (app CSV + WeChat/Alipay), and backups.
 *
 * Platform bills: dry-run posts the file and returns a row table; the user selects
 * rows, may override categories, then confirm re-posts the same file with
 * selectedIds + categoryOverrides. Bytes go as base64 JSON so GBK/xlsx stay intact.
 */
import { computed, onMounted, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type {
  BackupFile,
  ImportResult,
  PlatformImportResult,
  PlatformImportRow,
} from '../api/client.js';
import { formatCents } from '../utils/money.js';
import { useMetaStore } from '../stores/meta.js';
import { TYPE_INCOME } from '../api/client.js';

const meta = useMetaStore();
const backups = ref<BackupFile[]>([]);
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref<string | null>(null);
const importResult = ref<ImportResult | null>(null);
const platformResult = ref<PlatformImportResult | null>(null);
const chosen = ref<{ name: string; sizeBytes: number; text: string } | null>(null);
const platformFile = ref<{ name: string; sizeBytes: number; bytes: ArrayBuffer } | null>(null);
const importMode = ref<'transactions' | 'transfers' | 'platform'>('transactions');
const platformSource = ref<'auto' | 'wechat' | 'alipay'>('auto');
/** Preview-only: true until a confirm write finishes. */
const platformPreviewOnly = ref(true);
/** Row ids currently checked for import. */
const selectedRowIds = ref<Set<string>>(new Set());
/** Row id → category name override. */
const categoryOverrides = ref<Record<string, string>>({});

const RESTORE_COMMAND =
  'docker compose stop jizhang\n' +
  'docker compose run --rm jizhang node /app/packages/server/dist/cli.js restore /data/backups/<文件名>\n' +
  'docker compose start jizhang';

const isOffline = computed(() => typeof navigator !== 'undefined' && navigator.onLine === false);

const platformAccept =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
      platformCandidateRows.value
        .filter((row) => !row.possibleDuplicate)
        .map((row) => row.id),
    );
  } else {
    selectedRowIds.value = new Set();
  }
}

function seedSelectionFromPreview(result: PlatformImportResult): void {
  // Soft-duplicates stay visible but unchecked so the user must opt in.
  selectedRowIds.value = new Set(
    result.rows
      .filter(
        (row) =>
          !row.ignored &&
          !row.alreadyExists &&
          row.amountCents > 0 &&
          !row.possibleDuplicate,
      )
      .map((row) => row.id),
  );
  categoryOverrides.value = {};
}

function record(error: unknown): void {
  if (error instanceof ApiError && error.isUnauthorized) return;
  errorMessage.value = error instanceof Error ? error.message : String(error);
}

async function loadBackups(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    backups.value = (await api.portability.listBackups()).items;
  } catch (error) {
    record(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadBackups();
  void meta.load();
});

function chooseImportMode(mode: 'transactions' | 'transfers' | 'platform'): void {
  importMode.value = mode;
  chosen.value = null;
  platformFile.value = null;
  importResult.value = null;
  platformResult.value = null;
  platformPreviewOnly.value = true;
  selectedRowIds.value = new Set();
  categoryOverrides.value = {};
  errorMessage.value = null;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function whenLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function takeBackup(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = null;
  try {
    await api.portability.createBackup();
    await loadBackups();
  } catch (error) {
    record(error);
  } finally {
    busy.value = false;
  }
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  importResult.value = null;
  platformResult.value = null;
  platformPreviewOnly.value = true;
  selectedRowIds.value = new Set();
  categoryOverrides.value = {};
  errorMessage.value = null;
  if (file === undefined) {
    chosen.value = null;
    platformFile.value = null;
    return;
  }
  try {
    if (importMode.value === 'platform') {
      chosen.value = null;
      platformFile.value = {
        name: file.name,
        sizeBytes: file.size,
        bytes: await file.arrayBuffer(),
      };
    } else {
      platformFile.value = null;
      chosen.value = { name: file.name, sizeBytes: file.size, text: await file.text() };
    }
  } catch (error) {
    record(error);
    chosen.value = null;
    platformFile.value = null;
  }
}

async function runImport(): Promise<void> {
  if (chosen.value === null || busy.value) return;
  busy.value = true;
  errorMessage.value = null;
  importResult.value = null;
  try {
    importResult.value =
      importMode.value === 'transfers'
        ? await api.portability.importTransfers(chosen.value.text)
        : await api.portability.importTransactions(chosen.value.text);
  } catch (error) {
    record(error);
  } finally {
    busy.value = false;
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
  } catch (error) {
    record(error);
  } finally {
    busy.value = false;
  }
}

function clearImport(): void {
  chosen.value = null;
  platformFile.value = null;
  importResult.value = null;
  platformResult.value = null;
  platformPreviewOnly.value = true;
  selectedRowIds.value = new Set();
  categoryOverrides.value = {};
  errorMessage.value = null;
}
</script>

<template>
  <section class="card">
    <h2>导出</h2>
    <p class="hint">
      下载 CSV 文件，可直接用 Excel 打开（中文不会乱码）。金额为元；账单含退款标记，转账带出入账户。
    </p>
    <a class="action" :href="api.portability.exportUrl('transactions')" download>导出账单</a>
    <a class="action" :href="api.portability.exportUrl('salaries')" download>导出工资记录</a>
    <a class="action" :href="api.portability.exportUrl('recurring')" download>导出周期账单规则</a>
    <a class="action" :href="api.portability.exportUrl('transfers')" download>导出转账</a>
  </section>

  <section class="card">
    <h2>导入数据</h2>
    <p class="hint">
      支持本应用导出的账单/转账 CSV，以及<strong>微信 / 支付宝</strong>账单文件。
      平台导入支持<strong>预览 → 勾选 → 改分类 → 确认</strong>；已存在 id 会跳过，重复导入不重复入账。
    </p>

    <div class="mode-switch mode-switch-3" role="group" aria-label="导入类型">
      <button
        type="button"
        :class="{ active: importMode === 'transactions' }"
        :aria-pressed="importMode === 'transactions'"
        @click="chooseImportMode('transactions')"
      >
        本应用账单
      </button>
      <button
        type="button"
        :class="{ active: importMode === 'transfers' }"
        :aria-pressed="importMode === 'transfers'"
        @click="chooseImportMode('transfers')"
      >
        转账
      </button>
      <button
        type="button"
        :class="{ active: importMode === 'platform' }"
        :aria-pressed="importMode === 'platform'"
        @click="chooseImportMode('platform')"
      >
        微信/支付宝
      </button>
    </div>

    <template v-if="importMode === 'platform'">
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
        支持 .csv 与微信 .xlsx；支付宝 GBK 请直接上传原文件。
      </p>
    </template>

    <label class="field">
      <span>{{ importMode === 'platform' ? '选择微信/支付宝账单文件' : '选择 CSV 文件' }}</span>
      <input
        type="file"
        :accept="importMode === 'platform' ? platformAccept : '.csv,text/csv'"
        :disabled="busy"
        @change="onFileChosen"
      />
    </label>

    <template v-if="importMode !== 'platform' && chosen !== null">
      <p class="preview">
        已选择 <strong>{{ chosen.name }}</strong>（{{ sizeLabel(chosen.sizeBytes) }}）。
        导入只会<strong>新增</strong>{{ importMode === 'transfers' ? '转账' : '账单' }}，不会修改或删除现有数据。
      </p>
      <div class="actions">
        <button type="button" :disabled="busy || isOffline" @click="runImport">
          {{ busy ? '导入中…' : '确认导入' }}
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="clearImport">取消</button>
      </div>
    </template>

    <template v-if="importMode === 'platform' && platformFile !== null">
      <p class="preview">
        已选择 <strong>{{ platformFile.name }}</strong>（{{ sizeLabel(platformFile.sizeBytes) }}）。
        先点「预览」查看明细，再勾选并确认。
      </p>
      <div class="actions actions-3">
        <button
          type="button"
          class="ghost"
          :disabled="busy || isOffline"
          @click="runPlatformPreview"
        >
          {{ busy ? '处理中…' : '预览' }}
        </button>
        <button
          type="button"
          :disabled="busy || isOffline || platformResult === null || !platformPreviewOnly || selectedCount === 0"
          @click="runPlatformConfirm"
        >
          {{ busy ? '导入中…' : `确认导入所选（${selectedCount}）` }}
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="clearImport">取消</button>
      </div>
    </template>

    <div
      v-if="platformResult !== null && platformPreviewOnly"
      class="result notice notice-ok"
      role="status"
    >
      <p>
        <strong>预览（未写入）</strong>：来源
        {{ platformResult.source === 'wechat' ? '微信' : '支付宝' }}，
        可入账 {{ platformCandidateRows.length }} 条，过滤/已存在 {{ platformIgnoredRows.length }} 条，
        共读取 {{ platformResult.total }} 条。当前勾选
        <strong>{{ selectedCount }}</strong> 条 —
        支出 {{ formatCents(selectedExpenseCents) }} 元、收入 {{ formatCents(selectedIncomeCents) }} 元。
      </p>
      <div class="table-actions">
        <button type="button" class="ghost" @click="selectAllCandidates(true)">全选可导入</button>
        <button type="button" class="ghost" @click="selectAllCandidates(false)">全不选</button>
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
                    v-if="!categoryOptionsFor(row.type).some((o) => o.name === effectiveCategoryName(row))"
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

      <p v-if="platformResult.warnings.length > 0" class="hint">
        {{ platformResult.warnings.join('；') }}
      </p>
      <p v-if="platformResult.accountsCreated > 0" class="hint">
        若「微信 / 支付宝」账户不存在，确认导入时会自动创建。
      </p>
    </div>

    <div v-if="platformResult !== null && !platformPreviewOnly" class="result notice notice-ok" role="status">
      <p>
        <strong>导入完成</strong>：来源
        {{ platformResult.source === 'wechat' ? '微信' : '支付宝' }}，
        新增 <strong>{{ platformResult.inserted }}</strong> 条，
        跳过 {{ platformResult.skipped }} 条（已存在），
        过滤 {{ platformResult.ignored }} 条，共读取 {{ platformResult.total }} 条。
      </p>
      <p>
        本次所选合计：支出 {{ formatCents(platformResult.expenseCents) }} 元、
        收入 {{ formatCents(platformResult.incomeCents) }} 元。
        日期范围 {{ platformResult.dateFrom ?? '—' }} ～ {{ platformResult.dateTo ?? '—' }}。
      </p>
      <p v-if="platformResult.accountsCreated > 0 || platformResult.categoriesCreated > 0">
        新建账户 {{ platformResult.accountsCreated }} 个、分类 {{ platformResult.categoriesCreated }} 个。
      </p>
      <ul v-if="platformResult.warnings.length > 0" class="warnings">
        <li v-for="(w, i) in platformResult.warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <p v-if="importResult !== null" class="result notice notice-ok" role="status">
      导入完成：新增 {{ importResult.inserted }} 条，跳过 {{ importResult.skipped }} 条（已存在），
      共读取 {{ importResult.total }} 条。
    </p>

    <p v-if="isOffline" class="hint" role="status">离线状态下无法导入，请先连接网络。</p>
  </section>

  <section class="card">
    <h2>备份</h2>
    <p class="hint">备份是数据库快照，用于整库恢复；导出文件用于查看与迁移。</p>

    <button type="button" class="primary" :disabled="busy || isOffline" @click="takeBackup">
      {{ busy ? '处理中…' : '立即备份' }}
    </button>

    <p v-if="loading && backups.length === 0" class="hint">加载中…</p>
    <p v-else-if="backups.length === 0" class="hint">还没有备份。点上面的按钮创建第一个。</p>

    <ul v-else class="backups">
      <li v-for="file in backups" :key="file.fileName">
        <span class="name">{{ file.fileName }}</span>
        <span class="meta">{{ sizeLabel(file.sizeBytes) }} · {{ whenLabel(file.createdAtMs) }}</span>
      </li>
    </ul>

    <details class="restore">
      <summary>如何恢复备份</summary>
      <p class="hint">
        恢复会替换数据库文件，必须在服务停止时进行，因此不提供页面内按钮。在服务器上执行：
      </p>
      <pre>{{ RESTORE_COMMAND }}</pre>
    </details>
  </section>

  <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>
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

.hint {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.action {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 0.85rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--fg);
  text-decoration: none;
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
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

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.mode-switch-3 {
  grid-template-columns: 1fr 1fr 1fr;
}

.mode-switch button {
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
}

.mode-switch button.active {
  color: var(--fg);
  background: var(--surface-soft);
  border-color: var(--accent);
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

.result {
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
}

.result p {
  margin: 0 0 0.35rem;
}

.warnings {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  color: var(--muted);
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions-3 {
  grid-template-columns: 1fr 1.4fr 1fr;
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

.ignored {
  margin-top: 0.4rem;
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
  width: 100%;
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.actions button:not(.ghost) {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.backups {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.backups li {
  display: grid;
  gap: 0.1rem;
  padding: 0.5rem 0.7rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.name {
  font-size: 0.82rem;
  word-break: break-all;
}

.meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.restore {
  margin-top: 0.75rem;
}

.restore summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

pre {
  margin: 0.5rem 0 0;
  padding: 0.6rem 0.7rem;
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}
</style>
