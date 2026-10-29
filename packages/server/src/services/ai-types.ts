/** Shared server-side contracts for the configurable AI assistant. */

import type { CycleConfig } from '@jizhang/shared';

export const AI_PROVIDER_SETTING_KEY = 'ai.provider.v1';

export const AI_PROVIDER_MODES = ['chat-completions', 'responses', 'custom'] as const;
export type AiProviderMode = (typeof AI_PROVIDER_MODES)[number];

export const AI_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH'] as const;
export type AiHttpMethod = (typeof AI_HTTP_METHODS)[number];

export type AiAuthKind = 'none' | 'bearer' | 'header';

export interface EncryptedAiSecret {
  readonly version: 1;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export interface StoredAiProviderConfig {
  readonly version: 1;
  readonly enabled: boolean;
  readonly mode: AiProviderMode;
  readonly name: string;
  readonly url: string;
  readonly method: AiHttpMethod;
  readonly model: string;
  readonly timeoutMs: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly auth: { readonly kind: AiAuthKind; readonly headerName?: string };
  readonly bodyTemplate: string | null;
  readonly responsePath: string;
  readonly encryptedSecret: EncryptedAiSecret | null;
  readonly updatedAt: number;
}

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
  readonly headers: Readonly<Record<string, string>>;
  readonly auth: { readonly kind: AiAuthKind; readonly headerName?: string };
  readonly bodyTemplate: string | null;
  readonly responsePath: string;
  readonly updatedAt: number | null;
}

export interface AiProviderConfigInput {
  readonly enabled?: unknown;
  readonly mode?: unknown;
  readonly name?: unknown;
  readonly url?: unknown;
  readonly method?: unknown;
  readonly model?: unknown;
  readonly timeoutMs?: unknown;
  readonly headers?: unknown;
  readonly auth?: unknown;
  readonly bodyTemplate?: unknown;
  readonly responsePath?: unknown;
  /** The new secret. Omit to retain the existing one. */
  readonly secret?: unknown;
  /** Explicitly clear the existing secret. */
  readonly clearSecret?: unknown;
}

export interface AiTransactionDraft {
  readonly type: 0 | 1 | null;
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

export interface AiPromptContext {
  readonly input: string;
  readonly categories: readonly { readonly id: string; readonly name: string; readonly type: number }[];
  readonly accounts: readonly { readonly id: string; readonly name: string; readonly type: number }[];
  readonly model: string;
  readonly today: string;
  readonly responseSchema: Record<string, unknown>;
  /** Optional feature discriminator; omitted means the original transaction-draft prompt. */
  readonly feature?: 'transaction-draft' | 'monthly-evaluation' | 'organization' | 'spending-organization' | 'assistant' | 'bill-import';
  /** Feature-scoped server facts; spending organization may include bounded untrusted bill summaries. */
  readonly facts?: Record<string, unknown>;
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
  /** This is the newest configured budget cycle, not an invented calendar-month budget. */
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

export class AiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AiConfigValidationError extends AiError {
  constructor(message: string) {
    super(400, 'AI_CONFIG_INVALID', message);
    this.name = 'AiConfigValidationError';
  }
}

export class AiInputError extends AiError {
  constructor(message: string) {
    super(400, 'AI_INPUT_INVALID', message);
    this.name = 'AiInputError';
  }
}

export class AiEncryptionKeyRequiredError extends AiError {
  constructor() {
    super(503, 'AI_ENCRYPTION_KEY_REQUIRED', '服务器未配置 AI 加密密钥，暂时无法使用 AI。');
    this.name = 'AiEncryptionKeyRequiredError';
  }
}

export class AiSecretUnavailableError extends AiError {
  constructor() {
    super(503, 'AI_SECRET_UNAVAILABLE', 'AI 密钥无法解密，请在设置中重新保存密钥。');
    this.name = 'AiSecretUnavailableError';
  }
}

export class AiNotConfiguredError extends AiError {
  constructor() {
    super(503, 'AI_NOT_CONFIGURED', '尚未配置可用的 AI 服务，请先在设置中完成配置。');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiProviderError extends AiError {
  constructor() {
    super(502, 'AI_PROVIDER_ERROR', 'AI 服务请求失败，请检查 provider 配置后重试。');
    this.name = 'AiProviderError';
  }
}

export class AiProviderTimeoutError extends AiError {
  constructor() {
    super(504, 'AI_PROVIDER_TIMEOUT', 'AI 服务响应超时，请稍后重试。');
    this.name = 'AiProviderTimeoutError';
  }
}

export class AiResponseInvalidError extends AiError {
  constructor() {
    super(502, 'AI_RESPONSE_INVALID', 'AI 返回内容无法解析为有效的账单草稿。');
    this.name = 'AiResponseInvalidError';
  }
}

export class AiEvaluationResponseInvalidError extends AiError {
  constructor() {
    super(502, 'AI_RESPONSE_INVALID', 'AI 返回内容无法解析为有效的月度评价。');
    this.name = 'AiEvaluationResponseInvalidError';
  }
}

export class AiOrganizationInputError extends AiError {
  constructor(message: string) {
    super(400, 'AI_ORGANIZATION_INVALID', message);
    this.name = 'AiOrganizationInputError';
  }
}

export class AiOrganizationConflictError extends AiError {
  constructor(message: string) {
    super(409, 'AI_ORGANIZATION_CONFLICT', message);
    this.name = 'AiOrganizationConflictError';
  }
}

export class AiOrganizationResponseInvalidError extends AiError {
  constructor() {
    super(502, 'AI_RESPONSE_INVALID', 'AI 返回内容无法解析为有效的整理建议。');
    this.name = 'AiOrganizationResponseInvalidError';
  }
}

export class AiSpendingRunsInputError extends AiError {
  constructor(message: string) {
    super(400, 'AI_ORGANIZATION_RUNS_INVALID', message);
    this.name = 'AiSpendingRunsInputError';
  }
}

export class AiSpendingOverCapError extends AiError {
  constructor(message: string) {
    super(400, 'AI_ORGANIZATION_OVER_CAP', message);
    this.name = 'AiSpendingOverCapError';
  }
}

export class AiSpendingRunNotFoundError extends AiError {
  constructor() {
    super(404, 'AI_ORGANIZATION_RUN_NOT_FOUND', '分析任务不存在。');
    this.name = 'AiSpendingRunNotFoundError';
  }
}

export class AiSpendingCardNotReadyError extends AiError {
  constructor() {
    super(409, 'AI_ORGANIZATION_NOT_READY', '分析尚未完成，无法生成审查卡片。');
    this.name = 'AiSpendingCardNotReadyError';
  }
}

export class AiSpendingOperationNotFoundError extends AiError {
  constructor() {
    super(404, 'AI_ORGANIZATION_OPERATION_NOT_FOUND', '整理操作不存在。');
    this.name = 'AiSpendingOperationNotFoundError';
  }
}
