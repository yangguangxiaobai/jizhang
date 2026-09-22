/**
 * On-demand current-natural-month AI evaluation.
 *
 * This service is deliberately read-only. It asks the existing statistics and budget
 * projections for aggregate facts, sends those facts to the configured provider, and
 * returns the facts beside a validated explanation. No provider response is persisted.
 */
import type { Db } from '../db/index.js';
import { AiConfigService } from './ai-config-service.js';
import { AiProviderService } from './ai-provider-service.js';
import {
  AiEvaluationResponseInvalidError,
  AiResponseInvalidError,
  type AiEvaluationStatement,
  type AiMonthlyBudgetFact,
  type AiMonthlyEvaluation,
  type AiMonthlyEvaluationResult,
  type AiMonthlyFacts,
  type AiMonthlyPeriod,
  type AiPromptContext,
} from './ai-types.js';
import { BudgetOverviewService } from './budget-overview-service.js';
import { monthLabel, monthStartOffset, startOfMonthOf, StatsService } from './stats-service.js';

const EVALUATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['text', 'evidenceIds'],
    },
    highlights: { type: 'array', items: { $ref: '#/$defs/statement' } },
    risks: { type: 'array', items: { $ref: '#/$defs/statement' } },
    suggestions: { type: 'array', items: { $ref: '#/$defs/statement' } },
  },
  required: ['summary', 'highlights', 'risks', 'suggestions'],
  $defs: {
    statement: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['text', 'evidenceIds'],
    },
  },
};

const MAX_STATEMENTS = 6;
const MAX_EVIDENCE_IDS = 8;
const MAX_TEXT_LENGTH = 500;

function todayLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

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
      // The stable AI response error below is the only detail returned to callers.
    }
  }
  throw new AiEvaluationResponseInvalidError();
}

function buildBudgetFacts(
  overview: ReturnType<BudgetOverviewService['overview']>,
  periodStart: number | null,
): AiMonthlyBudgetFact | null {
  if (!overview.hasBudget) return null;
  return {
    periodStart,
    cycle: overview.cycle,
    totalBudgetCents: overview.totalBudgetCents,
    totalSpentCents: overview.totalSpentCents,
    carryoverPoolCents: overview.carryoverPoolCents,
    modules: overview.modules.map((module) => ({
      evidenceId: `budget.module.${module.categoryId}`,
      categoryId: module.categoryId,
      categoryName: module.categoryName,
      budgetCents: module.budgetCents,
      spentCents: module.spentCents,
      remainingCents: module.remainingCents,
      ...(module.children === undefined
        ? {}
        : {
            children: module.children.map((child) => ({
              categoryId: child.categoryId,
              categoryName: child.categoryName,
              spentCents: child.spentCents,
            })),
          }),
    })),
  };
}

function collectEvidenceIds(facts: AiMonthlyFacts): Set<string> {
  const ids = new Set<string>([
    facts.monthly.incomeEvidenceId,
    facts.monthly.expenseEvidenceId,
    ...facts.categories.map((item) => item.evidenceId),
    ...facts.trend.map((item) => item.evidenceId),
  ]);
  if (facts.budget !== null) {
    ids.add('budget.total');
    ids.add('budget.pool');
    for (const module of facts.budget.modules) ids.add(module.evidenceId);
  }
  return ids;
}

function normalizeStatement(value: unknown, validEvidenceIds: ReadonlySet<string>): AiEvaluationStatement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiEvaluationResponseInvalidError();
  }
  const record = value as Record<string, unknown>;
  const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
  if (text === '' || text.length > MAX_TEXT_LENGTH) {
    throw new AiEvaluationResponseInvalidError();
  }
  const rawEvidenceIds = record['evidenceIds'];
  if (!Array.isArray(rawEvidenceIds) || rawEvidenceIds.length === 0 || rawEvidenceIds.length > MAX_EVIDENCE_IDS) {
    throw new AiEvaluationResponseInvalidError();
  }
  const evidenceIds: string[] = [];
  for (const rawId of rawEvidenceIds) {
    if (typeof rawId !== 'string' || !validEvidenceIds.has(rawId) || evidenceIds.includes(rawId)) {
      throw new AiEvaluationResponseInvalidError();
    }
    evidenceIds.push(rawId);
  }
  return { text, evidenceIds };
}

function normalizeStatementList(
  value: unknown,
  validEvidenceIds: ReadonlySet<string>,
): AiEvaluationStatement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STATEMENTS) {
    throw new AiEvaluationResponseInvalidError();
  }
  return value.map((item) => normalizeStatement(item, validEvidenceIds));
}

function normalizeEvaluation(raw: unknown, validEvidenceIds: ReadonlySet<string>): AiMonthlyEvaluation {
  const record = asRecord(raw);
  return {
    summary: normalizeStatement(record['summary'], validEvidenceIds),
    highlights: normalizeStatementList(record['highlights'], validEvidenceIds),
    risks: normalizeStatementList(record['risks'], validEvidenceIds),
    suggestions: normalizeStatementList(record['suggestions'], validEvidenceIds),
  };
}

export class MonthlyEvaluationService {
  constructor(
    private readonly db: Db,
    private readonly config: AiConfigService,
    private readonly provider: AiProviderService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private facts(nowMs: number): { readonly period: AiMonthlyPeriod; readonly facts: AiMonthlyFacts } {
    // Freeze the clock for every projection in this request so a midnight rollover cannot
    // combine one month's categories with the next month's trend or budget snapshot.
    const stats = new StatsService(this.db, { now: () => nowMs });
    const budgetService = new BudgetOverviewService(this.db, { now: () => nowMs });
    const monthStart = startOfMonthOf(nowMs);
    const to = monthStartOffset(nowMs, 1);
    const period: AiMonthlyPeriod = {
      month: monthLabel(monthStart),
      monthStart,
      from: monthStart,
      to,
    };

    const current = stats.monthlyTrend(1)[0] ?? {
      month: period.month,
      monthStart,
      incomeCents: 0,
      netExpenseCents: 0,
    };
    const share = stats.categoryShare(monthStart, to);
    const trend = stats.monthlyTrend(6).map((point) => ({
      evidenceId: `trend.${point.month}`,
      ...point,
    }));
    const budgetOverview = budgetService.overview();
    const budgetPeriods = budgetService.periods();
    const budget = buildBudgetFacts(budgetOverview, budgetPeriods.currentPeriodStart);

    const facts: AiMonthlyFacts = {
      monthly: {
        incomeCents: current.incomeCents,
        netExpenseCents: current.netExpenseCents,
        incomeEvidenceId: 'monthly.income',
        expenseEvidenceId: 'monthly.expense',
      },
      categories: share.items.map((item) => ({
        evidenceId: `category.${item.categoryId}`,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        amountCents: item.amountCents,
        ratio: item.ratio,
      })),
      trend,
      budget,
    };
    return { period, facts };
  }

  async evaluate(): Promise<AiMonthlyEvaluationResult> {
    const nowMs = this.now();
    const stored = this.config.getStoredOrThrow();
    const secret = this.config.getSecretOrThrow(stored);
    const { period, facts } = this.facts(nowMs);
    const context: AiPromptContext = {
      input: '请评价当前自然月的记账情况。',
      categories: [],
      accounts: [],
      model: stored.model,
      today: todayLabel(nowMs),
      responseSchema: EVALUATION_RESPONSE_SCHEMA,
      feature: 'monthly-evaluation',
      facts: { period, facts },
    };
    let raw: unknown;
    try {
      raw = await this.provider.complete(stored, secret, context);
    } catch (error) {
      if (error instanceof AiResponseInvalidError) {
        throw new AiEvaluationResponseInvalidError();
      }
      throw error;
    }
    return {
      period,
      facts,
      evaluation: normalizeEvaluation(raw, collectEvidenceIds(facts)),
    };
  }
}
