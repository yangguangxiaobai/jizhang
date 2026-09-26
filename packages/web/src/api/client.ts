/**
 * Typed API client.
 *
 * Two rules it exists to centralise:
 *   * every mutating request carries `X-Requested-With: fetch`, which the server
 *     requires as a second CSRF layer (the session cookie is `SameSite=Lax`);
 *   * a non-2xx response becomes an `ApiError` carrying the server's
 *     `{error:{code,message}}` contract, so views can show the real reason instead
 *     of "something went wrong".
 *
 * Requests are same-origin (the Fastify server also hosts this bundle), so the
 * session cookie rides along with `credentials: 'same-origin'` and there is no CORS
 * to configure.
 */

import { markRequestFailed, markRequestSucceeded } from '../composables/useNetwork.js';

/** Shared error shape from design.md §5. */
interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the session is missing or expired, so the UI should route to login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Thrown when the browser reports no connectivity, before any request is sent. */
export class OfflineError extends Error {
  constructor(message = '需要联网才能记账。') {
    super(message);
    this.name = 'OfflineError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

/** Query values are serialised with `String()`; `undefined` and `''` are dropped. */
type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  readonly method?: Method;
  readonly body?: unknown;
  readonly query?: Record<string, QueryValue>;
  /**
   * Sends the body verbatim with its own content type, instead of JSON.
   *
   * The CSV import needs this: the body is a file's text, and wrapping it in
   * `JSON.stringify` would change its bytes. Mutating rules still apply (offline check,
   * CSRF header), because this is still a write.
   */
  readonly rawBody?: {
    readonly contentType: string;
    readonly body: string | ArrayBuffer | Blob;
  };
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method: Method = options.method ?? 'GET';
  const mutating = method !== 'GET';

  // Fail fast and clearly instead of letting the request hang and time out: the
  // offline story for this app is "read yes, write no" (parent task D4).
  if (mutating && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineError();
  }

  const headers: Record<string, string> = {};
  if (mutating) {
    headers['X-Requested-With'] = 'fetch';
  }
  if (options.rawBody !== undefined) {
    headers['Content-Type'] = options.rawBody.contentType;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Exactly one of the two body shapes is sent; `rawBody` wins because it is the more
  // specific instruction.
  const payload: BodyInit | undefined =
    options.rawBody !== undefined
      ? options.rawBody.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: payload }),
    });
  } catch (error) {
    // A fetch rejection here is a network failure, not an HTTP error.
    markRequestFailed();
    throw new OfflineError(
      `无法连接服务器：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Reaching the server at all clears the offline banner, even if the status is an
  // error: the problem is the request, not the connection.
  markRequestSucceeded();

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? `HTTP ${response.status} ${response.statusText}`,
    );
  }

  return parsed as T;
}

function base64Bytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Domain shapes (mirror the server's DTOs)
// ---------------------------------------------------------------------------

export const TYPE_EXPENSE = 0;
export const TYPE_INCOME = 1;

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly parentId: string | null;
  readonly icon: string;
  readonly color: number;
  readonly sortOrder: number;
  readonly isBuiltin: boolean;
  readonly updatedAt: number;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  readonly sortOrder: number;
  readonly isBuiltin: boolean;
  readonly updatedAt: number;
}

export interface Transaction {
  readonly id: string;
  readonly type: number;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId: string;
  readonly date: number;
  readonly note: string;
  readonly tags: string[];
  readonly isRefund: boolean;
  readonly refundLinkedTxIds?: string[];
  readonly refundSummary?: RefundSummary;
  readonly refundDetails?: RefundDetail[];
  readonly updatedAt: number;
}
/** How much has been refunded against an original expense (reverse-view). */
export interface RefundSummary {
  readonly totalRefundCents: number;
  readonly refundCount: number;
}
/** One linked refund row for an original expense (forward-view detail). */
export interface RefundDetail {
  readonly id: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly updatedAt: number;
}

export type TransactionListQuery = Record<string, QueryValue>;

export interface TransactionListResult {
  readonly items: Transaction[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface TagCount {
  readonly name: string;
  readonly count: number;
}

/** The recycle bin. Every row here is soft-deleted; the endpoint returns nothing else. */
export interface TrashListResult {
  readonly items: Transaction[];
  readonly total: number;
}

export interface TrashBulkResult {
  readonly restored?: number;
  readonly purged?: number;
  readonly remaining: number;
}

export type ItemStatus = 'active' | 'idle' | 'sold' | 'retired';
export type ItemPhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly brand: string;
  readonly model: string;
  readonly note: string;
  readonly purchasePriceCents: number | null;
  readonly purchaseDate: number;
  readonly status: ItemStatus;
  readonly closedDate: number | null;
  readonly salePriceCents: number | null;
  readonly purchaseTransactionId: string | null;
  readonly saleTransactionId: string | null;
  readonly photoUrl: string | null;
  readonly heldDays: number;
  readonly netCostCents: number | null;
  readonly dailyCostCents: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ItemListQuery = Record<string, QueryValue>;

export interface ItemListResult {
  readonly items: Item[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ItemSummary {
  readonly totalItems: number;
  readonly activeItems: number;
  readonly idleItems: number;
  readonly soldItems: number;
  readonly retiredItems: number;
  readonly cumulativePurchaseCents: number;
  readonly currentDailyCostCents: number;
}

export interface ItemInput {
  readonly name: string;
  readonly category?: string;
  readonly brand?: string;
  readonly model?: string;
  readonly note?: string;
  readonly purchasePriceCents?: number | null;
  readonly purchaseDate: number;
  readonly purchaseTransactionId?: string | null;
  readonly status?: 'active' | 'idle';
}

export type ItemUpdateInput = Omit<Partial<ItemInput>, 'status'> & {
  readonly status?: ItemStatus;
};

export interface ItemSaleInput {
  readonly closedDate: number;
  readonly salePriceCents?: number | null;
  readonly saleTransactionId?: string | null;
}

export interface ItemRetireInput {
  readonly closedDate: number;
}

/** How often a recurring bill repeats. Mirrors `@jizhang/shared`'s union. */
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId: string;
  readonly frequency: RecurringFrequency;
  readonly anchorDate: number;
  readonly nextDueDate: number;
  /** True when earlier due dates exist that were not generated (the per-run cap). */
  readonly hasOlderDue: boolean;
  readonly enabled: boolean;
  readonly updatedAt: number;
}

export interface RecurringRuleInput {
  readonly name?: string;
  readonly type?: number;
  readonly amountCents?: number;
  readonly categoryId?: string;
  readonly accountId?: string;
  readonly frequency?: RecurringFrequency;
  readonly anchorDate?: number;
  readonly enabled?: boolean;
}

export type OccurrenceStatus = 'pending' | 'confirmed' | 'ignored';

export interface RecurringOccurrence {
  readonly id: string;
  readonly ruleId: string;
  readonly plannedDate: number;
  readonly status: OccurrenceStatus;
  readonly transactionId: string | null;
  readonly type: number;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId: string;
  readonly note: string;
  readonly updatedAt: number;
}

export interface GenerateResult {
  readonly created: number;
  readonly truncated: number;
  readonly pending: number;
}

/** `created: false` means the occurrence was already confirmed; no second bill exists. */
export interface ConfirmResult {
  readonly transaction: Transaction;
  readonly created: boolean;
}

export interface BackupFile {
  /** File name only; the host path is deliberately not exposed. */
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly createdAtMs: number;
}

export interface ImportResult {
  readonly inserted: number;
  readonly skipped: number;
  readonly total: number;
}

/** One preview row from the platform bill import dry-run. */
export interface PlatformImportRow {
  readonly id: string;
  readonly dateLabel: string;
  readonly type: number;
  readonly amountCents: number;
  readonly note: string;
  readonly counterparty: string;
  readonly sourceCategory: string;
  readonly categoryName: string;
  readonly accountName: string;
  readonly ignored: boolean;
  readonly ignoreReason: string | null;
  readonly alreadyExists: boolean;
  /** Soft match: similar bill already on the platform account (default unchecked). */
  readonly possibleDuplicate: boolean;
  readonly duplicateOfNote: string | null;
}

/** WeChat / Alipay platform bill import response. */
export interface PlatformImportResult {
  readonly source: 'wechat' | 'alipay';
  readonly dryRun: boolean;
  readonly inserted: number;
  readonly skipped: number;
  readonly ignored: number;
  readonly total: number;
  readonly importable: number;
  /** Rows that will be / were written after selection + overrides. */
  readonly selected: number;
  readonly accountsCreated: number;
  readonly categoriesCreated: number;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly expenseCents: number;
  readonly incomeCents: number;
  readonly encoding: string;
  readonly warnings: readonly string[];
  readonly rows: readonly PlatformImportRow[];
}

export interface PlatformImportRequest {
  readonly bytes: ArrayBuffer | Uint8Array;
  readonly source?: 'auto' | 'wechat' | 'alipay';
  readonly dryRun?: boolean;
  readonly fileName?: string;
  /** Omitted → all importable; `[]` → none. */
  readonly selectedIds?: readonly string[] | null;
  /** Row id → category name override. */
  readonly categoryOverrides?: Readonly<Record<string, string>>;
}

export interface MeResponse {
  readonly username: string;
  readonly expiresAt: number;
}

export interface TransactionInput {
  readonly type?: number;
  readonly amountCents?: number;
  readonly categoryId?: string;
  readonly accountId?: string;
  readonly date?: number;
  readonly note?: string;
  readonly tags?: string[];
  readonly isRefund?: boolean;
  readonly refundLinkedTxIds?: string[];
}

/** Budget cycle configuration mirroring the shared engine's `CycleConfig`. */
export type CycleConfig =
  { readonly kind: 'natural-month' } | { readonly kind: 'start-day'; readonly day: number };

export interface BudgetModuleChild {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly spentCents: number;
}

export interface BudgetModuleView {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly budgetCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly children?: BudgetModuleChild[];
}

export interface BudgetOverview {
  readonly cycle: CycleConfig;
  readonly modules: BudgetModuleView[];
  readonly carryoverPoolCents: number;
  readonly totalBudgetCents: number;
  readonly totalSpentCents: number;
  readonly hasBudget: boolean;
}

/**
 * Which cycles can be reviewed, ascending.
 *
 * A separate request from the overview because the overview must answer identically when
 * no period is asked for — every existing caller depends on that.
 */
export interface BudgetPeriods {
  /** Cycle starts, ascending. Empty when nothing has been budgeted yet. */
  readonly periods: number[];
  /** The newest cycle, or `null` when there is none. */
  readonly currentPeriodStart: number | null;
  readonly cycle: CycleConfig;
}

export interface AllocationItem {
  readonly categoryId: string;
  readonly amountCents: number;
}

export interface SalaryRecord {
  readonly id: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  /** The account that received the money. Always present — the server requires it. */
  readonly accountId: string;
  readonly updatedAt: number;
}

export interface SalaryDetail extends SalaryRecord {
  readonly allocationId: string | null;
  readonly allocations: AllocationItem[];
}

export interface TemplateModule {
  readonly categoryId: string;
  readonly ratio: number;
}

export interface BudgetTemplate {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly modules: TemplateModule[];
  readonly updatedAt: number;
}

export interface ApplyTemplateResult {
  readonly templateId: string;
  readonly templateName: string;
  readonly salaryCount: number;
  readonly totalAmountCents: number;
}

export interface SettingsResponse {
  readonly cycleStartDay: number | null;
  readonly minCycleStartDay: number;
  readonly maxCycleStartDay: number;
  readonly key: string;
}

export type AiProviderMode = 'chat-completions' | 'responses' | 'custom';
export type AiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';
export type AiAuthKind = 'none' | 'bearer' | 'header';

export interface AiProviderConfigSummary {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly encryptionKeyConfigured: boolean;
  readonly hasSecret: boolean;
  readonly mode: AiProviderMode;
  readonly name: string;
  readonly url: string;
  readonly method: AiHttpMethod;
  readonly model: string;
  readonly timeoutMs: number;
  readonly headers: Record<string, string>;
  readonly auth: { readonly kind: AiAuthKind; readonly headerName?: string };
  readonly bodyTemplate: string | null;
  readonly responsePath: string;
  readonly updatedAt: number | null;
}

export interface AiProviderConfigInput {
  readonly enabled: boolean;
  readonly mode: AiProviderMode;
  readonly name: string;
  readonly url: string;
  readonly method: AiHttpMethod;
  readonly model: string;
  readonly timeoutMs: number;
  readonly headers: Record<string, string>;
  readonly auth: { readonly kind: AiAuthKind; readonly headerName?: string };
  readonly bodyTemplate: string | null;
  readonly responsePath: string;
  readonly secret?: string;
  readonly clearSecret?: boolean;
}

export interface AiTransactionDraft {
  readonly type: number | null;
  readonly amountCents: number | null;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly date: number | null;
  readonly note: string;
  readonly tags: string[];
  readonly confidence: number | null;
  readonly reason: string | null;
  readonly missing: Array<'amount' | 'type' | 'category' | 'account' | 'date'>;
}

export interface AiMonthlyPeriod {
  readonly month: string;
  readonly monthStart: number;
  readonly from: number;
  readonly to: number;
}

export interface AiMonthlyCategoryFact {
  readonly evidenceId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly amountCents: number;
  readonly ratio: number;
}

export interface AiMonthlyTrendFact {
  readonly evidenceId: string;
  readonly month: string;
  readonly monthStart: number;
  readonly incomeCents: number;
  readonly netExpenseCents: number;
}

export interface AiMonthlyBudgetChildFact {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly spentCents: number;
}

export interface AiMonthlyBudgetModuleFact {
  readonly evidenceId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly budgetCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly children?: readonly AiMonthlyBudgetChildFact[];
}

export interface AiMonthlyBudgetFact {
  readonly periodStart: number | null;
  readonly cycle: CycleConfig;
  readonly totalBudgetCents: number;
  readonly totalSpentCents: number;
  readonly carryoverPoolCents: number;
  readonly modules: readonly AiMonthlyBudgetModuleFact[];
}

export interface AiMonthlyFacts {
  readonly monthly: {
    readonly incomeCents: number;
    readonly netExpenseCents: number;
    readonly incomeEvidenceId: string;
    readonly expenseEvidenceId: string;
  };
  readonly categories: readonly AiMonthlyCategoryFact[];
  readonly trend: readonly AiMonthlyTrendFact[];
  readonly budget: AiMonthlyBudgetFact | null;
}

export interface AiEvaluationStatement {
  readonly text: string;
  readonly evidenceIds: readonly string[];
}

export interface AiMonthlyEvaluation {
  readonly summary: AiEvaluationStatement;
  readonly highlights: readonly AiEvaluationStatement[];
  readonly risks: readonly AiEvaluationStatement[];
  readonly suggestions: readonly AiEvaluationStatement[];
}

export interface AiMonthlyEvaluationResult {
  readonly period: AiMonthlyPeriod;
  readonly facts: AiMonthlyFacts;
  readonly evaluation: AiMonthlyEvaluation;
}

export type AiOrganizationActionKind = 'tag-merge' | 'category-merge';
export type AiOrganizationActionStatus = 'ready' | 'blocked';

export interface AiOrganizationAffectedCounts {
  readonly transactions: number;
  readonly budgetAllocations: number;
  readonly templates: number;
  readonly recurringRules: number;
  readonly pendingOccurrences: number;
}

export interface AiOrganizationAction {
  readonly actionId: string;
  readonly kind: AiOrganizationActionKind;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly status: AiOrganizationActionStatus;
  readonly blockers: readonly string[];
  readonly affected: AiOrganizationAffectedCounts;
  readonly sampleRowIds: readonly string[];
  readonly reason: string;
  readonly confidence: number;
}

export interface AiOrganizationPreview {
  readonly previewHash: string;
  readonly generatedAt: number;
  readonly actions: readonly AiOrganizationAction[];
  readonly scope: {
    readonly sampledTransactions: number;
    readonly totalTransactions: number;
    readonly truncated: boolean;
  };
  readonly semanticAvailable: boolean;
  readonly recommendations: readonly AiOrganizationRecommendation[];
}

export type AiOrganizationRecommendationKind =
  | 'transaction-reclassify'
  | 'category-suggestion';

export interface AiOrganizationRecommendation {
  readonly recommendationId: string;
  readonly kind: AiOrganizationRecommendationKind;
  readonly transactionId: string | null;
  readonly notePreview: string | null;
  readonly sourceCategoryId: string | null;
  readonly sourceCategoryName: string | null;
  readonly targetCategoryId: string | null;
  readonly targetCategoryName: string | null;
  readonly proposedCategoryName: string | null;
  readonly proposedCategoryType: number | null;
  readonly proposedParentCategoryId: string | null;
  readonly evidenceTransactionIds: readonly string[];
  readonly reason: string;
  readonly confidence: number;
}

export interface AiOrganizationOperationAction {
  readonly actionId: string;
  readonly kind: AiOrganizationActionKind;
  readonly sourceId: string;
  readonly targetId: string;
  readonly affectedRows: number;
}

export interface AiOrganizationOperationResult {
  readonly operationId: string;
  readonly status: 'applied' | 'undone';
  readonly actions: readonly AiOrganizationOperationAction[];
}

export interface SalaryInput {
  readonly amountCents: number;
  readonly date: number;
  readonly note?: string;
  /** Required by the server: a salary has to land in an account. */
  readonly accountId: string;
  readonly templateId?: string;
  readonly allocations?: AllocationItem[];
}

/**
 * One account's balance, as computed by the server.
 *
 * Every field is a server figure — the client formats them and never adds them up. In
 * particular `balanceCents` is NOT `initialBalanceCents - expenseCents + …` computed here:
 * that would be a second implementation of the refund rule.
 */
export interface AccountBalance {
  readonly accountId: string;
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  /** Income transactions in. Refunds are included — they are income. */
  readonly incomeCents: number;
  /** Gross expense out; refunds no longer subtract from it. */
  readonly expenseCents: number;
  /** Salaries received into this account. */
  readonly salaryCents: number;
  /** Transfers received into this account. */
  readonly transferInCents: number;
  /** Transfers sent out of this account. */
  readonly transferOutCents: number;
  readonly balanceCents: number;
}

/**
 * A movement of money between two of the user's own accounts.
 *
 * Neither income nor expense: it changes two balances and nothing else. The amount is always
 * positive and the direction is the `from`/`to` pair.
 */
export interface Transfer {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly updatedAt: number;
}

export interface TransferInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note?: string;
}

export interface TransferListResult {
  readonly items: Transfer[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AccountBalancesResult {
  readonly items: AccountBalance[];
  /** The net: what you have minus what you owe. May be negative. */
  readonly totalBalanceCents: number;
  /** Money on hand: the sum of the positive balances. */
  readonly totalAssetsCents: number;
  /** Money owed, as a positive magnitude — so a screen never renders "欠款 −¥1,234". */
  readonly totalLiabilitiesCents: number;
}

export interface CategoryShareItem {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly color: number;
  /** Gross expense in cents (refunds are income and never appear here). */
  readonly amountCents: number;
  readonly ratio: number;
}

export interface CategoryShareResult {
  readonly items: CategoryShareItem[];
  readonly totalCents: number;
  readonly from: number;
  readonly to: number;
}

export interface MonthlyTrendPoint {
  readonly month: string;
  readonly monthStart: number;
  readonly incomeCents: number;
  readonly netExpenseCents: number;
}

export interface PoolTrendResult {
  readonly points: { periodStart: number; poolCents: number }[];
  readonly currentCents: number;
  readonly cycle: CycleConfig;
}

export type AssistantRole = 'user' | 'assistant' | 'tool';
export type AssistantMessageKind =
  | 'text'
  | 'progress'
  | 'tool-card'
  | 'result'
  | 'error'
  | 'attachment';
export type AssistantActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';
export type AssistantToolName =
  | 'transactions.recent'
  | 'accounts.balances'
  | 'budget.overview'
  | 'stats.monthly'
  | 'recurring.pending'
  | 'monthly.evaluate'
  | 'organization.preview'
  | 'backups.list'
  | 'backup.export-links'
  | 'transaction.create'
  | 'transaction.update'
  | 'transaction.delete'
  | 'transaction.restore'
  | 'transfer.create'
  | 'salary.create'
  | 'category.create'
  | 'category.update'
  | 'category.delete'
  | 'account.create'
  | 'account.update'
  | 'account.delete'
  | 'budget.template.apply'
  | 'backup.create'
  | 'platform-import.prepare'
  | 'organization.apply'
  | 'organization.undo'
  | 'recurring.confirm'
  | 'recurring.ignore'
  | 'tag.rename'
  | 'tag.delete';

export type AssistantJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly AssistantJsonValue[]
  | AssistantJsonObject;
export interface AssistantJsonObject {
  readonly [key: string]: AssistantJsonValue;
}

export interface AssistantAttachmentMetadata {
  readonly source: 'auto' | 'wechat' | 'alipay';
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface AssistantConfirmationCard {
  readonly version: 1;
  readonly actionId: string;
  readonly toolName: AssistantToolName;
  readonly operation: string;
  readonly summary: string;
  readonly writes: true;
  readonly affected: { readonly count: number; readonly ids?: readonly string[] };
  readonly values: AssistantJsonObject;
  readonly warnings: readonly string[];
  readonly fingerprint: string;
  readonly status: AssistantActionStatus;
  readonly preview: AssistantJsonObject;
  readonly attachment?: AssistantAttachmentMetadata;
}

export interface AssistantResultCard {
  readonly version: 1;
  readonly toolName: AssistantToolName;
  readonly summary: string;
  readonly data: AssistantJsonObject;
}

export interface AssistantMessageContent {
  readonly version: 1;
  readonly text?: string;
  readonly attachment?: AssistantAttachmentMetadata;
  readonly progress?: { readonly state: 'running' | 'complete'; readonly toolName?: AssistantToolName };
  readonly card?: AssistantConfirmationCard;
  readonly result?: AssistantResultCard;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface AssistantConversation {
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AssistantMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: AssistantRole;
  readonly kind: AssistantMessageKind;
  readonly content: AssistantMessageContent;
  readonly createdAt: number;
}

export interface AssistantPendingAction {
  readonly id: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly toolName: AssistantToolName;
  readonly arguments: AssistantJsonObject;
  readonly preview: AssistantJsonObject;
  readonly fingerprint: string;
  readonly attachment: AssistantAttachmentMetadata | null;
  readonly status: AssistantActionStatus;
  readonly result: AssistantJsonObject | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AssistantMessageInput {
  readonly text: string;
  readonly clientRequestId: string;
  readonly attachment?: {
    readonly fileName: string;
    readonly source?: 'auto' | 'wechat' | 'alipay';
    readonly bytes: ArrayBuffer | Uint8Array;
  };
}

export interface AssistantConfirmInput {
  readonly fileBytes?: ArrayBuffer | Uint8Array;
  readonly selectedIds?: readonly string[] | null;
  readonly categoryOverrides?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    me: () => request<MeResponse>('/api/v1/auth/me'),
    login: (username: string, password: string) =>
      request<MeResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: { username, password },
      }),
    logout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>('/api/v1/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      }),
  },
  transactions: {
    list: (query: TransactionListQuery = {}) =>
      request<TransactionListResult>('/api/v1/transactions', { query }),
    get: (id: string) => request<Transaction>(`/api/v1/transactions/${id}`),
    create: (input: TransactionInput) =>
      request<Transaction>('/api/v1/transactions', { method: 'POST', body: input }),
    update: (id: string, input: TransactionInput) =>
      request<Transaction>(`/api/v1/transactions/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    remove: (id: string) => request<void>(`/api/v1/transactions/${id}`, { method: 'DELETE' }),
  },
  items: {
    list: (query: ItemListQuery = {}) => request<ItemListResult>('/api/v1/items', { query }),
    summary: () => request<ItemSummary>('/api/v1/items/summary'),
    get: (id: string) => request<Item>('/api/v1/items/' + encodeURIComponent(id)),
    create: (input: ItemInput) =>
      request<Item>('/api/v1/items', { method: 'POST', body: input }),
    update: (id: string, changes: ItemUpdateInput) =>
      request<Item>('/api/v1/items/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: changes,
      }),
    remove: (id: string) =>
      request<void>('/api/v1/items/' + encodeURIComponent(id), { method: 'DELETE' }),
    sell: (id: string, input: ItemSaleInput) =>
      request<Item>('/api/v1/items/' + encodeURIComponent(id) + '/sell', {
        method: 'POST',
        body: input,
      }),
    retire: (id: string, input: ItemRetireInput) =>
      request<Item>('/api/v1/items/' + encodeURIComponent(id) + '/retire', {
        method: 'POST',
        body: input,
      }),
    photoUrl: (id: string) => '/api/v1/items/' + encodeURIComponent(id) + '/photo',
    uploadPhoto: (id: string, contentType: ItemPhotoMime, body: Blob) =>
      request<void>('/api/v1/items/' + encodeURIComponent(id) + '/photo', {
        method: 'PUT',
        rawBody: { contentType, body },
      }),
    removePhoto: (id: string) =>
      request<void>('/api/v1/items/' + encodeURIComponent(id) + '/photo', { method: 'DELETE' }),
  },
  tags: {
    list: () => request<{ items: TagCount[] }>('/api/v1/tags'),
  },
  /**
   * The recycle bin.
   *
   * Separate from `transactions` on purpose: that list mixes deleted and live rows when
   * `includeDeleted` is set, and does not say which is which. Here the contract is that
   * every returned row is deleted, so the view never has to filter for correctness.
   */
  trash: {
    list: () => request<TrashListResult>('/api/v1/trash'),
    restore: (id: string) =>
      request<Transaction>(`/api/v1/trash/${id}/restore`, { method: 'POST' }),
    purge: (id: string) => request<void>(`/api/v1/trash/${id}`, { method: 'DELETE' }),
    restoreAll: () => request<TrashBulkResult>('/api/v1/trash/restore-all', { method: 'POST' }),
    purgeAll: () => request<TrashBulkResult>('/api/v1/trash', { method: 'DELETE' }),
  },
  categories: {
    list: (type?: number, includeDeleted = false) =>
      request<{ items: Category[] }>('/api/v1/categories', {
        query: { type, includeDeleted },
      }),
    create: (input: {
      name: string;
      type: number;
      parentId?: string | null;
      icon?: string;
      color?: number;
    }) => request<Category>('/api/v1/categories', { method: 'POST', body: input }),
    update: (
      id: string,
      changes: {
        name?: string;
        icon?: string;
        color?: number;
        parentId?: string | null;
        sortOrder?: number;
      },
    ) => request<Category>(`/api/v1/categories/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) => request<void>(`/api/v1/categories/${id}`, { method: 'DELETE' }),
    move: (id: string, dir: -1 | 1) =>
      request<{ items: Category[] }>(`/api/v1/categories/${id}/move`, {
        method: 'POST',
        body: { dir },
      }),
    usage: (id: string) => request<{ transactions: number }>(`/api/v1/categories/${id}/usage`),
  },
  accounts: {
    list: (includeDeleted = false) =>
      request<{ items: Account[] }>('/api/v1/accounts', {
        query: { includeDeleted },
      }),
    /**
     * Balances are a separate call from the account list on purpose: the list is master
     * data (cached for the session) while a balance changes with every bill.
     */
    balances: () => request<AccountBalancesResult>('/api/v1/accounts/balances'),
    create: (input: { name: string; type: number; initialBalanceCents?: number }) =>
      request<Account>('/api/v1/accounts', { method: 'POST', body: input }),
    update: (
      id: string,
      changes: {
        name?: string;
        type?: number;
        initialBalanceCents?: number;
        sortOrder?: number;
      },
    ) => request<Account>(`/api/v1/accounts/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) => request<void>(`/api/v1/accounts/${id}`, { method: 'DELETE' }),
    move: (id: string, dir: -1 | 1) =>
      request<{ items: Account[] }>(`/api/v1/accounts/${id}/move`, {
        method: 'POST',
        body: { dir },
      }),
    usage: (id: string) => request<{ transactions: number }>(`/api/v1/accounts/${id}/usage`),
  },
  tagsAdmin: {
    rename: (from: string, to: string) =>
      request<{ updated: number; items: TagCount[] }>('/api/v1/tags', {
        method: 'PATCH',
        body: { from, to },
      }),
    remove: (name: string) =>
      request<{ updated: number; items: TagCount[] }>(`/api/v1/tags/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
  },
  transfers: {
    list: (query: TransactionListQuery = {}) =>
      request<TransferListResult>('/api/v1/transfers', { query }),
    get: (id: string) => request<Transfer>(`/api/v1/transfers/${id}`),
    create: (input: TransferInput) =>
      request<Transfer>('/api/v1/transfers', { method: 'POST', body: input }),
    update: (id: string, changes: Partial<TransferInput>) =>
      request<Transfer>(`/api/v1/transfers/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) => request<void>(`/api/v1/transfers/${id}`, { method: 'DELETE' }),
  },
  stats: {
    categoryShare: (from: number, to: number) =>
      request<CategoryShareResult>('/api/v1/stats/category-share', {
        query: { from, to },
      }),
    monthlyTrend: (months = 6) =>
      request<{ items: MonthlyTrendPoint[] }>('/api/v1/stats/monthly-trend', {
        query: { months },
      }),
    poolTrend: () => request<PoolTrendResult>('/api/v1/stats/pool-trend'),
  },

  budget: {
    /** `periodStart` omitted = the current cycle, exactly as before this parameter existed. */
    overview: (periodStart?: number) =>
      request<BudgetOverview>(
        '/api/v1/budget/overview',
        periodStart === undefined ? {} : { query: { periodStart } },
      ),
    periods: () => request<BudgetPeriods>('/api/v1/budget/periods'),
  },

  salaries: {
    list: () => request<{ items: SalaryRecord[] }>('/api/v1/salaries'),
    get: (id: string) => request<SalaryDetail>(`/api/v1/salaries/${id}`),
    create: (input: SalaryInput) =>
      request<SalaryDetail>('/api/v1/salaries', { method: 'POST', body: input }),
    remove: (id: string) => request<void>(`/api/v1/salaries/${id}`, { method: 'DELETE' }),
  },

  templates: {
    list: () => request<{ items: BudgetTemplate[] }>('/api/v1/templates'),
    create: (name: string, modules: TemplateModule[], isDefault = false) =>
      request<BudgetTemplate>('/api/v1/templates', {
        method: 'POST',
        body: { name, modules, isDefault },
      }),
    update: (id: string, changes: { name?: string; modules?: TemplateModule[] }) =>
      request<BudgetTemplate>(`/api/v1/templates/${id}`, {
        method: 'PATCH',
        body: changes,
      }),
    remove: (id: string) => request<void>(`/api/v1/templates/${id}`, { method: 'DELETE' }),
    setDefault: (id: string) =>
      request<BudgetTemplate>(`/api/v1/templates/${id}/default`, { method: 'POST' }),
    applyToCurrent: (id: string) =>
      request<ApplyTemplateResult>(`/api/v1/templates/${id}/apply-current`, {
        method: 'POST',
      }),
  },

  settings: {
    get: () => request<SettingsResponse>('/api/v1/settings'),
    setCycleStartDay: (cycleStartDay: number | null) =>
      request<{ cycleStartDay: number | null }>('/api/v1/settings', {
        method: 'PUT',
        body: { cycleStartDay },
      }),
  },

  assistant: {
    conversations: () => request<{ items: AssistantConversation[] }>('/api/v1/assistant/conversations'),
    createConversation: () =>
      request<AssistantConversation>('/api/v1/assistant/conversations', { method: 'POST', body: {} }),
    messages: (conversationId: string) =>
      request<{ items: AssistantMessage[] }>(
        `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
      ),
    sendMessage: (conversationId: string, input: AssistantMessageInput) =>
      request<{ items: AssistantMessage[] }>(
        `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          body: {
            text: input.text,
            clientRequestId: input.clientRequestId,
            ...(input.attachment === undefined
              ? {}
              : {
                  attachment: {
                    fileName: input.attachment.fileName,
                    source: input.attachment.source,
                    fileBase64: base64Bytes(input.attachment.bytes),
                  },
                }),
          },
        },
      ),
    confirmAction: (actionId: string, input: AssistantConfirmInput = {}) =>
      request<{ action: AssistantPendingAction; message: AssistantMessage }>(
        `/api/v1/assistant/actions/${encodeURIComponent(actionId)}/confirm`,
        {
          method: 'POST',
          body: {
            ...(input.fileBytes === undefined ? {} : { fileBase64: base64Bytes(input.fileBytes) }),
            ...(input.selectedIds === undefined ? {} : { selectedIds: input.selectedIds }),
            ...(input.categoryOverrides === undefined ? {} : { categoryOverrides: input.categoryOverrides }),
          },
        },
      ),
    cancelAction: (actionId: string) =>
      request<{ action: AssistantPendingAction }>(
        `/api/v1/assistant/actions/${encodeURIComponent(actionId)}/cancel`,
        { method: 'POST', body: {} },
      ),
    archiveConversation: (conversationId: string) =>
      request<{ ok: true }>(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      }),
  },

  ai: {
    config: () => request<AiProviderConfigSummary>('/api/v1/ai/config'),
    saveConfig: (input: AiProviderConfigInput) =>
      request<AiProviderConfigSummary>('/api/v1/ai/config', {
        method: 'PUT',
        body: input,
      }),
    test: () => request<{ ok: boolean }>('/api/v1/ai/test', { method: 'POST' }),
  },

  /**
   * Recurring bills.
   *
   * A due date becomes a PENDING occurrence, never a bill. `confirm` is the only call
   * that can put money in the ledger, and it is idempotent — a repeat returns the bill
   * it already created (`created: false`) instead of making a second one.
   */
  recurring: {
    listRules: () => request<{ items: RecurringRule[] }>('/api/v1/recurring/rules'),
    createRule: (input: RecurringRuleInput) =>
      request<RecurringRule>('/api/v1/recurring/rules', { method: 'POST', body: input }),
    updateRule: (id: string, changes: RecurringRuleInput) =>
      request<RecurringRule>(`/api/v1/recurring/rules/${id}`, {
        method: 'PATCH',
        body: changes,
      }),
    removeRule: (id: string) =>
      request<void>(`/api/v1/recurring/rules/${id}`, { method: 'DELETE' }),
    setRuleEnabled: (id: string, enabled: boolean) =>
      request<RecurringRule>(`/api/v1/recurring/rules/${id}/enabled`, {
        method: 'POST',
        body: { enabled },
      }),
    generate: () => request<GenerateResult>('/api/v1/recurring/generate', { method: 'POST' }),
    listOccurrences: () =>
      request<{ items: RecurringOccurrence[] }>('/api/v1/recurring/occurrences'),
    listPending: () =>
      request<{ items: RecurringOccurrence[]; total: number }>('/api/v1/recurring/pending'),
    confirm: (id: string) =>
      request<ConfirmResult>(`/api/v1/recurring/occurrences/${id}/confirm`, { method: 'POST' }),
    ignore: (id: string) =>
      request<RecurringOccurrence>(`/api/v1/recurring/occurrences/${id}/ignore`, {
        method: 'POST',
      }),
  },

  /**
   * Export, import and backups.
   *
   * The exports are plain URLs rather than `request()` calls: they are file downloads
   * behind the session cookie, so a link the browser follows is both simpler and avoids
   * pulling the whole CSV into memory through `fetch`. `exportUrl` returns the href.
   */
  portability: {
    exportUrl: (what: 'transactions' | 'salaries' | 'recurring' | 'transfers') =>
      `/api/v1/export/${what}.csv`,
    /**
     * Imports a CSV.
     *
     * Sent as raw text rather than multipart: a CSV is text, and multipart would need
     * another dependency. The server parses `text/csv` and applies its body limit.
     */
    importTransactions: (csvText: string) =>
      request<ImportResult>('/api/v1/import/transactions', {
        method: 'POST',
        rawBody: { contentType: 'text/csv', body: csvText },
      }),
    importTransfers: (csvText: string) =>
      request<ImportResult>('/api/v1/import/transfers', {
        method: 'POST',
        rawBody: { contentType: 'text/csv', body: csvText },
      }),
    /**
     * Preview or confirm a WeChat/Alipay bill import.
     *
     * Sent as JSON with `fileBase64` so GBK/xlsx bytes survive, and so the confirm
     * call can carry `selectedIds` + per-row `categoryOverrides` without a second file format.
     */
    importPlatformBills: (input: PlatformImportRequest) => {
      const bytes = input.bytes;
      return request<PlatformImportResult>('/api/v1/import/platform-bills', {
        method: 'POST',
        body: {
          fileBase64: base64Bytes(bytes),
          source: input.source ?? 'auto',
          dryRun: input.dryRun === true,
          fileName: input.fileName,
          selectedIds: input.selectedIds === undefined ? null : input.selectedIds,
          categoryOverrides: input.categoryOverrides ?? {},
        },
      });
    },
    listBackups: () => request<{ items: BackupFile[] }>('/api/v1/backups'),
    createBackup: () => request<BackupFile>('/api/v1/backups', { method: 'POST' }),
  },
};
