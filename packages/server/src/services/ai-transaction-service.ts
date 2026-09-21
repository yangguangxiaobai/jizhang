import {
  TYPE_EXPENSE,
  TYPE_INCOME,
  dateOnly,
  dayStart,
  parseYuanToCents,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { normaliseTags } from './tags.js';
import { AiConfigService } from './ai-config-service.js';
import {
  AiInputError,
  AiResponseInvalidError,
  type AiPromptContext,
  type AiTransactionDraft,
} from './ai-types.js';
import { AiProviderService } from './ai-provider-service.js';

const MAX_INPUT_LENGTH = 2_000;
const FUTURE_SLACK_MS = 86_400_000;
const MIN_DATE_MS = Date.UTC(2000, 0, 1);

interface CategoryChoice {
  readonly id: string;
  readonly name: string;
  readonly type: number;
}

interface AccountChoice {
  readonly id: string;
  readonly name: string;
  readonly type: number;
}

interface CategoryRow extends CategoryChoice {
  readonly parent_id: string | null;
}

type AccountRow = AccountChoice;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: ['string', 'null'], enum: ['expense', 'income', null] },
    amountYuan: { type: ['number', 'string', 'null'] },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    note: { type: ['string', 'null'] },
    categoryId: { type: ['string', 'null'] },
    categoryName: { type: ['string', 'null'] },
    accountId: { type: ['string', 'null'] },
    accountName: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    reason: { type: ['string', 'null'] },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'type',
    'amountYuan',
    'date',
    'note',
    'categoryId',
    'accountId',
    'tags',
    'confidence',
    'reason',
    'missing',
  ],
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // The caller receives the stable AI response error below.
    }
  }
  throw new AiResponseInvalidError();
}

function parseType(value: unknown): 0 | 1 | null {
  if (value === TYPE_EXPENSE || value === 'expense' || value === '支出') return TYPE_EXPENSE;
  if (value === TYPE_INCOME || value === 'income' || value === '收入') return TYPE_INCOME;
  return null;
}

function parseAmount(record: Record<string, unknown>): number | null {
  const cents = record['amountCents'];
  if (typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0) return cents;
  const yuan = record['amountYuan'] ?? record['amount'];
  if (typeof yuan !== 'string' && typeof yuan !== 'number') return null;
  return parseYuanToCents(String(yuan));
}

function parseDate(value: unknown, nowMs: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = dateOnly(value);
    return normalized >= MIN_DATE_MS && normalized <= nowMs + FUTURE_SLACK_MS ? normalized : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = dayStart(year, month - 1, day);
  const date = new Date(result);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    result < MIN_DATE_MS ||
    result > nowMs + FUTURE_SLACK_MS
  ) {
    return null;
  }
  return result;
}

function selectId(
  record: Record<string, unknown>,
  idKey: string,
  nameKey: string,
  choices: readonly { readonly id: string; readonly name: string }[],
): string | null {
  const id = record[idKey];
  if (typeof id === 'string' && choices.some((choice) => choice.id === id)) return id;
  const name = record[nameKey];
  if (typeof name !== 'string') return null;
  return choices.find((choice) => choice.name === name.trim())?.id ?? null;
}

function todayLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export class AiTransactionService {
  constructor(
    private readonly db: Db,
    private readonly config: AiConfigService,
    private readonly provider: AiProviderService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private choices(): { categories: CategoryChoice[]; accounts: AccountChoice[] } {
    const categoryRows = this.db
      .prepare(
        `SELECT id, name, type, parent_id
           FROM categories
          WHERE deleted = 0
          ORDER BY type, sort_order, name`,
      )
      .all() as CategoryRow[];
    const parentIds = new Set(
      categoryRows.filter((row) => row.parent_id !== null).map((row) => row.parent_id as string),
    );
    const categories = categoryRows
      .filter((row) => row.type === TYPE_INCOME || !parentIds.has(row.id))
      .map(({ id, name, type }) => ({ id, name, type }));
    const accounts = this.db
      .prepare('SELECT id, name, type FROM accounts WHERE deleted = 0 ORDER BY sort_order, name')
      .all() as AccountRow[];
    return { categories, accounts };
  }

  private context(input: string): AiPromptContext {
    const choices = this.choices();
    return {
      input,
      categories: choices.categories,
      accounts: choices.accounts,
      model: this.config.getStoredOrThrow().model,
      today: todayLabel(this.now()),
      responseSchema: RESPONSE_SCHEMA,
    };
  }

  private normalize(raw: unknown, context: AiPromptContext): AiTransactionDraft {
    const record = asRecord(raw);
    const type = parseType(record['type']);
    const amountCents = parseAmount(record);
    const date = parseDate(record['date'], this.now());
    const categories = context.categories.filter((category) => type === null || category.type === type);
    const categoryId = selectId(record, 'categoryId', 'categoryName', categories);
    const accountId = selectId(record, 'accountId', 'accountName', context.accounts);
    const confidenceValue = record['confidence'];
    const confidence =
      typeof confidenceValue === 'number' && Number.isFinite(confidenceValue)
        ? Math.min(Math.max(confidenceValue, 0), 1)
        : null;
    const missing: AiTransactionDraft['missing'] = [];
    if (amountCents === null) missing.push('amount');
    if (type === null) missing.push('type');
    if (categoryId === null) missing.push('category');
    if (accountId === null) missing.push('account');
    if (date === null) missing.push('date');

    return {
      type,
      amountCents,
      categoryId,
      accountId,
      date,
      note: boundedText(record['note'], 200),
      tags: Array.isArray(record['tags']) ? normaliseTags(record['tags']) : [],
      confidence,
      reason: boundedText(record['reason'], 300) || null,
      missing,
    };
  }

  async draft(input: unknown): Promise<AiTransactionDraft> {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new AiInputError('请输入想要记录的账单描述。');
    }
    const text = input.trim();
    if (text.length > MAX_INPUT_LENGTH) {
      throw new AiInputError(`账单描述不能超过 ${MAX_INPUT_LENGTH} 个字符。`);
    }
    const stored = this.config.getStoredOrThrow();
    const secret = this.config.getSecretOrThrow(stored);
    const context = this.context(text);
    const raw = await this.provider.complete(stored, secret, context);
    return this.normalize(raw, context);
  }

  async testProvider(): Promise<void> {
    const stored = this.config.getStoredOrThrow();
    const secret = this.config.getSecretOrThrow(stored);
    const context: AiPromptContext = {
      input: '请只返回一个空的记账草稿 JSON，用于测试连接。',
      categories: [],
      accounts: [],
      model: stored.model,
      today: todayLabel(this.now()),
      responseSchema: RESPONSE_SCHEMA,
    };
    await this.provider.complete(stored, secret, context);
  }
}
