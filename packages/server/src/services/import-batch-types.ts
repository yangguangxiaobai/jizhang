/**
 * Merged platform-bill import batch — shared constants, DTOs and error taxonomy.
 *
 * Contract source of truth: `research/merged-import-protocol-v1.md` (normative). Every budget
 * here is feature-scoped: the legacy single-file import keeps its own 200/100 limits and the
 * global 8 MiB body limit is untouched. None of these numbers may leak into the generic
 * assistant JSON normalisation, which truncates arrays at 200 and rejects objects over 100 keys.
 *
 * Budgets are proposals (`[FRP]`) that must be calibrated against real exports before they are
 * called safe. They are enforced by rejection, never by cropping.
 */
import { AssistantError } from './assistant-types.js';

// ── budgets ─────────────────────────────────────────────────────────────────

export const MERGED_MAX_FILES = 5;
export const MERGED_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MERGED_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** Feature-only body limit: 8 MiB of base64 (~10.67 MiB) plus review metadata. */
export const MERGED_BODY_LIMIT = 12 * 1024 * 1024;

export const MERGED_MAX_FILE_RAW_ROWS = 3000;
export const MERGED_MAX_TOTAL_RAW_ROWS = 5000;
export const MERGED_MAX_CSV_COLUMNS = 64;
export const MERGED_MAX_CELL_CHARS = 1000;

export const MERGED_MAX_INFLATE_ENTRY = 8 * 1024 * 1024;
/** Shared accumulator across the whole batch — never per-file multiplied. */
export const MERGED_MAX_INFLATE_TOTAL = 16 * 1024 * 1024;
export const MERGED_MAX_ZIP_ENTRIES = 64;

export const MERGED_MAX_FILE_TEXT_BYTES = 6 * 1024 * 1024;
export const MERGED_MAX_TOTAL_TEXT_BYTES = 16 * 1024 * 1024;

/** Cooperative checkpoint, not preemption: this parser is synchronous by design. */
export const MERGED_PARSE_DEADLINE_MS = 3000;

/** Materialised items, inclusive of ignored / existing / conflict rows. */
export const MERGED_MAX_ITEMS = 500;
export const MERGED_MAX_NEW_CATEGORIES = 20;
export const MERGED_MAX_SOURCES_RECORDS = 5000;
export const MERGED_PAGE_DEFAULT = 50;
export const MERGED_PAGE_MAX = 100;
export const MERGED_REVIEW_TTL_SEC = 900;
export const MERGED_ANALYSIS_BUDGET_MS = 10 * 60 * 1000;
export const MERGED_ANALYSIS_MAX_CALLS = 20;
export const MERGED_ANALYSIS_ROWS_PER_CALL = 25;
export const MERGED_MAX_REQUEST_ID_CHARS = 120;
export const MERGED_MAX_NOTE_CHARS = 200;
export const MERGED_MAX_CATEGORY_NAME_CHARS = 40;
export const MERGED_COMPARISON_PAGE_DEFAULT = 20;
export const MERGED_COMPARISON_PAGE_MAX = 50;

export const MERGED_BATCH_CARD_SUGGESTIONS_MAX = 20;

// ── status / state ──────────────────────────────────────────────────────────

export type ImportBatchStatus =
  | 'draft'
  | 'prepared'
  | 'reviewed'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'failed';

export type ImportBatchTerminalStatus = 'confirmed' | 'cancelled' | 'expired' | 'failed';

export type ImportAnalysisState = 'idle' | 'running' | 'complete' | 'failed';

export const IMPORT_BATCH_TERMINAL: ReadonlySet<ImportBatchStatus> = new Set([
  'confirmed',
  'cancelled',
  'expired',
  'failed',
]);

export function isTerminalBatchStatus(status: ImportBatchStatus): boolean {
  return IMPORT_BATCH_TERMINAL.has(status);
}

export type ImportFileParseStatus = 'ok' | 'failed';
export type ImportIdentityKind = 'platform_order' | 'occurrence';
export type ImportConflictKind = 'fact_conflict' | 'ledger_collision' | 'weak_collision';
export type ImportCategoryOrigin = 'ai' | 'server-fallback';

// ── errors ──────────────────────────────────────────────────────────────────

/**
 * Batch errors extend `AssistantError`, so the assistant error mapper already knows them and
 * the wire shape stays `{error:{code,message}}`.
 */
export class ImportBatchError extends AssistantError {
  constructor(statusCode: number, code: string, message: string) {
    super(statusCode, code, message);
    this.name = 'ImportBatchError';
  }
}

/** 400 — shape/length/type/base64 problems, empty selection, unknown item ids. */
export class ImportBatchInvalidError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'ASSISTANT_INVALID', message);
    this.name = 'ImportBatchInvalidError';
  }
}

/** 400 — any capacity budget: files, bytes, rows, columns, cells, inflate, text, deadline, items. */
export class ImportBatchLimitError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_LIMIT_EXCEEDED', message);
    this.name = 'ImportBatchLimitError';
  }
}

export class ImportBatchDuplicateFileError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_DUPLICATE_FILE', message);
    this.name = 'ImportBatchDuplicateFileError';
  }
}

export class ImportBatchFileFailedError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_FILE_FAILED', message);
    this.name = 'ImportBatchFileFailedError';
  }
}

export class ImportBatchIdentityConflictError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_IDENTITY_CONFLICT', message);
    this.name = 'ImportBatchIdentityConflictError';
  }
}

export class ImportBatchCategoryRequiredError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_CATEGORY_REQUIRED', message);
    this.name = 'ImportBatchCategoryRequiredError';
  }
}

export class ImportBatchCategoryConflictError extends ImportBatchError {
  constructor(message: string) {
    super(400, 'IMPORT_BATCH_CATEGORY_CONFLICT', message);
    this.name = 'ImportBatchCategoryConflictError';
  }
}

export class ImportBatchStaleVersionError extends ImportBatchError {
  constructor(message = '批次内容已更新，请刷新后重试。') {
    super(409, 'IMPORT_BATCH_STALE_VERSION', message);
    this.name = 'ImportBatchStaleVersionError';
  }
}

export class ImportBatchIdempotencyMismatchError extends ImportBatchError {
  constructor(message = '同一请求编号的请求内容不同，请使用新的请求编号。') {
    super(409, 'IMPORT_BATCH_IDEMPOTENCY_MISMATCH', message);
    this.name = 'ImportBatchIdempotencyMismatchError';
  }
}

export class ImportBatchAlreadyConfirmedError extends ImportBatchError {
  constructor(message = '该批次已确认，且本次请求与已确认内容不一致。') {
    super(409, 'IMPORT_BATCH_ALREADY_CONFIRMED', message);
    this.name = 'ImportBatchAlreadyConfirmedError';
  }
}

/** 409 — ownership/review-token/merge drift. Reuses the existing stale code on purpose. */
export class ImportBatchActionStaleError extends ImportBatchError {
  constructor(message = '批次审核已过期，请重新核对后再次提交审核。') {
    super(409, 'ASSISTANT_ACTION_STALE', message);
    this.name = 'ImportBatchActionStaleError';
  }
}

export class ImportBatchNotFoundError extends ImportBatchError {
  constructor(message = '导入批次不存在或不属于该对话。') {
    super(404, 'ASSISTANT_NOT_FOUND', message);
    this.name = 'ImportBatchNotFoundError';
  }
}

/** 409 — the conversation already has live AI work (generation/legacy turn/batch analysis). */
export class ImportBatchActiveError extends ImportBatchError {
  constructor(message = '当前会话仍有进行中的 AI 生成，请先等待或停止。') {
    super(409, 'ASSISTANT_GENERATION_ACTIVE', message);
    this.name = 'ImportBatchActiveError';
  }
}

// ── wire DTOs (dedicated; never routed through generic assistant JSON) ───────

export interface ImportBatchFileDto {
  readonly fileIndex: number;
  readonly fileName: string;
  readonly source: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly parseStatus: ImportFileParseStatus;
  /** Unknown on failure: `null`, never `0` pretending the file was empty. */
  readonly rawRowCount: number | null;
  readonly collectedRowCount: number | null;
  readonly error: string | null;
}

export interface ImportBatchNoticeDto {
  readonly code: string;
  readonly detail: string;
  readonly itemId?: string;
}

export interface ImportBatchSummaryDto {
  readonly totalItems: number;
  readonly importable: number;
  readonly existing: number;
  readonly ignored: number;
  readonly mergedGroups: number;
  readonly conflictGroups: number;
  readonly weakDuplicateGroups: number;
  readonly expenseCents: number;
  readonly incomeCents: number;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly legacyLedgerMatches: number;
  readonly unparsedFiles: number;
  /** Total source references kept on the batch rows (≤ 5000). */
  readonly sourceRecords: number;
  readonly notices: readonly ImportBatchNoticeDto[];
}

export interface ImportBatchAnalysisDto {
  readonly state: ImportAnalysisState;
  readonly analysisRevision: number;
  readonly analysed: number;
  readonly providerCalls: number;
  readonly suggestedNewCategories: number;
  readonly message: string | null;
}

export interface ImportBatchResultDto {
  readonly inserted: number;
  readonly selected: number;
  readonly excluded: number;
  readonly preexisting: number;
  readonly expenseCents: number;
  readonly incomeCents: number;
  readonly accountsCreated: number;
  readonly categoriesCreated: number;
  readonly categoriesReused: number;
  readonly categoriesSkippedUnused: number;
  readonly warnings: readonly string[];
}

export interface ImportBatchDto {
  readonly batchId: string;
  readonly conversationId: string;
  readonly version: number;
  readonly status: ImportBatchStatus;
  readonly viewRevision: string;
  readonly files: readonly ImportBatchFileDto[];
  readonly summary: ImportBatchSummaryDto;
  readonly analysis: ImportBatchAnalysisDto;
  readonly result: ImportBatchResultDto | null;
}

export interface ImportBatchSourceRefDto {
  readonly fileName: string;
  readonly fileIndex: number;
  readonly sourceRow: number;
  /** Parser-resolved platform of this source row (`wechat` or `alipay`). */
  readonly source: 'wechat' | 'alipay';
  /** Server-computed canonical origin (`sha256:sourceRow`); never supplied by a client. */
  readonly origin: string;
  readonly note: string;
  readonly rawStatus: string;
  readonly ignoreReason: string | null;
}

export interface ImportBatchFallbackDto {
  readonly effectiveExistingId: string | null;
  readonly categoryName: string | null;
  readonly source: string | null;
  readonly newOtherSuggestionId: string | null;
}

export interface ImportBatchAiDto {
  /** `none` means this row carries no published AI recommendation (failure or not analysed). */
  readonly status: 'none' | 'complete';
  readonly include: boolean | null;
  readonly reason: string | null;
  readonly categoryId: string | null;
  readonly newSuggestionId: string | null;
}

export interface ImportBatchRowDto {
  readonly itemId: string;
  readonly identityKind: ImportIdentityKind;
  readonly ordinal: number;
  readonly conflictGroup: string | null;
  readonly conflictKind: ImportConflictKind | null;
  readonly dateLabel: string;
  readonly sourceTimestamp: string | null;
  readonly type: number;
  readonly amountCents: number;
  readonly note: string;
  readonly noteAlternatives: readonly { readonly fileName: string; readonly note: string }[];
  readonly isRefund: boolean;
  readonly refundWarning: string | null;
  readonly rawStatus: string;
  readonly ignored: boolean;
  readonly ignoreReason: string | null;
  readonly existing: boolean;
  readonly possibleDuplicate: boolean;
  readonly duplicateOfNote: string | null;
  readonly weakDuplicateGroup: string | null;
  readonly legacyLedgerMatch: boolean;
  readonly comparisonAccountId: string | null;
  readonly sources: readonly ImportBatchSourceRefDto[];
  readonly fallback: ImportBatchFallbackDto;
  readonly ai: ImportBatchAiDto;
}

export interface ImportBatchRowsPageDto {
  readonly batchId: string;
  readonly version: number;
  readonly analysisRevision: number;
  readonly viewRevision: string;
  readonly total: number;
  readonly items: readonly ImportBatchRowDto[];
  readonly nextCursor: string | null;
  readonly readAt: number;
}

export interface ImportBatchCategorySuggestionDto {
  readonly suggestionId: string;
  readonly origin: ImportCategoryOrigin;
  readonly name: string;
  readonly type: number;
  readonly parentId: string | null;
  readonly relatedItemCount: number;
  readonly relatedItemIds: readonly string[];
  readonly candidates: readonly {
    readonly categoryId: string;
    readonly name: string;
    readonly type: number;
    readonly parentId: string | null;
    readonly isLeaf: boolean;
  }[];
}

export interface ImportBatchCategoriesDto {
  readonly batchId: string;
  readonly version: number;
  readonly analysisRevision: number;
  readonly viewRevision: string;
  readonly categories: readonly { readonly id: string; readonly name: string; readonly type: number; readonly parentId: string | null }[];
  readonly items: readonly ImportBatchCategorySuggestionDto[];
  readonly notice: string | null;
}

export type ImportCategoryAssignment =
  | { readonly kind: 'existing'; readonly categoryId: string }
  | { readonly kind: 'suggestion'; readonly suggestionId: string };

export interface ImportBatchApprovedCategory {
  readonly suggestionId: string;
  readonly resolution: 'create';
  readonly reuseCategoryId: string | null;
  readonly name: string;
  readonly type: number;
  readonly parentId: string | null;
}

export interface ImportBatchConflictDecision {
  readonly conflictGroup: string;
  readonly chosenItemId: string | null;
}

export interface ImportBatchReviewSet {
  readonly selectedItemIds: readonly string[];
  readonly selectedAssignments: Readonly<Record<string, ImportCategoryAssignment>>;
  readonly noteOverrides: Readonly<Record<string, string>>;
  readonly approvedCategories: readonly ImportBatchApprovedCategory[];
  readonly conflictDecisions: readonly ImportBatchConflictDecision[];
}

export interface ImportBatchReviewRecord {
  readonly reviewToken: string;
  readonly expiresAt: number;
  readonly version: number;
  readonly analysisRevision: number;
  readonly viewRevision: string;
  readonly reviewSetDigest: string;
  readonly baseFingerprint: string;
  readonly categorySetHash: string;
  readonly normalized: ImportBatchReviewSet;
  readonly financialSummary: {
    readonly selected: number;
    readonly expenseCents: number;
    readonly incomeCents: number;
    readonly refundIncomeCents: number;
  };
  readonly serverSummaryDigest: string;
}

export interface ImportBatchReviewResponseDto {
  readonly reviewToken: string;
  readonly version: number;
  readonly analysisRevision: number;
  readonly viewRevision: string;
  readonly expiresInSec: number;
  readonly summary: {
    readonly selected: number;
    readonly amountCents: number;
    readonly expenseCents: number;
    readonly incomeCents: number;
    readonly refundIncomeCents: number;
    readonly categoriesToCreate: readonly { readonly name: string; readonly type: number; readonly selectedRows: number }[];
    readonly categoriesToReuse: readonly { readonly categoryId: string; readonly name: string; readonly selectedRows: number }[];
    readonly selectedRows: readonly {
      readonly itemId: string;
      readonly type: number;
      readonly amountCents: number;
      readonly categoryId: string | null;
      readonly categoryName: string | null;
      readonly categoryType: number | null;
      readonly suggestionId: string | null;
      readonly approvedNewCategoryName: string | null;
      /** Resolved value written at confirmation; null is reserved for no note only if source note is null. */
      readonly note: string;
    }[];
    readonly files: readonly { readonly fileName: string; readonly selectedRows: number }[];
    /** Complement of selected within all batch rows; includes preexisting and hard-blocked rows. */
    readonly excluded: number;
    readonly existing: number;
    readonly conflicts: number;
    /** Explicit denominator semantics prevent treating overlapping attributes as a partition. */
    readonly counts: {
      readonly total: number;
      readonly selected: number;
      readonly notSelected: number;
      readonly preexisting: number;
      readonly ruleIgnored: number;
      readonly conflictRows: number;
      readonly userExcluded: null;
    };
  };
}
