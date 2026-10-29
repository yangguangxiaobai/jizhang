/** Advisory-only normalization. The model has no financial-fact or write authority. */
import { AiResponseInvalidError } from './ai-types.js';

export interface BillRecommendation {
  readonly id: string;
  readonly include: boolean;
  readonly reason: string;
  readonly categoryId: string | null;
}
export interface BillAnalysisRow { readonly id: string; readonly type: number }
export interface BillAnalysisCategory { readonly id: string; readonly type: number }

export function normalizeBillRecommendations(raw: unknown, rows: readonly BillAnalysisRow[], categories: readonly BillAnalysisCategory[]): BillRecommendation[] {
  const fail = (): never => { throw new AiResponseInvalidError(); };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail();
  const object = raw as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object['recommendations']) || object['recommendations'].length !== rows.length) return fail();
  const seen = new Set<string>();
  return object['recommendations'].map((value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 4 || Object.keys(item).some((key) => !['id', 'include', 'reason', 'categoryId'].includes(key))) return fail();
    const { id, include, reason, categoryId } = item;
    const row = rows.find((row) => row.id === id);
    if (typeof id !== 'string' || row === undefined || seen.has(id) || typeof include !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.length > 300) return fail();
    if (categoryId !== null && (typeof categoryId !== 'string' || !categories.some((category) => category.id === categoryId && category.type === row.type))) return fail();
    seen.add(id);
    return { id, include, reason: reason.trim(), categoryId: categoryId as string | null };
  });
}

export const BILL_ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recommendations'],
  properties: { recommendations: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'include', 'reason', 'categoryId'],
    properties: { id: { type: 'string' }, include: { type: 'boolean' }, reason: { type: 'string', maxLength: 300 }, categoryId: { type: ['string', 'null'] } },
  } } },
};
