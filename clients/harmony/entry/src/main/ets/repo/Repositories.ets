// Ledger + meta repositories (H1 data plane). Mirrors Android
// LedgerRepository/MetaRepository: thin JSON pass-through, no aggregation.
// cents stay cents, epoch ms stays epoch ms until display formatting.
//
// ArkTS strict-mode note: every options/body/query object passed to `call`
// is built as a typed `const` of a declared interface first (CallOptions,
// StringMap, or one of the body interfaces below). No anonymous nested
// object literals are passed inline.

import { call, download } from '../net/ApiClient';
import { ApiQuery, CallOptions, RawBody } from '../net/ApiClient';
import util from '@ohos.util';

export interface TemplateBody {
  name: string;
  modules: object[];
  isDefault: boolean;
}

export interface CycleBody {
  cycleStartDay: number | null;
}

export interface EnabledBody {
  enabled: boolean;
}

export interface MoveBody {
  dir: number;
}

export interface RenameTagBody {
  from: string;
  to: string;
}

export interface CreateAccountBody {
  name: string;
  type: number;
  initialBalanceCents: number;
}

export interface MapPair {
  k: string;
  v: string;
}

export interface PlatformBillsBody {
  fileBase64: string;
  source: string;
  dryRun: boolean;
  selectedIds: string[] | null;
  categoryOverrides: MapPair[];
  fileName?: string;
}

export interface MessageAttachment {
  fileName: string;
  source: string;
  fileBase64: string;
}

export interface SendMessageBody {
  text: string;
  clientRequestId: string;
  attachment?: MessageAttachment;
}

export interface AttachmentParam {
  fileName: string;
  source: string;
  bytes: ArrayBuffer;
}

export interface ConfirmActionBody {
  fileBase64?: string;
  selectedIds?: string[];
  categoryOverrides?: MapPair[];
}

export interface RetireBody {
  closedDate: number;
}

export class LedgerRepository {
  listTransactions(query?: ApiQuery): Promise<string> {
    const opts: CallOptions = query ? { query: query } : {};
    return call('/api/v1/transactions', opts);
  }
  getTransaction(id: string): Promise<string> {
    return call(`/api/v1/transactions/${encodeURIComponent(id)}`);
  }
  createTransaction(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/transactions', opts);
  }
  updateTransaction(id: string, input: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: input };
    return call(`/api/v1/transactions/${encodeURIComponent(id)}`, opts);
  }
  removeTransaction(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/transactions/${encodeURIComponent(id)}`, opts);
  }

  // Transfers: own table, neither income nor expense (server guarantees).
  listTransfers(query?: ApiQuery): Promise<string> {
    const opts: CallOptions = query ? { query: query } : {};
    return call('/api/v1/transfers', opts);
  }
  createTransfer(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/transfers', opts);
  }
  updateTransfer(id: string, input: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: input };
    return call(`/api/v1/transfers/${encodeURIComponent(id)}`, opts);
  }
  removeTransfer(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/transfers/${encodeURIComponent(id)}`, opts);
  }

  // Trash: transactions only.
  listTrash(): Promise<string> {
    return call('/api/v1/trash');
  }
  restore(id: string): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call(`/api/v1/trash/${encodeURIComponent(id)}/restore`, opts);
  }
  purge(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/trash/${encodeURIComponent(id)}`, opts);
  }
  restoreAll(): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call('/api/v1/trash/restore-all', opts);
  }
  purgeAll(): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call('/api/v1/trash', opts);
  }
}

export class MetaRepository {
  categories(type?: number): Promise<string> {
    const q: ApiQuery = {};
    if (type !== undefined) {
      q.type = String(type);
    }
    const opts: CallOptions = { query: q };
    return call('/api/v1/categories', opts);
  }
  accounts(): Promise<string> {
    return call('/api/v1/accounts');
  }
  balances(): Promise<string> {
    return call('/api/v1/accounts/balances');
  }
  tags(): Promise<string> {
    return call('/api/v1/tags');
  }
}

export class BudgetRepository {
  overview(periodStart?: number): Promise<string> {
    const q: ApiQuery = {};
    if (periodStart !== undefined) {
      q.periodStart = String(periodStart);
    }
    const opts: CallOptions = { query: q };
    return call('/api/v1/budget/overview', opts);
  }
  periods(): Promise<string> {
    return call('/api/v1/budget/periods');
  }
  salaries(): Promise<string> {
    return call('/api/v1/salaries');
  }
  createSalary(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/salaries', opts);
  }
  removeSalary(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/salaries/${encodeURIComponent(id)}`, opts);
  }
  templates(): Promise<string> {
    return call('/api/v1/templates');
  }
  createTemplate(name: string, modules: object[], isDefault: boolean = false): Promise<string> {
    const b: TemplateBody = { name: name, modules: modules, isDefault: isDefault };
    const opts: CallOptions = { method: 'POST', body: b };
    return call('/api/v1/templates', opts);
  }
  updateTemplate(id: string, changes: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: changes };
    return call(`/api/v1/templates/${encodeURIComponent(id)}`, opts);
  }
  removeTemplate(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/templates/${encodeURIComponent(id)}`, opts);
  }
  setDefaultTemplate(id: string): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call(`/api/v1/templates/${encodeURIComponent(id)}/default`, opts);
  }
  applyTemplateToCurrent(id: string): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call(`/api/v1/templates/${encodeURIComponent(id)}/apply-current`, opts);
  }
  getSettings(): Promise<string> {
    return call('/api/v1/settings');
  }
  setCycleStartDay(day: number | null): Promise<string> {
    const b: CycleBody = { cycleStartDay: day };
    const opts: CallOptions = { method: 'PUT', body: b };
    return call('/api/v1/settings', opts);
  }
}

export class RecurringRepository {
  rules(): Promise<string> {
    return call('/api/v1/recurring/rules');
  }
  createRule(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/recurring/rules', opts);
  }
  updateRule(id: string, changes: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: changes };
    return call(`/api/v1/recurring/rules/${encodeURIComponent(id)}`, opts);
  }
  removeRule(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/recurring/rules/${encodeURIComponent(id)}`, opts);
  }
  setEnabled(id: string, enabled: boolean): Promise<string> {
    const b: EnabledBody = { enabled: enabled };
    const opts: CallOptions = { method: 'POST', body: b };
    return call(`/api/v1/recurring/rules/${encodeURIComponent(id)}/enabled`, opts);
  }
  // Explicit POST, idempotent — never a GET side effect (backend spec).
  generate(): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call('/api/v1/recurring/generate', opts);
  }
  pending(): Promise<string> {
    return call('/api/v1/recurring/pending');
  }
  confirm(id: string): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call(`/api/v1/recurring/occurrences/${encodeURIComponent(id)}/confirm`, opts);
  }
  ignore(id: string): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call(`/api/v1/recurring/occurrences/${encodeURIComponent(id)}/ignore`, opts);
  }
}

export class StatsRepository {
  categoryShare(from: number, to: number): Promise<string> {
    const q: ApiQuery = { from: String(from), to: String(to) };
    const opts: CallOptions = { query: q };
    return call('/api/v1/stats/category-share', opts);
  }
  monthlyTrend(months: number = 6): Promise<string> {
    const q: ApiQuery = { months: String(months) };
    const opts: CallOptions = { query: q };
    return call('/api/v1/stats/monthly-trend', opts);
  }
  poolTrend(): Promise<string> {
    return call('/api/v1/stats/pool-trend');
  }
}

export class AdminRepository {
  categories(type?: number): Promise<string> {
    const q: ApiQuery = { includeDeleted: 'false' };
    if (type !== undefined) {
      q.type = String(type);
    }
    const opts: CallOptions = { query: q };
    return call('/api/v1/categories', opts);
  }
  createCategory(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/categories', opts);
  }
  updateCategory(id: string, changes: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: changes };
    return call(`/api/v1/categories/${encodeURIComponent(id)}`, opts);
  }
  removeCategory(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/categories/${encodeURIComponent(id)}`, opts);
  }
  moveCategory(id: string, dir: number): Promise<string> {
    const b: MoveBody = { dir: dir };
    const opts: CallOptions = { method: 'POST', body: b };
    return call(`/api/v1/categories/${encodeURIComponent(id)}/move`, opts);
  }
  categoryUsage(id: string): Promise<string> {
    return call(`/api/v1/categories/${encodeURIComponent(id)}/usage`);
  }
  accounts(): Promise<string> {
    const q: ApiQuery = { includeDeleted: 'false' };
    const opts: CallOptions = { query: q };
    return call('/api/v1/accounts', opts);
  }
  createAccount(name: string, type: number, initialCents: number = 0): Promise<string> {
    const b: CreateAccountBody = { name: name, type: type, initialBalanceCents: initialCents };
    const opts: CallOptions = { method: 'POST', body: b };
    return call('/api/v1/accounts', opts);
  }
  updateAccount(id: string, changes: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: changes };
    return call(`/api/v1/accounts/${encodeURIComponent(id)}`, opts);
  }
  removeAccount(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/accounts/${encodeURIComponent(id)}`, opts);
  }
  moveAccount(id: string, dir: number): Promise<string> {
    const b: MoveBody = { dir: dir };
    const opts: CallOptions = { method: 'POST', body: b };
    return call(`/api/v1/accounts/${encodeURIComponent(id)}/move`, opts);
  }
  accountUsage(id: string): Promise<string> {
    return call(`/api/v1/accounts/${encodeURIComponent(id)}/usage`);
  }
  renameTag(from: string, to: string): Promise<string> {
    const b: RenameTagBody = { from: from, to: to };
    const opts: CallOptions = { method: 'PATCH', body: b };
    return call('/api/v1/tags', opts);
  }
  removeTag(name: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/tags/${encodeURIComponent(name)}`, opts);
  }
}

export class PortabilityRepository {
  exportUrl(what: string): string {
    return `/api/v1/export/${what}.csv`;
  }
  downloadExport(what: string): Promise<ArrayBuffer> {
    return download(`/api/v1/export/${what}.csv`);
  }
  importTransactionsCsv(csvText: string): Promise<string> {
    const bytes: ArrayBuffer = utf8Bytes(csvText);
    const rb: RawBody = { contentType: 'text/csv', bytes: bytes };
    const opts: CallOptions = { method: 'POST', rawBody: rb };
    return call('/api/v1/import/transactions', opts);
  }
  importTransfersCsv(csvText: string): Promise<string> {
    const bytes: ArrayBuffer = utf8Bytes(csvText);
    const rb: RawBody = { contentType: 'text/csv', bytes: bytes };
    const opts: CallOptions = { method: 'POST', rawBody: rb };
    return call('/api/v1/import/transfers', opts);
  }
  importPlatformBills(
    bytes: ArrayBuffer,
    source: string = 'auto',
    dryRun: boolean = true,
    fileName?: string,
    selectedIds?: string[] | null,
    categoryOverrides?: MapPair[],
  ): Promise<string> {
    const ov: MapPair[] = categoryOverrides === undefined ? [] : categoryOverrides;
    const body: PlatformBillsBody = {
      fileBase64: base64Of(bytes),
      source: source,
      dryRun: dryRun,
      selectedIds: selectedIds === undefined ? null : selectedIds,
      categoryOverrides: ov,
    };
    if (fileName !== undefined) {
      body.fileName = fileName;
    }
    const opts: CallOptions = { method: 'POST', body: body };
    return call('/api/v1/import/platform-bills', opts);
  }
  listBackups(): Promise<string> {
    return call('/api/v1/backups');
  }
  createBackup(): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call('/api/v1/backups', opts);
  }
}

export class AssistantRepository {
  conversations(): Promise<string> {
    return call('/api/v1/assistant/conversations');
  }
  createConversation(): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: {} };
    return call('/api/v1/assistant/conversations', opts);
  }
  messages(conversationId: string): Promise<string> {
    return call(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/messages`);
  }
  sendMessage(
    conversationId: string,
    text: string,
    clientRequestId: string,
    attachment?: AttachmentParam,
  ): Promise<string> {
    const body: SendMessageBody = { text: text, clientRequestId: clientRequestId };
    if (attachment) {
      const att: MessageAttachment = {
        fileName: attachment.fileName,
        source: attachment.source,
        fileBase64: base64Of(attachment.bytes),
      };
      body.attachment = att;
    }
    const opts: CallOptions = { method: 'POST', body: body };
    return call(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/messages`, opts);
  }
  confirmAction(
    actionId: string,
    fileBytes?: ArrayBuffer,
    selectedIds?: string[],
    categoryOverrides?: MapPair[],
  ): Promise<string> {
    const body: ConfirmActionBody = {};
    if (fileBytes) {
      body.fileBase64 = base64Of(fileBytes);
    }
    if (selectedIds) {
      body.selectedIds = selectedIds;
    }
    if (categoryOverrides) {
      body.categoryOverrides = categoryOverrides;
    }
    const opts: CallOptions = { method: 'POST', body: body };
    return call(`/api/v1/assistant/actions/${encodeURIComponent(actionId)}/confirm`, opts);
  }
  cancelAction(actionId: string): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: {} };
    return call(`/api/v1/assistant/actions/${encodeURIComponent(actionId)}/cancel`, opts);
  }
  archiveConversation(conversationId: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`, opts);
  }
  providerConfig(): Promise<string> {
    return call('/api/v1/ai/config');
  }
  saveProviderConfig(input: object): Promise<string> {
    const opts: CallOptions = { method: 'PUT', body: input };
    return call('/api/v1/ai/config', opts);
  }
  testProvider(): Promise<string> {
    const opts: CallOptions = { method: 'POST' };
    return call('/api/v1/ai/test', opts);
  }
}

export class ItemRepository {
  list(query?: ApiQuery): Promise<string> {
    const opts: CallOptions = query ? { query: query } : {};
    return call('/api/v1/items', opts);
  }
  summary(): Promise<string> {
    return call('/api/v1/items/summary');
  }
  get(id: string): Promise<string> {
    return call(`/api/v1/items/${encodeURIComponent(id)}`);
  }
  create(input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call('/api/v1/items', opts);
  }
  update(id: string, changes: object): Promise<string> {
    const opts: CallOptions = { method: 'PATCH', body: changes };
    return call(`/api/v1/items/${encodeURIComponent(id)}`, opts);
  }
  remove(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/items/${encodeURIComponent(id)}`, opts);
  }
  sell(id: string, input: object): Promise<string> {
    const opts: CallOptions = { method: 'POST', body: input };
    return call(`/api/v1/items/${encodeURIComponent(id)}/sell`, opts);
  }
  retire(id: string, closedDate: number): Promise<string> {
    const b: RetireBody = { closedDate: closedDate };
    const opts: CallOptions = { method: 'POST', body: b };
    return call(`/api/v1/items/${encodeURIComponent(id)}/retire`, opts);
  }
  uploadPhoto(id: string, contentType: string, bytes: ArrayBuffer): Promise<string> {
    const rb: RawBody = { contentType: contentType, bytes: bytes };
    const opts: CallOptions = { method: 'PUT', rawBody: rb };
    return call(`/api/v1/items/${encodeURIComponent(id)}/photo`, opts);
  }
  removePhoto(id: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/items/${encodeURIComponent(id)}/photo`, opts);
  }
  createCutoutJob(webpBytes: ArrayBuffer): Promise<string> {
    const rb: RawBody = { contentType: 'image/webp', bytes: webpBytes };
    const opts: CallOptions = { method: 'POST', rawBody: rb };
    return call('/api/v1/items/cutouts', opts);
  }
  getCutoutJob(jobId: string): Promise<string> {
    return call(`/api/v1/items/cutouts/${encodeURIComponent(jobId)}`);
  }
  cancelCutoutJob(jobId: string): Promise<string> {
    const opts: CallOptions = { method: 'DELETE' };
    return call(`/api/v1/items/cutouts/${encodeURIComponent(jobId)}`, opts);
  }
  cutoutCandidateBytes(jobId: string, candidateId: string): Promise<ArrayBuffer> {
    return download(
      `/api/v1/items/cutouts/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateId)}/image`,
    );
  }
}

function base64Of(bytes: ArrayBuffer): string {
  const helper: util.Base64Helper = new util.Base64Helper();
  return helper.encodeToStringSync(new Uint8Array(bytes));
}

function utf8Bytes(text: string): ArrayBuffer {
  const u8: Uint8Array = new util.TextEncoder().encodeInto(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
