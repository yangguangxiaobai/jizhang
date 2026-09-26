<script setup lang="ts">
/** Server-backed conversation page; uploaded bytes stay in this view's memory only. */
import { computed, onMounted, ref, watch } from 'vue';
import { api, type AssistantConfirmationCard, type AssistantConversation, type AssistantMessage, type Category, type PlatformImportRow } from '../api/client.js';
import AiThinkingStatus from '../components/AiThinkingStatus.vue';
import PlatformImportRows from '../components/PlatformImportRows.vue';
import { useMetaStore } from '../stores/meta.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const FILE_LIMIT = 5 * 1024 * 1024;
const meta = useMetaStore();
const conversations = ref<AssistantConversation[]>([]);
const conversationId = ref<string | null>(null);
const messages = ref<AssistantMessage[]>([]);
const text = ref('');
const upload = ref<File | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);
const actionFiles = ref<Record<string, File>>({});
const selectedRows = ref<Record<string, string[]>>({});
const categoryOverrides = ref<Record<string, Record<string, string>>>({});
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);
const requestId = ref<string | null>(null);
const current = computed(() => conversations.value.find((item) => item.id === conversationId.value) ?? null);
const categories = computed<readonly Category[]>(() => [...meta.selectableExpenseCategories, ...meta.incomeCategories]);
const canSend = computed(() => !busy.value && (text.value.trim() !== '' || upload.value !== null));
const VALUE_LABELS: Readonly<Record<string, string>> = {
  type: '收支类型',
  amountCents: '金额',
  totalAmountCents: '总金额',
  total: '总条数',
  selected: '已选条数',
  expenseCents: '支出金额',
  incomeCents: '收入金额',
  categoryId: '分类',
  categoryName: '分类',
  accountId: '账户',
  accountName: '账户',
  date: '日期',
  plannedDate: '计划日期',
  note: '备注',
  tags: '标签',
  fromAccountId: '转出账户',
  fromAccountName: '转出账户',
  toAccountId: '转入账户',
  toAccountName: '转入账户',
  templateId: '预算模板',
  allocations: '预算分配',
  occurrenceId: '周期账单',
  selectedCount: '所选笔数',
  source: '来源',
  isRefund: '退款',
};

function rows(card: AssistantConfirmationCard): readonly PlatformImportRow[] {
  const value = card.preview['rows'];
  return Array.isArray(value) ? (value as unknown as readonly PlatformImportRow[]) : [];
}

function candidates(card: AssistantConfirmationCard): readonly PlatformImportRow[] {
  return rows(card).filter((row) => !row.ignored && !row.alreadyExists && row.amountCents > 0);
}

function seedSelections(items: readonly AssistantMessage[]): void {
  const next = { ...selectedRows.value };
  for (const message of items) {
    const card = message.content.card;
    if (card?.toolName === 'platform-import.prepare' && next[card.actionId] === undefined) {
      next[card.actionId] = candidates(card).filter((row) => !row.possibleDuplicate).map((row) => row.id);
    }
  }
  selectedRows.value = next;
}

function selection(card: AssistantConfirmationCard): string[] {
  return selectedRows.value[card.actionId] ?? [];
}

function toggleRow(card: AssistantConfirmationCard, rowId: string): void {
  const next = new Set(selection(card));
  if (next.has(rowId)) next.delete(rowId);
  else next.add(rowId);
  selectedRows.value = { ...selectedRows.value, [card.actionId]: [...next] };
}

function setCategory(
  card: AssistantConfirmationCard,
  change: { row: PlatformImportRow; categoryName: string },
): void {
  const { row, categoryName: value } = change;
  const action = { ...(categoryOverrides.value[card.actionId] ?? {}) };
  if (value === row.categoryName || value === '') delete action[row.id];
  else action[row.id] = value;
  categoryOverrides.value = { ...categoryOverrides.value, [card.actionId]: action };
}

function fieldLabel(key: string): string {
  return VALUE_LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/Id$/, ' 编号');
}

function dateLabel(value: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return formatDayLabel(value);
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (match !== null) {
      return formatDayLabel(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime());
    }
  }
  return String(value);
}

function valueLabel(key: string, value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '无';
  if (key === 'categoryId' && typeof value === 'string') return meta.categoryName(value);
  if (key === 'accountId' && typeof value === 'string') return meta.accountName(value);
  if (key.toLowerCase().endsWith('date') && (typeof value === 'number' || typeof value === 'string')) return dateLabel(value);
  if (key.toLowerCase().endsWith('cents') && typeof value === 'number') return formatYuan(value);
  if (key === 'type') {
    if (value === 1 || value === 'income') return '收入';
    if (value === 0 || value === 'expense') return '支出';
  }
  if (key === 'source' && value === 'auto') return '自动识别';
  if (key === 'source' && value === 'wechat') return '微信账单';
  if (key === 'source' && value === 'alipay') return '支付宝账单';
  if (key === 'isRefund' && typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value.trim() === '' ? '未填写' : value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '无';
    return value.map((item) => valueLabel(key === 'tags' ? 'tag' : key, item, depth + 1)).join('、');
  }
  if (typeof value === 'object') {
    if (depth >= 2) return `包含 ${Object.keys(value).length} 项`;
    return Object.entries(value)
      .map(([childKey, childValue]) => `${fieldLabel(childKey)}：${valueLabel(childKey, childValue, depth + 1)}`)
      .join('；');
  }
  return String(value);
}

function impactText(card: AssistantConfirmationCard): string {
  const unit = card.toolName === 'platform-import.prepare' || card.toolName.startsWith('transaction.')
    ? '笔账单'
    : card.toolName === 'transfer.create'
      ? '笔转账'
      : card.toolName === 'salary.create'
        ? '笔工资记录'
        : card.toolName.includes('category')
          ? '个分类'
          : '项';
  return `本次将影响 ${card.affected.count} ${unit}`;
}

function statusLabel(status: AssistantConfirmationCard['status']): string {
  if (status === 'pending') return '待确认';
  if (status === 'confirmed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '已失效';
}

function conversationTime(updatedAt: number): string {
  const date = new Date(updatedAt);
  return `${formatDayLabel(updatedAt)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function checkFile(file: File): void {
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('目前只支持微信 xlsx 和支付宝 CSV 账单。');
  if (file.size < 1 || file.size > FILE_LIMIT) throw new Error('账单文件大小需在 1 B 到 5 MB 之间。');
}

async function digest(file: File): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error('当前浏览器无法校验文件，请使用安全连接。');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function report(problem: unknown): void {
  error.value = problem instanceof Error ? problem.message : String(problem);
}

async function loadMessages(id: string): Promise<void> {
  messages.value = (await api.assistant.messages(id)).items;
  seedSelections(messages.value);
  conversationId.value = id;
}

async function loadHistory(): Promise<void> {
  conversations.value = (await api.assistant.conversations()).items;
  const first = conversations.value[0];
  if (first !== undefined) await loadMessages(first.id);
  else await createConversation();
}

async function selectConversation(id: string): Promise<void> {
  if (busy.value || id === conversationId.value) return;
  busy.value = true;
  error.value = null;
  try {
    await loadMessages(id);
  } catch (problem) {
    report(problem);
  } finally {
    busy.value = false;
  }
}

async function createConversation(): Promise<void> {
  const created = await api.assistant.createConversation();
  conversations.value = [created, ...conversations.value.filter((item) => item.id !== created.id)];
  conversationId.value = created.id;
  messages.value = [];
  actionFiles.value = {};
  selectedRows.value = {};
  categoryOverrides.value = {};
  text.value = '';
  upload.value = null;
  requestId.value = null;
}

onMounted(async () => {
  try {
    await meta.load();
    await loadHistory();
  } catch (problem) {
    report(problem);
  } finally {
    loading.value = false;
  }
});

watch([text, upload], () => {
  if (!busy.value) requestId.value = null;
});

async function send(): Promise<void> {
  if (!canSend.value || conversationId.value === null) return;
  const file = upload.value;
  const messageText = text.value.trim() || (file === null ? '' : '请预览这份账单，并在我确认后再导入。');
  requestId.value ??= globalThis.crypto?.randomUUID?.() ?? `assistant-${Date.now()}-${Math.random()}`;
  busy.value = true;
  error.value = null;
  try {
    const result = await api.assistant.sendMessage(conversationId.value, {
      text: messageText,
      clientRequestId: requestId.value,
      ...(file === null ? {} : { attachment: { fileName: file.name, source: 'auto', bytes: await file.arrayBuffer() } }),
    });
    messages.value = result.items;
    seedSelections(messages.value);
    if (file !== null) {
      const card = result.items.find((item) => item.content.card?.toolName === 'platform-import.prepare' && item.content.card.status === 'pending')?.content.card;
      if (card !== undefined) actionFiles.value = { ...actionFiles.value, [card.actionId]: file };
    }
    text.value = '';
    upload.value = null;
    if (uploadInput.value !== null) uploadInput.value.value = '';
    requestId.value = null;
    conversations.value = (await api.assistant.conversations()).items;
  } catch (problem) {
    report(problem);
  } finally {
    busy.value = false;
  }
}

function chooseUpload(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  try {
    checkFile(file);
    upload.value = file;
    error.value = null;
  } catch (problem) {
    report(problem);
  }
}

async function reattach(card: AssistantConfirmationCard, event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined || card.attachment === undefined) return;
  try {
    checkFile(file);
    if (file.size !== card.attachment.sizeBytes || await digest(file) !== card.attachment.sha256) throw new Error('文件内容与预览不一致，请选择完全相同的原始账单。');
    actionFiles.value = { ...actionFiles.value, [card.actionId]: file };
    error.value = null;
  } catch (problem) {
    report(problem);
  }
}

async function confirm(card: AssistantConfirmationCard): Promise<void> {
  if (busy.value || card.status !== 'pending') return;
  const file = actionFiles.value[card.actionId];
  busy.value = true;
  error.value = null;
  try {
    let fileBytes: ArrayBuffer | undefined;
    if (card.toolName === 'platform-import.prepare') {
      if (file === undefined || card.attachment === undefined) throw new Error('请重新附加与预览一致的原始账单文件。');
      fileBytes = await file.arrayBuffer();
    }
    await api.assistant.confirmAction(card.actionId, {
      ...(fileBytes === undefined ? {} : { fileBytes }),
      ...(card.toolName !== 'platform-import.prepare' ? {} : { selectedIds: selection(card), categoryOverrides: categoryOverrides.value[card.actionId] ?? {} }),
    });
    if (conversationId.value !== null) await loadMessages(conversationId.value);
    const next = { ...actionFiles.value };
    delete next[card.actionId];
    actionFiles.value = next;
    conversations.value = (await api.assistant.conversations()).items;
  } catch (problem) {
    report(problem);
    if (conversationId.value !== null) {
      try { await loadMessages(conversationId.value); } catch { /* keep the original error */ }
    }
  } finally {
    busy.value = false;
  }
}

async function cancel(card: AssistantConfirmationCard): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.assistant.cancelAction(card.actionId);
    if (conversationId.value !== null) await loadMessages(conversationId.value);
    const next = { ...actionFiles.value };
    delete next[card.actionId];
    actionFiles.value = next;
  } catch (problem) {
    report(problem);
  } finally {
    busy.value = false;
  }
}

async function clearConversation(): Promise<void> {
  const id = conversationId.value;
  if (id === null || busy.value || !window.confirm('归档当前对话？归档后会从历史列表隐藏，已确认的账单不会被撤销。')) return;
  busy.value = true;
  try {
    await api.assistant.archiveConversation(id);
    await loadHistory();
    actionFiles.value = {};
  } catch (problem) {
    report(problem);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="assistant-page" aria-label="AI 助理对话">
    <header class="assistant-heading">
      <div><h2>AI 助理</h2><p>查账和分析由服务端计算；所有写入都会先预览并等待确认。</p></div>
      <button class="theme-button" type="button" :disabled="busy" @click="createConversation">新对话</button>
    </header>
    <details class="theme-card assistant-history">
      <summary><span>历史对话 · {{ conversations.length }} 条</span><span v-if="current" class="assistant-history-current">{{ current.title || '新对话' }}</span></summary>
      <ul v-if="conversations.length" class="assistant-history-list">
        <li v-for="item in conversations" :key="item.id">
          <button class="theme-button" type="button" :aria-pressed="item.id === conversationId" :disabled="busy" @click="selectConversation(item.id)">
            {{ item.title || '新对话' }} · {{ conversationTime(item.updatedAt) }}
          </button>
        </li>
      </ul>
      <p v-else class="hint">还没有对话记录。</p>
    </details>
    <p v-if="error" class="notice notice-danger" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">正在恢复对话…</p>
    <section v-else class="conversation">
      <section v-if="messages.length === 0" class="theme-card">
        <h3>你好，我可以帮你查账和准备操作</h3>
        <p>对话会保存在本账本中，可从历史记录继续查看。账本数据由服务端计算；写入、整理和导入都会先等待你确认。</p>
      </section>
      <article v-for="message in messages" :key="message.id" class="theme-card assistant-message" :class="'message-' + message.role">
        <header><strong>{{ message.role === 'user' ? '你' : message.role === 'tool' ? '账本工具' : 'AI 助理' }}</strong></header>
        <p v-if="message.content.text">{{ message.content.text }}</p>
        <p v-if="message.content.attachment">附件：{{ message.content.attachment.fileName }} · {{ message.content.attachment.sizeBytes }} B</p>
        <p v-if="message.content.error" role="alert">{{ message.content.error.message }}</p>
        <section v-if="message.content.card" class="theme-card notice notice-accent assistant-confirmation">
          <header>
            <h3>{{ message.content.card.operation }}</h3>
            <strong>{{ statusLabel(message.content.card.status) }}</strong>
          </header>
          <p>{{ message.content.card.summary }}</p>
          <p><strong>{{ impactText(message.content.card) }}</strong></p>
          <table class="assistant-value-grid">
            <tbody>
              <tr v-for="[key, value] in Object.entries(message.content.card.values)" :key="key">
                <th scope="row">{{ fieldLabel(key) }}</th>
                <td><strong v-if="key.toLowerCase().endsWith('cents')">{{ valueLabel(key, value) }}</strong><template v-else>{{ valueLabel(key, value) }}</template></td>
              </tr>
            </tbody>
          </table>
          <template v-if="message.content.card.toolName === 'platform-import.prepare'">
            <p v-if="message.content.card.attachment">{{ message.content.card.attachment.fileName }} · {{ message.content.card.attachment.sizeBytes }} B · {{ message.content.card.attachment.source }}</p>
            <label v-if="actionFiles[message.content.card.actionId] === undefined && message.content.card.status === 'pending'">刷新后请重新附加同一文件<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="reattach(message.content.card!, $event)" /></label>
            <p>预览 {{ rows(message.content.card).length }} 行；已选 {{ selection(message.content.card).length }} 行。可能重复项默认未选。</p>
            <PlatformImportRows
              :rows="rows(message.content.card)"
              :categories="categories"
              :selected-ids="selection(message.content.card)"
              :category-overrides="categoryOverrides[message.content.card.actionId] ?? {}"
              :disabled="message.content.card.status !== 'pending' || busy"
              @toggle="toggleRow(message.content.card!, $event)"
              @category-change="setCategory(message.content.card!, $event)"
            />
          </template>
          <div v-if="message.content.card.warnings.length" class="notice notice-warning assistant-warnings">
            <strong>请留意</strong><ul><li v-for="warning in message.content.card.warnings" :key="warning">{{ warning }}</li></ul>
          </div>
          <div v-if="message.content.card.status === 'pending'" class="assistant-card-actions">
            <button class="theme-button" type="button" :disabled="busy || (message.content.card.toolName === 'platform-import.prepare' && (!actionFiles[message.content.card.actionId] || selection(message.content.card).length === 0))" @click="confirm(message.content.card!)">{{ busy ? '处理中…' : message.content.card.toolName === 'platform-import.prepare' ? '确认导入所选行' : '确认写入' }}</button>
            <button class="theme-button assistant-cancel" type="button" :disabled="busy" @click="cancel(message.content.card!)">取消</button>
          </div>
        </section>
        <section v-if="message.content.result" class="theme-card"><p>{{ message.content.result.summary }}</p><details><summary>查看结果详情</summary><pre>{{ JSON.stringify(message.content.result.data, null, 2) }}</pre></details></section>
      </article>
    </section>
    <AiThinkingStatus :active="busy" />
    <form class="theme-card" @submit.prevent="send">
      <label for="assistant-input">发送消息</label>
      <textarea id="assistant-input" v-model="text" rows="3" maxlength="2000" :disabled="busy || conversationId === null" placeholder="例如：这个月花了多少？或帮我记一笔昨天午饭 35 元" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send" />
      <p v-if="upload">{{ upload.name }} · {{ upload.type || '未知类型' }} · {{ upload.size }} B <button class="theme-button" type="button" @click="upload = null">移除附件</button></p>
      <label>添加账单<input ref="uploadInput" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="busy" @change="chooseUpload" /></label>
      <button class="theme-button" type="submit" :disabled="!canSend">{{ busy ? '处理中…' : '发送' }}</button>
      <p>支持微信 xlsx 和支付宝 GBK CSV；附件只在当前页面内存中保留。</p>
    </form>
    <footer><button class="theme-button assistant-cancel" type="button" :disabled="busy || current === null" @click="clearConversation">归档当前对话</button><span>归档后会从历史列表隐藏；不会撤销已确认的账单。</span></footer>
  </section>
</template>

<style>
.assistant-page{display:grid;gap:.6rem;min-width:0;overflow-wrap:anywhere}.assistant-page summary{min-height:44px}.assistant-page :is(input,select,textarea){min-height:44px;min-width:0;max-width:100%;font-size:16px}.assistant-page textarea{width:100%}.assistant-page pre{max-height:14rem;overflow:auto;white-space:pre-wrap}.assistant-confirmation>header{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.assistant-value-grid{width:100%;table-layout:fixed}.assistant-value-grid th{text-align:left;color:var(--muted)}.assistant-cancel{min-width:44px}
</style>
