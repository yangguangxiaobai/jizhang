import { describe, expect, it } from 'vitest';
import { normalizeBillRecommendations } from '../src/services/bill-import-analysis.js';

const rows = [{ id: 'wx-1', type: 0 }, { id: 'wx-2', type: 1 }];
const categories = [{ id: 'expense', type: 0 }, { id: 'income', type: 1 }];
const valid = () => ({ recommendations: [
  { id: 'wx-1', include: false, reason: 'Review purchase', categoryId: 'expense' },
  { id: 'wx-2', include: true, reason: 'Actual refund', categoryId: 'income' },
] });
describe('bill import advisory boundary', () => {
  it('accepts one bounded advisory decision per known row', () => {
    expect(normalizeBillRecommendations(valid(), rows, categories)).toHaveLength(2);
  });
  it('rejects invented, duplicate, omitted, mismatched category and financial override output', () => {
    const cases: unknown[] = [null, {}, { recommendations: [] }];
    const unknown = valid(); unknown.recommendations[0]!.id = 'invented'; cases.push(unknown);
    const duplicate = valid(); duplicate.recommendations[1]!.id = 'wx-1'; cases.push(duplicate);
    const wrongType = valid(); wrongType.recommendations[0]!.categoryId = 'income'; cases.push(wrongType);
    const tooLong = valid(); tooLong.recommendations[0]!.reason = 'a'.repeat(301); cases.push(tooLong);
    const extra = valid(); cases.push({ recommendations: [{ ...extra.recommendations[0], amountCents: 1 }, extra.recommendations[1]] });
    for (const value of cases) expect(() => normalizeBillRecommendations(value, rows, categories)).toThrow();
  });
});
