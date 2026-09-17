/**
 * First-run seed data: preset categories, the default account, and the default
 * allocation template.
 *
 * ## Why these exact values
 *
 * The names, ids, icons, order and template ratios are transcribed **verbatim** from
 * the reference Flutter implementation (`lib/core/seed_service.dart`) so the two apps
 * describe the same bookkeeping model.
 *
 * The **colours are the one deliberate divergence.** The reference palette was twelve
 * low-chroma browns and mauves that could not be told apart in a donut chart and had no
 * dark-theme variant; the seed now takes its colours from `palette.ts` by slot (expenses
 * 1–6, income 7–8), which the build validates for separation and contrast. The reference
 * integers are still recognised — see `LEGACY_CATEGORY_PALETTE` — so a database seeded
 * with them renders in the new palette without a migration.
 *
 * ## Stable ids
 *
 * Category ids follow `builtin-<expense|income>-<icon>` and the template/account
 * ids are fixed constants. Stable ids are what make seeding idempotent: seeding
 * twice merges onto the same rows instead of creating "same name, different id"
 * duplicates (see the reference project's `test/seed_dedup_test.dart`).
 *
 * This module is pure data — no IO — so both the server (seeding) and the web app
 * (rendering a category before the server answers) can import it.
 */

import { paletteSlot } from './palette.js';

/** Transaction / category type discriminants, mirroring the reference model. */
export const CATEGORY_TYPE_EXPENSE = 0;
export const CATEGORY_TYPE_INCOME = 1;

/** Account kind discriminants. */
export const ACCOUNT_TYPE_CASH = 0;
export const ACCOUNT_TYPE_DEBIT_CARD = 1;
export const ACCOUNT_TYPE_CREDIT_CARD = 2;
export const ACCOUNT_TYPE_ALIPAY = 3;
export const ACCOUNT_TYPE_WECHAT = 4;
export const ACCOUNT_TYPE_OTHER = 5;

/** Stable id of the default account (never deletable; all seed rows point at it). */
export const BUILTIN_DEFAULT_ACCOUNT_ID = 'builtin-default-account';

/** Stable id of the default allocation template. */
export const BUILTIN_DEFAULT_TEMPLATE_ID = 'builtin-default-template';

/**
 * The `updatedAt` stamped on freshly seeded rows.
 *
 * Deliberately `1`, not "now" — transcribed from `seed_service.dart:24-28`, whose
 * comment explains why: any real user edit necessarily has a larger timestamp, so
 * a fresh install's seed data can never win over an existing rename. This project
 * has no sync yet (parent task D4), but keeping the convention costs nothing and
 * keeps a future sync layer correct from day one.
 */
export const SEED_UPDATED_AT_MS = 1;

export interface SeedCategory {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  /** Semantic short name (`food`, `transport`, …), not a Material icon id. */
  readonly icon: string;
  /** ARGB integer; a `palette.ts` slot for the seeded rows. */
  readonly color: number;
  readonly sortOrder: number;
}

export interface SeedAccount {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  readonly sortOrder: number;
}

export interface SeedTemplateModule {
  readonly categoryId: string;
  /** Share of the salary, as a fraction (`0.4` = 40%). */
  readonly ratio: number;
}

export interface SeedTemplate {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly modules: readonly SeedTemplateModule[];
}

/** Six preset expense categories (`seed_service.dart:33-40`), palette slots 1–6. */
export const SEED_EXPENSE_CATEGORIES: readonly SeedCategory[] = [
  { id: 'builtin-expense-food', name: '餐饮', type: CATEGORY_TYPE_EXPENSE, icon: 'food', color: paletteSlot(1).argb, sortOrder: 0 },
  { id: 'builtin-expense-transport', name: '交通', type: CATEGORY_TYPE_EXPENSE, icon: 'transport', color: paletteSlot(2).argb, sortOrder: 1 },
  { id: 'builtin-expense-housing', name: '住房', type: CATEGORY_TYPE_EXPENSE, icon: 'housing', color: paletteSlot(3).argb, sortOrder: 2 },
  { id: 'builtin-expense-shopping', name: '购物', type: CATEGORY_TYPE_EXPENSE, icon: 'shopping', color: paletteSlot(4).argb, sortOrder: 3 },
  { id: 'builtin-expense-entertainment', name: '娱乐', type: CATEGORY_TYPE_EXPENSE, icon: 'entertainment', color: paletteSlot(5).argb, sortOrder: 4 },
  { id: 'builtin-expense-other', name: '其他', type: CATEGORY_TYPE_EXPENSE, icon: 'other', color: paletteSlot(6).argb, sortOrder: 5 },
];

/** Three preset income categories — 工资/其他收入 transcribed from the reference app
 * (`seed_service.dart:43-46`), palette slots 7–8. 「退款」 is the one deliberate
 * addition, NOT transcribed from the reference app: refunds are income-typed
 * transactions (see `transaction-service.ts`), and every migrated legacy refund row
 * is filed under this category. Palette slot 9. */
export const SEED_INCOME_CATEGORIES: readonly SeedCategory[] = [
  { id: 'builtin-income-salary', name: '工资', type: CATEGORY_TYPE_INCOME, icon: 'salary', color: paletteSlot(7).argb, sortOrder: 0 },
  { id: 'builtin-income-other', name: '其他收入', type: CATEGORY_TYPE_INCOME, icon: 'other', color: paletteSlot(8).argb, sortOrder: 1 },
  { id: 'builtin-income-refund', name: '退款', type: CATEGORY_TYPE_INCOME, icon: 'refund', color: paletteSlot(9).argb, sortOrder: 2 },
];

/** All preset categories, expense first. */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  ...SEED_EXPENSE_CATEGORIES,
  ...SEED_INCOME_CATEGORIES,
];

/** The single default account every seeded/legacy transaction belongs to. */
export const SEED_ACCOUNT: SeedAccount = {
  id: BUILTIN_DEFAULT_ACCOUNT_ID,
  name: '默认账户',
  type: ACCOUNT_TYPE_CASH,
  initialBalanceCents: 0,
  sortOrder: 0,
};

/**
 * Default allocation template (`seed_service.dart:133-139`).
 *
 * Ratios sum to exactly `1.0` (verified as a float sum, no accumulated error).
 * The **order is meaningful**: the salary-allocation algorithm makes the *last*
 * module absorb the rounding remainder, so reordering these entries changes the
 * amounts a user sees. See `research/reference-project-rules.md` §10.1.
 */
export const SEED_TEMPLATE: SeedTemplate = {
  id: BUILTIN_DEFAULT_TEMPLATE_ID,
  name: '默认模板',
  isDefault: true,
  modules: [
    { categoryId: 'builtin-expense-food', ratio: 0.4 },
    { categoryId: 'builtin-expense-transport', ratio: 0.1 },
    { categoryId: 'builtin-expense-housing', ratio: 0.25 },
    { categoryId: 'builtin-expense-shopping', ratio: 0.1 },
    { categoryId: 'builtin-expense-entertainment', ratio: 0.05 },
    { categoryId: 'builtin-expense-other', ratio: 0.1 },
  ],
};

/**
 * Allocates an integer-cent salary across template ratios.
 *
 * Transcribed from `salary_entry_page.dart:131-153`:
 * every module except the **last** is `round(total * ratio)`, and the last module
 * receives `total − assigned`, so the parts always sum to exactly `total`.
 *
 * ⚠️ Known edge (kept for behavioural fidelity, see research §10.4): when the
 * remainder the last module absorbs is `<= 0` — tiny salaries or extreme ratios —
 * the result contains a non-positive amount, which the allocation validator
 * rejects. That matches the reference implementation; do not "fix" it here
 * without deciding to diverge.
 */
export function allocateSalaryCents(
  totalCents: number,
  modules: readonly SeedTemplateModule[],
): { categoryId: string; amountCents: number }[] {
  const result: { categoryId: string; amountCents: number }[] = [];
  let assigned = 0;

  for (let i = 0; i < modules.length; i += 1) {
    const module = modules[i];
    if (module === undefined) continue;

    if (i === modules.length - 1) {
      result.push({
        categoryId: module.categoryId,
        amountCents: totalCents - assigned,
      });
    } else {
      const amountCents = Math.round(totalCents * module.ratio);
      result.push({ categoryId: module.categoryId, amountCents });
      assigned += amountCents;
    }
  }

  return result;
}

/** Sum of a template's ratios; the validator accepts `|sum − 1| < 1e-4`. */
export function templateRatioSum(
  modules: readonly SeedTemplateModule[],
): number {
  return modules.reduce((sum, module) => sum + module.ratio, 0);
}

/** Ratio-sum tolerance, transcribed from `salary_entry_page.dart:206`. */
export const RATIO_SUM_TOLERANCE = 0.0001;
