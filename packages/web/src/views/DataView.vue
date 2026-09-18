<script setup lang="ts">
/**
 * Data: export, app-CSV import, backups; platform bills open a dedicated modal.
 *
 * The WeChat/Alipay preview table lives in PlatformImportModal so this page stays
 * short on a phone — the import flow needs room for row selection and category edits.
 */
import { computed, onMounted, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type { BackupFile, ImportResult, PlatformImportResult } from '../api/client.js';
import { formatCents } from '../utils/money.js';
import PlatformImportModal from '../components/PlatformImportModal.vue';

const backups = ref<BackupFile[]>([]);
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref<string | null>(null);
const importResult = ref<ImportResult | null>(null);
const chosen = ref<{ name: string; sizeBytes: number; text: string } | null>(null);
const importMode = ref<'transactions' | 'transfers'>('transactions');
const showPlatformModal = ref(false);
/** Summary of the last finished platform import, shown under the entry button. */
const lastPlatformResult = ref<PlatformImportResult | null>(null);

const RESTORE_COMMAND =
  'docker compose stop jizhang\n' +
  'docker compose run --rm jizhang node /app/packages/server/dist/cli.js restore /data/backups/<文件名>\n' +
  'docker compose start jizhang';

const isOffline = computed(() => typeof navigator !== 'undefined' && navigator.onLine === false);

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

function chooseImportMode(mode: 'transactions' | 'transfers'): void {
  importMode.value = mode;
  chosen.value = null;
  importResult.value = null;
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
  errorMessage.value = null;
  if (file === undefined) {
    chosen.value = null;
    return;
  }
  try {
    chosen.value = { name: file.name, sizeBytes: file.size, text: await file.text() };
  } catch (error) {
    record(error);
    chosen.value = null;
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

function onPlatformFinished(result: PlatformImportResult): void {
  lastPlatformResult.value = result;
}

function clearImport(): void {
  chosen.value = null;
  importResult.value = null;
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
      本应用 CSV 与微信/支付宝账单分开导入。平台导入在<strong>独立弹窗</strong>里完成：
      预览明细 → 勾选 → 改分类 → 确认导入所选。
    </p>

    <div class="mode-switch" role="group" aria-label="导入类型">
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
    </div>

    <p class="hint">
      只支持导入<strong>本应用导出</strong>的账单/转账 CSV。相同 id 会跳过，重复导入不重复入账。
    </p>

    <label class="field">
      <span>选择 CSV 文件</span>
      <input type="file" accept=".csv,text/csv" :disabled="busy" @change="onFileChosen" />
    </label>

    <template v-if="chosen !== null">
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

    <p v-if="importResult !== null" class="result notice notice-ok" role="status">
      导入完成：新增 {{ importResult.inserted }} 条，跳过 {{ importResult.skipped }} 条（已存在），
      共读取 {{ importResult.total }} 条。
    </p>

    <p v-if="isOffline" class="hint" role="status">离线状态下无法导入，请先连接网络。</p>
  </section>

  <section class="card">
    <h2>微信 / 支付宝账单</h2>
    <p class="hint">
      上传平台导出文件（微信 .xlsx / 支付宝 GBK CSV）。自动过滤提现理财与「不计收支」；
      与账本中同日同额的手记账单会标为可能重复并默认不勾选。
    </p>
    <button type="button" class="primary" :disabled="isOffline" @click="showPlatformModal = true">
      打开导入面板
    </button>
    <p v-if="lastPlatformResult !== null" class="result notice notice-ok" role="status">
      上次导入：{{ lastPlatformResult.source === 'wechat' ? '微信' : '支付宝' }}，
      新增 {{ lastPlatformResult.inserted }} 条，
      支出 {{ formatCents(lastPlatformResult.expenseCents) }} 元、
      收入 {{ formatCents(lastPlatformResult.incomeCents) }} 元。
    </p>
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

  <PlatformImportModal
    v-if="showPlatformModal"
    @close="showPlatformModal = false"
    @finished="onPlatformFinished"
  />

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

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
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
