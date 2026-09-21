import type { Db } from '../db/index.js';
import {
  AI_HTTP_METHODS,
  AI_PROVIDER_MODES,
  AI_PROVIDER_SETTING_KEY,
  AiConfigValidationError,
  AiEncryptionKeyRequiredError,
  AiNotConfiguredError,
  AiSecretUnavailableError,
  type AiAuthKind,
  type AiHttpMethod,
  type AiProviderConfigInput,
  type AiProviderConfigSummary,
  type AiProviderMode,
  type StoredAiProviderConfig,
} from './ai-types.js';
import { decryptAiSecret, encryptAiSecret, hasAiEncryptionKey } from './ai-crypto.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_HEADERS = 20;
const MAX_TEMPLATE_LENGTH = 32_768;
const MAX_URL_LENGTH = 2_000;
const TEMPLATE_VARIABLES = new Set(['input', 'categories', 'accounts', 'model', 'today', 'responseSchema']);
const SECRET_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'token',
]);

const DEFAULT_SUMMARY: AiProviderConfigSummary = {
  configured: false,
  enabled: false,
  encryptionKeyConfigured: false,
  hasSecret: false,
  mode: 'chat-completions',
  name: '',
  url: '',
  method: 'POST',
  model: '',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  headers: {},
  auth: { kind: 'bearer' },
  bodyTemplate: null,
  responsePath: 'choices[0].message.content',
  updatedAt: null,
};

interface SettingsRow {
  readonly value_json: string;
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AiConfigValidationError(`${field} 必须是文本。`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AiConfigValidationError(`${field} 不能超过 ${maxLength} 个字符。`);
  }
  return trimmed;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AiConfigValidationError(`${field} 必须是布尔值。`);
  return value;
}

function requireMode(value: unknown): AiProviderMode {
  if (typeof value !== 'string' || !(AI_PROVIDER_MODES as readonly string[]).includes(value)) {
    throw new AiConfigValidationError('AI 接口模式不受支持。');
  }
  return value as AiProviderMode;
}

function requireMethod(value: unknown): AiHttpMethod {
  if (typeof value !== 'string' || !(AI_HTTP_METHODS as readonly string[]).includes(value)) {
    throw new AiConfigValidationError('HTTP 请求方式不受支持。');
  }
  return value as AiHttpMethod;
}

function defaultResponsePath(mode: AiProviderMode): string {
  return mode === 'chat-completions' ? 'choices[0].message.content' : mode === 'responses' ? 'output_text' : '';
}

function validateUrlTemplate(url: string, mode: AiProviderMode, production: boolean): void {
  if (url === '') throw new AiConfigValidationError('AI 请求地址不能为空。');
  if (url.length > MAX_URL_LENGTH) throw new AiConfigValidationError('AI 请求地址过长。');
  const sample = url.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, name: string) => {
    if (!TEMPLATE_VARIABLES.has(name)) {
      throw new AiConfigValidationError(`请求地址包含不支持的模板变量：${name}。`);
    }
    return encodeURIComponent('template-value');
  });
  let parsed: URL;
  try {
    parsed = new URL(sample);
  } catch {
    throw new AiConfigValidationError('AI 请求地址必须是有效的 http(s) 地址。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiConfigValidationError('AI 请求地址只允许使用 http 或 https。');
  }
  if (production && parsed.protocol !== 'https:') {
    throw new AiConfigValidationError('生产环境的 AI 请求地址必须使用 https。');
  }
  if (mode !== 'custom' && parsed.username !== '') {
    throw new AiConfigValidationError('AI 请求地址不能包含用户名或密码。');
  }
}

function validateJsonTemplate(template: string): void {
  const sanitized = template.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_whole, name: string) => {
    if (!TEMPLATE_VARIABLES.has(name)) {
      throw new AiConfigValidationError(`请求体模板包含不支持的变量：${name}。`);
    }
    return 'null';
  });
  try {
    JSON.parse(sanitized);
  } catch {
    throw new AiConfigValidationError('自定义请求体必须是有效 JSON。');
  }
}

function parseHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AiConfigValidationError('自定义请求头必须是键值对象。');
  }
  const headers: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) throw new AiConfigValidationError('自定义请求头不能超过 20 个。');
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new AiConfigValidationError(`请求头名称无效：${rawName}。`);
    }
    if (SECRET_HEADER_NAMES.has(name.toLowerCase())) {
      throw new AiConfigValidationError('Authorization、Cookie 等敏感请求头请通过认证设置填写。');
    }
    const headerValue = requireString(rawValue, `请求头 ${name}`, 2_000);
    if (/\{\{secret\}\}/i.test(headerValue)) {
      throw new AiConfigValidationError('请求头不能引用 secret 模板变量。');
    }
    headers[name] = headerValue;
  }
  return headers;
}

function parseAuth(value: unknown, previous: StoredAiProviderConfig | undefined): StoredAiProviderConfig['auth'] {
  if (value === undefined) return previous?.auth ?? { kind: 'bearer' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiConfigValidationError('AI 认证设置无效。');
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (kind !== 'none' && kind !== 'bearer' && kind !== 'header') {
    throw new AiConfigValidationError('AI 认证类型不受支持。');
  }
  if (kind !== 'header') return { kind: kind as AiAuthKind };
  const headerName = requireString(record['headerName'], '认证请求头名称', 100);
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) {
    throw new AiConfigValidationError('认证请求头名称无效。');
  }
  if (SECRET_HEADER_NAMES.has(headerName.toLowerCase())) {
    throw new AiConfigValidationError('认证请求头名称不能使用 Cookie 或 Set-Cookie。');
  }
  return { kind: 'header', headerName };
}

function parseTimeout(value: unknown, previous: number | undefined): number {
  if (value === undefined) return previous ?? DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AiConfigValidationError('AI 超时时间必须是整数毫秒。');
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new AiConfigValidationError(`AI 超时时间必须在 ${MIN_TIMEOUT_MS} 到 ${MAX_TIMEOUT_MS} 毫秒之间。`);
  }
  return value;
}

function parseStored(raw: string): StoredAiProviderConfig {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new AiConfigValidationError('AI 配置数据已损坏，请重新保存配置。');
  }
  if (typeof decoded !== 'object' || decoded === null) {
    throw new AiConfigValidationError('AI 配置数据已损坏，请重新保存配置。');
  }
  const record = decoded as Record<string, unknown>;
  if (record['version'] !== 1 || typeof record['updatedAt'] !== 'number') {
    throw new AiConfigValidationError('AI 配置版本不受支持，请重新保存配置。');
  }
  const mode = requireMode(record['mode']);
  const method = requireMethod(record['method']);
  const auth = parseAuth(record['auth'], undefined);
  const headers = parseHeaders(record['headers']);
  const url = requireString(record['url'], 'AI 请求地址', MAX_URL_LENGTH);
  const model = requireString(record['model'], 'AI 模型', 200);
  const name = requireString(record['name'], 'AI 配置名称', 80);
  const responsePath = requireString(record['responsePath'], '响应字段路径', 200);
  const bodyTemplate = record['bodyTemplate'] === null ? null : requireString(record['bodyTemplate'], '请求体模板', MAX_TEMPLATE_LENGTH);
  const encryptedSecret = record['encryptedSecret'];
  if (encryptedSecret !== null && (typeof encryptedSecret !== 'object' || encryptedSecret === undefined)) {
    throw new AiConfigValidationError('AI 密钥密文格式无效。');
  }
  return {
    version: 1,
    enabled: record['enabled'] === true,
    mode,
    name,
    url,
    method,
    model,
    timeoutMs: parseTimeout(record['timeoutMs'], undefined),
    headers,
    auth,
    bodyTemplate,
    responsePath,
    encryptedSecret: encryptedSecret as StoredAiProviderConfig['encryptedSecret'],
    updatedAt: record['updatedAt'],
  };
}

export class AiConfigService {
  constructor(
    private readonly db: Db,
    private readonly options: {
      readonly aiEncryptionKey: string | undefined;
      readonly production: boolean;
      readonly now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private stored(): StoredAiProviderConfig | undefined {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(AI_PROVIDER_SETTING_KEY) as SettingsRow | undefined;
    return row === undefined ? undefined : parseStored(row.value_json);
  }

  summary(): AiProviderConfigSummary {
    const stored = this.stored();
    if (stored === undefined) {
      return { ...DEFAULT_SUMMARY, encryptionKeyConfigured: hasAiEncryptionKey(this.options.aiEncryptionKey) };
    }
    return {
      configured: true,
      enabled: stored.enabled,
      encryptionKeyConfigured: hasAiEncryptionKey(this.options.aiEncryptionKey),
      hasSecret: stored.encryptedSecret !== null,
      mode: stored.mode,
      name: stored.name,
      url: stored.url,
      method: stored.method,
      model: stored.model,
      timeoutMs: stored.timeoutMs,
      headers: stored.headers,
      auth: stored.auth,
      bodyTemplate: stored.mode === 'custom' ? stored.bodyTemplate : null,
      responsePath: stored.responsePath,
      updatedAt: stored.updatedAt,
    };
  }

  getStoredOrThrow(): StoredAiProviderConfig {
    const stored = this.stored();
    if (stored === undefined || !stored.enabled) throw new AiNotConfiguredError();
    return stored;
  }

  getSecretOrThrow(stored: StoredAiProviderConfig): string | null {
    if (stored.auth.kind === 'none') return null;
    if (stored.encryptedSecret === null) throw new AiSecretUnavailableError();
    return decryptAiSecret(stored.encryptedSecret, this.options.aiEncryptionKey);
  }

  save(input: AiProviderConfigInput): AiProviderConfigSummary {
    const previous = this.stored();
    const record = input as Record<string, unknown>;
    const mode = input.mode === undefined ? previous?.mode ?? 'chat-completions' : requireMode(input.mode);
    const enabled = input.enabled === undefined ? previous?.enabled ?? false : requireBoolean(input.enabled, 'enabled');
    const name = input.name === undefined ? previous?.name ?? 'AI 助手' : requireString(input.name, '配置名称', 80);
    const url = input.url === undefined ? previous?.url ?? '' : requireString(input.url, 'AI 请求地址', MAX_URL_LENGTH);
    const method = input.method === undefined ? previous?.method ?? 'POST' : requireMethod(input.method);
    const model = input.model === undefined ? previous?.model ?? '' : requireString(input.model, 'AI 模型', 200);
    const timeoutMs = parseTimeout(input.timeoutMs, previous?.timeoutMs);
    const headers = parseHeaders(input.headers === undefined ? previous?.headers : input.headers);
    const auth = parseAuth(input.auth, previous);
    const bodyTemplate =
      input.bodyTemplate === undefined
        ? previous?.bodyTemplate ?? null
        : input.bodyTemplate === null || input.bodyTemplate === ''
          ? null
          : requireString(input.bodyTemplate, '请求体模板', MAX_TEMPLATE_LENGTH);
    const responsePath =
      input.responsePath === undefined
        ? previous?.responsePath ?? defaultResponsePath(mode)
        : requireString(input.responsePath, '响应字段路径', 200);

    if (enabled) {
      validateUrlTemplate(url, mode, this.options.production);
      if (model === '') throw new AiConfigValidationError('启用 AI 时必须填写模型名称。');
      if (mode !== 'custom' && method !== 'POST') {
        throw new AiConfigValidationError('OpenAI-compatible 和 Responses 模式必须使用 POST。');
      }
      if (mode === 'custom' && bodyTemplate === null && method !== 'GET') {
        throw new AiConfigValidationError('自定义模式需要填写 JSON 请求体模板。');
      }
      if (mode === 'custom' && responsePath === '') {
        throw new AiConfigValidationError('自定义模式需要填写响应字段路径。');
      }
    }
    if (mode === 'custom' && bodyTemplate !== null) {
      validateJsonTemplate(bodyTemplate);
    }

    let encryptedSecret = previous?.encryptedSecret ?? null;
    if (input.clearSecret === true) encryptedSecret = null;
    if (hasOwn(record, 'secret') && typeof input.secret === 'string' && input.secret.trim() !== '') {
      if (!hasAiEncryptionKey(this.options.aiEncryptionKey)) throw new AiEncryptionKeyRequiredError();
      encryptedSecret = encryptAiSecret(input.secret, this.options.aiEncryptionKey);
    }
    if (auth.kind !== 'none' && enabled && encryptedSecret === null) {
      throw new AiSecretUnavailableError();
    }

    const next: StoredAiProviderConfig = {
      version: 1,
      enabled,
      mode,
      name,
      url,
      method,
      model,
      timeoutMs,
      headers,
      auth,
      bodyTemplate,
      responsePath: responsePath || defaultResponsePath(mode),
      encryptedSecret,
      updatedAt: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(AI_PROVIDER_SETTING_KEY, JSON.stringify(next), next.updatedAt);
    return this.summary();
  }
}
