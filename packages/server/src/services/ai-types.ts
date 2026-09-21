/** Shared server-side contracts for the configurable AI assistant. */

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
