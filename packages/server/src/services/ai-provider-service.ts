import {
  AiConfigValidationError,
  AiProviderError,
  AiProviderTimeoutError,
  AiResponseInvalidError,
  type AiHttpMethod,
  type AiPromptContext,
  type StoredAiProviderConfig,
} from './ai-types.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TEMPLATE_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

type FetchLike = typeof fetch;

function valueForVariable(name: string, context: AiPromptContext): unknown {
  switch (name) {
    case 'input':
      return context.input;
    case 'categories':
      return context.categories;
    case 'accounts':
      return context.accounts;
    case 'model':
      return context.model;
    case 'today':
      return context.today;
    case 'responseSchema':
      return context.responseSchema;
    case 'facts':
      return context.facts ?? null;
    default:
      throw new AiConfigValidationError(`模板包含不支持的变量：${name}。`);
  }
}

/** Renders URL strings with encoded non-secret variables; secrets are never template inputs. */
export function renderAiStringTemplate(template: string, context: AiPromptContext): string {
  return template.replace(TEMPLATE_PATTERN, (_whole, name: string) => {
    const value = valueForVariable(name, context);
    return encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
  });
}

function replaceJsonTemplateValue(
  value: unknown,
  markers: ReadonlyMap<string, { readonly value: unknown; readonly stringContext: boolean }>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceJsonTemplateValue(item, markers));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceJsonTemplateValue(item, markers),
      ]),
    );
  }
  if (typeof value !== 'string') return value;

  const exact = markers.get(value);
  if (exact !== undefined) {
    return exact.stringContext
      ? typeof exact.value === 'string'
        ? exact.value
        : JSON.stringify(exact.value)
      : exact.value;
  }
  let output = value;
  for (const [marker, markerValue] of markers) {
    if (!output.includes(marker)) continue;
    const replacement = markerValue.value;
    output = output.replaceAll(
      marker,
      typeof replacement === 'string' ? replacement : JSON.stringify(replacement),
    );
  }
  return output;
}

function markJsonTemplate(template: string, context: AiPromptContext): {
  readonly template: string;
  readonly markers: ReadonlyMap<string, { readonly value: unknown; readonly stringContext: boolean }>;
} {
  const markers = new Map<string, { readonly value: unknown; readonly stringContext: boolean }>();
  let rendered = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (character === '"' && !escaped) inString = !inString;
    if (character === '{' && template[index + 1] === '{') {
      const end = template.indexOf('}}', index + 2);
      if (end === -1) throw new AiConfigValidationError('模板变量格式无效。');
      const name = template.slice(index + 2, end).trim();
      const value = valueForVariable(name, context);
      const marker = `__AI_TEMPLATE_${markers.size}__`;
      markers.set(marker, { value, stringContext: inString });
      rendered += inString ? marker : JSON.stringify(marker);
      index = end + 1;
      escaped = false;
      continue;
    }
    rendered += character;
    if (inString && character === '\\' && !escaped) {
      escaped = true;
    } else {
      escaped = false;
    }
  }
  return { template: rendered, markers };
}

function parseJsonTemplate(template: string, context: AiPromptContext): unknown {
  const marked = markJsonTemplate(template, context);
  let parsed: unknown;
  try {
    parsed = JSON.parse(marked.template);
  } catch {
    throw new AiConfigValidationError('自定义请求体必须是有效 JSON。');
  }
  return replaceJsonTemplateValue(parsed, marked.markers);
}

/** Parses and renders JSON without eval or arbitrary expression support. */
export function renderAiJsonTemplate(template: string, context: AiPromptContext): unknown {
  return parseJsonTemplate(template, context);
}

function parsePath(path: string): Array<string | number> {
  if (path.trim() === '') throw new AiConfigValidationError('响应字段路径不能为空。');
  const tokens: Array<string | number> = [];
  const pattern = /(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path)) !== null) {
    if (match.index !== cursor && !(cursor === 0 && match.index === 0)) {
      throw new AiConfigValidationError('响应字段路径格式无效。');
    }
    tokens.push(match[1] ?? Number(match[2]));
    cursor = pattern.lastIndex;
  }
  if (tokens.length === 0 || cursor !== path.length) {
    throw new AiConfigValidationError('响应字段路径格式无效。');
  }
  return tokens;
}

export function extractAiResponsePath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const token of parsePath(path)) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token >= current.length) throw new AiResponseInvalidError();
      current = current[token];
      continue;
    }
    if (typeof current !== 'object' || current === null || !(token in current)) {
      throw new AiResponseInvalidError();
    }
    current = (current as Record<string, unknown>)[token];
  }
  if (current === null || current === undefined) throw new AiResponseInvalidError();
  if (typeof current === 'string') {
    try {
      return JSON.parse(current);
    } catch {
      return current;
    }
  }
  return current;
}

function systemPrompt(context: AiPromptContext): string {
  if (context.feature === 'assistant') {
    return [
      'You are a careful bookkeeping assistant. Use only server-provided facts and the tool catalog; never invent ledger values or identifiers.',
      'Return exactly one JSON object with {"message":"...","toolCall":null} or {"message":"...","toolCall":{"name":"...","arguments":{...}}}.',
      'Choose at most one tool call per response. Read tools return authoritative facts. Write tools only prepare a preview and never perform a write; the user must confirm separately.',
      'Do not claim a write succeeded unless a confirmed result is present in the supplied facts. If required fields are missing, ask a short question without calling a write tool.',
      `Server context and allowlisted tools: ${JSON.stringify(context.facts ?? {})}`,
      `Required response schema: ${JSON.stringify(context.responseSchema)}`,
    ].join('\n');
  }
  if (context.feature === 'organization') {
    return [
      '你是一个严谨的记账分类分析助手。只能基于服务端提供的账单摘要和分类列表提出建议，不能修改账本。',
      '必须只输出 JSON，不要 Markdown、解释文字或代码围栏。',
      '账单重新分类只能使用 facts.transactions 中已有的 transactionId，并且 targetCategoryId 只能使用 facts.categories 中同类型的分类 id。',
      '新增分类建议只能提出名称和类型，不能声称已经创建；不要输出金额、账户、日期或任何账务计算。',
      '输出结构：{"suggestions":[{"actionId":"...","reason":"...","confidence":0}],"reclassifications":[{"transactionId":"...","targetCategoryId":"...","reason":"...","confidence":0}],"newCategories":[{"name":"...","type":0,"parentCategoryId":null,"evidenceTransactionIds":["..."],"reason":"...","confidence":0}]}。',
      `候选聚合事实：${JSON.stringify(context.facts ?? {})}`,
      `输出结构约束：${JSON.stringify(context.responseSchema)}`,
    ].join('\n');
  }
  if (context.feature === 'monthly-evaluation') {
    return [
      '你是一个严谨的个人记账分析助手。请只根据服务端提供的当前自然月聚合事实生成评价，不要修改账本。',
      '必须只输出 JSON，不要 Markdown、解释文字或代码围栏。',
      '不能补造金额、分类、趋势或预算数字；预算字段如果存在，仍要注意它代表最新预算周期，不一定等于自然月。',
      'summary、highlights、risks、suggestions 都使用 {"text": "...", "evidenceIds": ["..."]} 结构。每条内容至少引用一个事实中的 evidenceId，只能引用事实里出现的 id。',
      '没有足够事实时，明确说数据不足，不要猜测原因。',
      `当前日期：${context.today}。`,
      `聚合事实：${JSON.stringify(context.facts ?? {})}`,
      `输出结构：${JSON.stringify(context.responseSchema)}`,
    ].join('\n');
  }
  return [
    '你是一个严谨的记账助手。只根据用户输入生成一个待确认账单草稿，不要写入账本。',
    '必须只输出 JSON，不要 Markdown、解释文字或代码围栏。',
    'type 只能是 "expense"、"income" 或 null；amountYuan 使用正数元；date 使用 YYYY-MM-DD。',
    'categoryId 和 accountId 必须从提供的列表中选择；不确定时使用 null，并把字段名加入 missing。',
    `今天是 ${context.today}。`,
    `可用分类：${JSON.stringify(context.categories)}`,
    `可用账户：${JSON.stringify(context.accounts)}`,
    `输出结构：${JSON.stringify(context.responseSchema)}`,
  ].join('\n');
}

function requestBody(
  config: StoredAiProviderConfig,
  context: AiPromptContext,
): unknown | null {
  if (config.mode === 'custom') {
    if (config.bodyTemplate === null) return null;
    return renderAiJsonTemplate(config.bodyTemplate, context);
  }
  if (config.mode === 'chat-completions') {
    return {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt(context) },
        { role: 'user', content: context.input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    };
  }
  return {
    model: config.model,
    instructions: systemPrompt(context),
    input: context.input,
    text: { format: { type: 'json_object' } },
    temperature: 0,
  };
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function authHeader(
  config: StoredAiProviderConfig,
  secret: string | null,
): Record<string, string> {
  if (config.auth.kind === 'none') return {};
  if (secret === null) throw new AiResponseInvalidError();
  if (config.auth.kind === 'bearer') return { Authorization: `Bearer ${secret}` };
  return { [config.auth.headerName ?? 'X-API-Key']: secret };
}

function safeMethod(method: AiHttpMethod): string {
  return method;
}

export class AiProviderService {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async complete(
    config: StoredAiProviderConfig,
    secret: string | null,
    context: AiPromptContext,
  ): Promise<unknown> {
    const url = renderAiStringTemplate(config.url, context);
    const body = requestBody(config, context);
    const headers: Record<string, string> = { ...config.headers, ...authHeader(config, secret) };
    if (body !== null && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    if (!hasHeader(headers, 'accept')) headers.Accept = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: safeMethod(config.method),
        headers,
        redirect: 'error',
        signal: controller.signal,
        ...(body === null || config.method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      if (controller.signal.aborted) throw new AiProviderTimeoutError();
      throw new AiProviderError();
    } finally {
      clearTimeout(timer);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new AiProviderError();
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new AiProviderError();
    }
    if (!response.ok) throw new AiProviderError();

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiResponseInvalidError();
    }
    return extractAiResponsePath(payload, config.responsePath);
  }
}
