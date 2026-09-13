/**
 * The tone of an envelope's progress bar: how much of the budget is gone, in three steps.
 *
 * ## Presentation, not accounting
 *
 * This file draws a line at 80%. It is the one number on the client that is not fetched,
 * and it is allowed here because it is not a figure: the spent and budget amounts come from
 * the server's module view, and `budgetTone` only decides which colour the bar wears. The
 * rule that the client renders and does not compute is about money; a threshold for a
 * colour is a design constant, like a breakpoint.
 *
 * The three tones are the three rungs the bar can take — accent, warning, danger — and each
 * is always paired with a word on screen ("接近上限", "已超支") so the state is never carried
 * by colour alone.
 */

/** Share of an envelope that counts as "nearly spent". */
export const NEAR_LIMIT_RATIO = 0.8;

export type BudgetTone = 'normal' | 'warning' | 'over';

/**
 * `over` above the budget, `warning` from `NEAR_LIMIT_RATIO` up to and including it,
 * `normal` below. A module with no budget is `over` as soon as anything is spent, matching
 * `barRatio` in the budget view.
 */
export function budgetTone(spentCents: number, budgetCents: number): BudgetTone {
  if (budgetCents <= 0) return spentCents > 0 ? 'over' : 'normal';
  if (spentCents > budgetCents) return 'over';
  if (spentCents >= budgetCents * NEAR_LIMIT_RATIO) return 'warning';
  return 'normal';
}

/** The word that accompanies the tone, or `null` when the bar needs none. */
export function budgetToneLabel(tone: BudgetTone): string | null {
  if (tone === 'over') return '已超支';
  if (tone === 'warning') return '接近上限';
  return null;
}
