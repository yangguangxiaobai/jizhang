<script setup lang="ts">
/**
 * Data: export, import (app CSV + WeChat/Alipay), and backups.
 *
 * Platform bills are posted as raw bytes so GBK/xlsx survive the trip; the server
 * decodes, classifies, and may auto-create the 微信/支付宝 account. Dry-run previews
 * counts before any write.
 */
import { computed, onMounted, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type { BackupFile, ImportResult, PlatformImportResult } from '../api/client.js';
import { formatCents } from '../utils/money.js';

const backups = ref<BackupFile[]>([]);
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref<string | null>(null);
/** The outcome of the last app-CSV import, or null before one has run. */
const importResult = ref<ImportResult | null>(null);
/** The outcome of the last platform bill import / dry-run. */
const platformResult = ref<PlatformImportResult | null>(null);
/** The chosen file's name and size, shown before the user commits. */
const chosen = ref<{ name: string; sizeBytes: number; text: string } | null>(null);
/** Platform bill file kept as bytes (GBK / xlsx safe). */
const platformFile = ref<{ name: string; sizeBytes: number; bytes: ArrayBuffer } | null>(null);
const importMode = ref<'transactions' | 'transfers' | 'platform'>('transactions');
const platformSource = ref<'auto' | 'wechat' | 'alipay'>('auto');

const RESTORE_COMMAND =
  'docker compose stop jizhang\n' +
  'docker compose run --rm jizhang node /app/packages/server/dist/cli.js restore /data/backups/<文件名>\n' +
  'docker compose start jizhang';

const isOffline = computed(() => typeof navigator !== 'undefined' && navigator.onLine === false);

const platformAccept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

onMounted(loadBackups);

function chooseImportMode(mode: 'transactions' | 'transfers' | 'platform'): void {
  importMode.value = mode;
  chosen.value = null;
  platformFile.value = null;
  importResult.value = null;
  platformResult.value = null;
  errorMessage.value = null;
}

/** Bytes → a short human string. Display only; no accounting involved. */
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

/**
 * Reads the chosen app-CSV file into memory as text.
 *
 * Reading before submitting is what lets the screen state what is about to happen, and it
 * is required anyway: the import posts the text, not a multipart upload.
 */
async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  importResult.value = null;
  platformResult.value = null;
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

async function runPlatformImport(dryRun: boolean): Promise<void> {
  if (platformFile.value === null || busy.value) return;
  busy.value = true;
  errorMessage.value = null;
  if (dryRun) platformResult.value = null;
  try {
    platformResult.value = await api.portability.importPlatformBills(platformFile.value.bytes, {
      source: platformSource.value,
      dryRun,
      fileName: platformFile.value.name,
    });
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
  errorMessage.value = null;
}
</script>

<template>
  <section class="card">
    <h2>导出</h2>
    <p class="hint">
      下载 CSV 文件，可直接用 Excel 打开（中文不会乱码）。金额为元；账单含退款标记，转账带出入账户。
    </p>
    <!--
      Plain links rather than fetch + Blob: these are file downloads behind the session
      cookie, and following a link avoids loading the whole CSV into memory first.
    -->
    <a class="action" :href="api.portability.exportUrl('transactions')" download>
      导出账单
    </a>
    <a class="action" :href="api.portability.exportUrl('salaries')" download>
      导出工资记录
    </a>
    <a class="action" :href="api.portability.exportUrl('recurring')" download>
      导出周期账单规则
    </a>
    <a class="action" :href="api.portability.exportUrl('transfers')" download>
      导出转账
    </a>
  </section>

  <section class="card">
    <h2>导入数据</h2>
    <p class="hint">
      支持本应用导出的账单/转账 CSV，以及<strong>微信 / 支付宝</strong>账单文件。
      已有相同 id 的记录会被跳过，重复导入不会重复入账。平台导入会自动过滤提现、理财、不计收支等条目；
      分类按关键字粗分，不准的会落在「其他」，导入后可再改。
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
        微信：账单页 → 右上角「···」→ 下载账单；支付宝：账单 → 开具交易流水证明。
        支持 .csv 与微信 .xlsx；支付宝 GBK 文件请直接上传，不要先用 Excel 另存。
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
        建议先「预览」看将写入多少笔，再确认导入。
      </p>
      <div class="actions actions-3">
        <button type="button" class="ghost" :disabled="busy || isOffline" @click="runPlatformImport(true)">
          {{ busy ? '处理中…' : '预览' }}
        </button>
        <button type="button" :disabled="busy || isOffline" @click="runPlatformImport(false)">
          {{ busy ? '导入中…' : '确认导入' }}
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="clearImport">取消</button>
      </div>
    </template>

    <p v-if="importResult !== null" class="result notice notice-ok" role="status">
      导入完成：新增 {{ importResult.inserted }} 条，跳过 {{ importResult.skipped }} 条（已存在），
      共读取 {{ importResult.total }} 条。
    </p>

    <div v-if="platformResult !== null" class="result notice notice-ok" role="status">
      <p>
        {{ platformResult.dryRun ? '预览（未写入）' : '导入完成' }}：来源
        {{ platformResult.source === 'wechat' ? '微信' : '支付宝' }}，将新增/已新增
        <strong>{{ platformResult.inserted }}</strong> 条，
        跳过 {{ platformResult.skipped }} 条（已存在），过滤 {{ platformResult.ignored }} 条，
        共读取 {{ platformResult.total }} 条。
      </p>
      <p>
        日期范围 {{ platformResult.dateFrom ?? '—' }} ～ {{ platformResult.dateTo ?? '—' }}；
        支出合计 {{ formatCents(platformResult.expenseCents) }} 元，
        收入合计 {{ formatCents(platformResult.incomeCents) }} 元。
      </p>
      <p v-if="platformResult.accountsCreated > 0 || platformResult.categoriesCreated > 0">
        将新建账户 {{ platformResult.accountsCreated }} 个、分类 {{ platformResult.categoriesCreated }} 个
        （例如「微信」「支付宝」）。
      </p>
      <ul v-if="platformResult.warnings.length > 0" class="warnings">
        <li v-for="(w, i) in platformResult.warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

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

/* Block-level so each export is a full-width target rather than an inline link. */
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

/* 16px minimum: below it, iOS Safari zooms the page on focus. */
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

/* A completed import is a confirmation: the `ok` notice from main.css, placed here. */
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
  grid-template-columns: 1fr 1fr 1fr;
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
