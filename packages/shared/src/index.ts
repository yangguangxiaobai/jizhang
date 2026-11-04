/**
 * @jizhang/shared — domain types and pure functions used by both the Fastify
 * server and the Vue app (parent task design.md §2).
 *
 * T1 scope: package skeleton only. The budget engine (`budget-engine.ts`),
 * money helpers (`money.ts`), period maths (`period.ts`) and domain types
 * (`types.ts`) land in T5/T2 — nothing here may touch the filesystem, the
 * network or any Node/DOM global, so the same code runs in the browser.
 */

/** Package identifier, handy in health payloads and log lines while wiring things up. */
export const SHARED_PACKAGE_NAME = '@jizhang/shared';

/**
 * Placeholder export. It exists so `tsc` emits a real module (and so the
 * workspace link is exercisable) before the domain code arrives in T5.
 */
export const SHARED_PLACEHOLDER = 'T1 skeleton — domain logic lands in T5';

// ---------------------------------------------------------------------------
// T5：信封预算引擎与领域类型
// ---------------------------------------------------------------------------

export * from './types.js';
export * from './date-utils.js';
export * from './budget-engine.js';
export * from './budget-context.js';
export * from './recurring.js';
export * from './csv.js';
export * from './palette.js';
export * from './seed-data.js';
export * from './account-balance.js';
export * from './manual-goal-progress.js';
export * from './platform-bills.js';
export * from './financial-plan.js';
export * from './monthly-plan.js';
export * from './financial-execution.js';
export * from './fund-budget.js';
export * from './stats-window.js';
