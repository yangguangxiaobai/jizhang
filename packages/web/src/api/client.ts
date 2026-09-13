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
  readonly rawBody?: { readonly contentType: string; readonly body: string };
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

// ---------------------------------------------------------------------------
// Domain shapes (mirror the server's DTOs)
// ---------------------------------------------------------------------------

export const TYPE_EXPENSE = 0;
export const TYPE_INCOME = 1;

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly type: number;
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
}

/** Budget cycle configuration mirroring the shared engine's `CycleConfig`. */
export type CycleConfig =
  | { readonly kind: 'natural-month' }
  | { readonly kind: 'start-day'; readonly day: number };

export interface BudgetModuleView {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly budgetCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
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

export interface SettingsResponse {
  readonly cycleStartDay: number | null;
  readonly minCycleStartDay: number;
  readonly maxCycleStartDay: number;
  readonly key: string;
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
  /** Income transactions in. Refunds are excluded — they are not income. */
  readonly incomeCents: number;
  /** NET expense out, refunds already subtracted; may be negative. */
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
  /** Net expense in cents; negative when refunds exceeded spending. */
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
    remove: (id: string) =>
      request<void>(`/api/v1/transactions/${id}`, { method: 'DELETE' }),
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
    purge: (id: string) =>
      request<void>(`/api/v1/trash/${id}`, { method: 'DELETE' }),
    restoreAll: () =>
      request<TrashBulkResult>('/api/v1/trash/restore-all', { method: 'POST' }),
    purgeAll: () => request<TrashBulkResult>('/api/v1/trash', { method: 'DELETE' }),
  },
  categories: {
    list: (type?: number) =>
      request<{ items: Category[] }>('/api/v1/categories', {
        query: type === undefined ? {} : { type },
      }),
    create: (input: {
      name: string;
      type: number;
      icon?: string;
      color?: number;
    }) => request<Category>('/api/v1/categories', { method: 'POST', body: input }),
    update: (
      id: string,
      changes: {
        name?: string;
        icon?: string;
        color?: number;
        sortOrder?: number;
      },
    ) => request<Category>(`/api/v1/categories/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) =>
      request<void>(`/api/v1/categories/${id}`, { method: 'DELETE' }),
    move: (id: string, dir: -1 | 1) =>
      request<{ items: Category[] }>(`/api/v1/categories/${id}/move`, {
        method: 'POST',
        body: { dir },
      }),
    usage: (id: string) =>
      request<{ transactions: number }>(`/api/v1/categories/${id}/usage`),
  },
  accounts: {
    list: () => request<{ items: Account[] }>('/api/v1/accounts'),
    /**
     * Balances are a separate call from the account list on purpose: the list is master
     * data (cached for the session) while a balance changes with every bill.
     */
    balances: () => request<AccountBalancesResult>('/api/v1/accounts/balances'),
    create: (input: {
      name: string;
      type: number;
      initialBalanceCents?: number;
    }) => request<Account>('/api/v1/accounts', { method: 'POST', body: input }),
    update: (
      id: string,
      changes: {
        name?: string;
        type?: number;
        initialBalanceCents?: number;
        sortOrder?: number;
      },
    ) => request<Account>(`/api/v1/accounts/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) =>
      request<void>(`/api/v1/accounts/${id}`, { method: 'DELETE' }),
    move: (id: string, dir: -1 | 1) =>
      request<{ items: Account[] }>(`/api/v1/accounts/${id}/move`, {
        method: 'POST',
        body: { dir },
      }),
    usage: (id: string) =>
      request<{ transactions: number }>(`/api/v1/accounts/${id}/usage`),
  },
  tagsAdmin: {
    rename: (from: string, to: string) =>
      request<{ updated: number; items: TagCount[] }>('/api/v1/tags', {
        method: 'PATCH',
        body: { from, to },
      }),
    remove: (name: string) =>
      request<{ updated: number; items: TagCount[] }>(
        `/api/v1/tags/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      ),
  },
  transfers: {
    list: (query: TransactionListQuery = {}) =>
      request<TransferListResult>('/api/v1/transfers', { query }),
    get: (id: string) => request<Transfer>(`/api/v1/transfers/${id}`),
    create: (input: TransferInput) =>
      request<Transfer>('/api/v1/transfers', { method: 'POST', body: input }),
    update: (id: string, changes: Partial<TransferInput>) =>
      request<Transfer>(`/api/v1/transfers/${id}`, { method: 'PATCH', body: changes }),
    remove: (id: string) =>
      request<void>(`/api/v1/transfers/${id}`, { method: 'DELETE' }),
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
    range: () =>
      request<{ earliest: number | null; latest: number | null }>('/api/v1/stats/range'),
    monthWindow: (monthStart: number) =>
      request<{ from: number; to: number }>('/api/v1/stats/month-window', {
        query: { monthStart },
      }),
  },

  health: () => request<{ status: string; version: string }>('/api/v1/health'),

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
    update: (id: string, input: Partial<SalaryInput>) =>
      request<SalaryDetail>(`/api/v1/salaries/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    replaceAllocations: (id: string, allocations: AllocationItem[]) =>
      request<SalaryDetail>(`/api/v1/salaries/${id}/allocations`, {
        method: 'PUT',
        body: { allocations },
      }),
    remove: (id: string) =>
      request<void>(`/api/v1/salaries/${id}`, { method: 'DELETE' }),
  },

  templates: {
    list: () => request<{ items: BudgetTemplate[] }>('/api/v1/templates'),
    create: (name: string, modules: TemplateModule[], isDefault = false) =>
      request<BudgetTemplate>('/api/v1/templates', {
        method: 'POST',
        body: { name, modules, isDefault },
      }),
    update: (
      id: string,
      changes: { name?: string; modules?: TemplateModule[] },
    ) =>
      request<BudgetTemplate>(`/api/v1/templates/${id}`, {
        method: 'PATCH',
        body: changes,
      }),
    remove: (id: string) =>
      request<void>(`/api/v1/templates/${id}`, { method: 'DELETE' }),
    setDefault: (id: string) =>
      request<BudgetTemplate>(`/api/v1/templates/${id}/default`, { method: 'POST' }),
  },

  settings: {
    get: () => request<SettingsResponse>('/api/v1/settings'),
    setCycleStartDay: (cycleStartDay: number | null) =>
      request<{ cycleStartDay: number | null }>('/api/v1/settings', {
        method: 'PUT',
        body: { cycleStartDay },
      }),
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
    exportUrl: (what: 'transactions' | 'salaries' | 'recurring') =>
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
    listBackups: () => request<{ items: BackupFile[] }>('/api/v1/backups'),
    createBackup: () => request<BackupFile>('/api/v1/backups', { method: 'POST' }),
  },
};
