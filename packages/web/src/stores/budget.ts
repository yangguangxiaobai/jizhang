/**
 * Budget state: the overview, salaries, templates and the cycle setting.
 *
 * The module views and the carryover pool are computed by the server (which owns
 * the engine), so this store only caches them — it never re-derives a total. That
 * keeps a single source of truth for net expense and for the pool.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, api } from '../api/client.js';
import type {
  ApplyTemplateResult,
  BudgetOverview,
  BudgetTemplate,
  SalaryRecord,
  TemplateModule,
} from '../api/client.js';
import { budgetTone } from '../utils/budget-tone.js';

export const useBudgetStore = defineStore('budget', () => {
  const overview = ref<BudgetOverview | null>(null);
  const salaries = ref<SalaryRecord[]>([]);
  const templates = ref<BudgetTemplate[]>([]);
  const cycleStartDay = ref<number | null>(null);

  /** Cycle starts that can be reviewed, ascending. */
  const periods = ref<number[]>([]);
  /** The newest cycle, as the server reports it. */
  const currentPeriodStart = ref<number | null>(null);
  /** `null` = follow the current cycle; a number = reviewing that cycle. */
  const selectedPeriodStart = ref<number | null>(null);
  /** Overviews of historical cycles, keyed by period start. Never includes the current one. */
  const historicalOverviews = ref<Map<number, BudgetOverview>>(new Map());

  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  /** True when the user is looking at a past cycle rather than the live one. */
  const viewingHistory = computed(
    () =>
      selectedPeriodStart.value !== null && selectedPeriodStart.value !== currentPeriodStart.value,
  );

  /**
   * The overview to render.
   *
   * The current cycle always comes from `overview` — the live fetch — so it can never be
   * a stale cached copy while its data is still moving.
   */
  const displayedOverview = computed<BudgetOverview | null>(() => {
    if (!viewingHistory.value) return overview.value;
    const period = selectedPeriodStart.value;
    return period === null ? overview.value : (historicalOverviews.value.get(period) ?? null);
  });

  /** Modules with worse-than-100% usage, for the "over budget" section. */
  const overBudgetModules = computed(() =>
    (displayedOverview.value?.modules ?? []).filter(
      (module) => module.spentCents > module.budgetCents,
    ),
  );

  /**
   * Modules in the warning band: nearly spent but not over. Same source as the list above
   * (the server's module views), so the two sections can never disagree about a module.
   */
  const nearLimitModules = computed(() =>
    (displayedOverview.value?.modules ?? []).filter(
      (module) => budgetTone(module.spentCents, module.budgetCents) === 'warning',
    ),
  );

  /** Pool is negative when the shown cycle borrowed from it. */
  const poolIsNegative = computed(() => (displayedOverview.value?.carryoverPoolCents ?? 0) < 0);

  /** Overall usage ratio, 0 when nothing is budgeted. */
  const usedRatio = computed(() => {
    const total = displayedOverview.value?.totalBudgetCents ?? 0;
    if (total <= 0) return 0;
    return (displayedOverview.value?.totalSpentCents ?? 0) / total;
  });

  const defaultTemplate = computed(
    () => templates.value.find((template) => template.isDefault) ?? templates.value[0],
  );

  /** Hides or disables the switcher when there is nothing to switch between. */
  const canReviewHistory = computed(() => periods.value.length > 1);

  async function loadOverview(): Promise<void> {
    try {
      overview.value = await api.budget.overview();
    } catch (error) {
      if (!(error instanceof ApiError && error.isUnauthorized)) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
      }
    }
  }

  async function loadPeriods(): Promise<void> {
    try {
      const result = await api.budget.periods();
      periods.value = result.periods;
      currentPeriodStart.value = result.currentPeriodStart;
      // A period that vanished (its only salary was deleted) must not stay selected.
      if (
        selectedPeriodStart.value !== null &&
        !result.periods.includes(selectedPeriodStart.value)
      ) {
        selectedPeriodStart.value = null;
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  /** Switches the budget page between the live cycle and a past one. */
  async function selectPeriod(periodStart: number | null): Promise<void> {
    errorMessage.value = null;
    if (periodStart === null || periodStart === currentPeriodStart.value) {
      selectedPeriodStart.value = null;
      return;
    }
    selectedPeriodStart.value = periodStart;

    if (historicalOverviews.value.has(periodStart)) return;
    try {
      const fetched = await api.budget.overview(periodStart);
      // Reassign so the computed's dependency on the Map is observed: a Map is not
      // deeply reactive in Vue 3.
      const next = new Map(historicalOverviews.value);
      next.set(periodStart, fetched);
      historicalOverviews.value = next;
    } catch (error) {
      // A failed history fetch must not leave the page claiming a cycle it cannot show.
      selectedPeriodStart.value = null;
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  /** Drops cached history so the next visit refetches. */
  function invalidateHistory(): void {
    historicalOverviews.value = new Map();
  }

  async function loadSalaries(): Promise<void> {
    try {
      salaries.value = (await api.salaries.list()).items;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadTemplates(): Promise<void> {
    try {
      templates.value = (await api.templates.list()).items;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadSettings(): Promise<void> {
    try {
      cycleStartDay.value = (await api.settings.get()).cycleStartDay;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  /** Everything the budget and salary pages need, in one round trip. */
  async function loadAll(): Promise<void> {
    loading.value = true;
    errorMessage.value = null;
    try {
      await Promise.all([
        loadOverview(),
        loadPeriods(),
        loadSalaries(),
        loadTemplates(),
        loadSettings(),
      ]);
    } finally {
      loading.value = false;
    }
  }

  async function setCycleStartDay(day: number | null): Promise<boolean> {
    errorMessage.value = null;
    try {
      const result = await api.settings.setCycleStartDay(day);
      cycleStartDay.value = result.cycleStartDay;
      // The cycle definition changed, so every period boundary did too.
      invalidateHistory();
      selectedPeriodStart.value = null;
      await Promise.all([loadOverview(), loadPeriods()]);
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function createTemplate(
    name: string,
    modules: TemplateModule[],
    isDefault = false,
  ): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.templates.create(name, modules, isDefault);
      await loadTemplates();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function updateTemplate(
    id: string,
    changes: { name?: string; modules?: TemplateModule[] },
  ): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.templates.update(id, changes);
      await loadTemplates();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function applyTemplateToCurrentCycle(id: string): Promise<ApplyTemplateResult | null> {
    errorMessage.value = null;
    try {
      const result = await api.templates.applyToCurrent(id);
      invalidateHistory();
      selectedPeriodStart.value = null;
      await Promise.all([loadOverview(), loadSalaries(), loadPeriods()]);
      return result;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
  async function deleteTemplate(id: string): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.templates.remove(id);
      await loadTemplates();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function setDefaultTemplate(id: string): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.templates.setDefault(id);
      await loadTemplates();
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function deleteSalary(id: string): Promise<boolean> {
    errorMessage.value = null;
    try {
      await api.salaries.remove(id);
      // Removing a salary can remove the only allocation of a cycle, so the period list
      // and the cached history are both stale.
      invalidateHistory();
      await Promise.all([loadSalaries(), loadOverview(), loadPeriods()]);
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  return {
    overview,
    salaries,
    templates,
    cycleStartDay,
    periods,
    currentPeriodStart,
    selectedPeriodStart,
    historicalOverviews,
    viewingHistory,
    displayedOverview,
    canReviewHistory,
    loading,
    errorMessage,
    overBudgetModules,
    nearLimitModules,
    poolIsNegative,
    usedRatio,
    defaultTemplate,
    loadAll,
    loadOverview,
    loadPeriods,
    selectPeriod,
    invalidateHistory,
    loadSalaries,
    loadTemplates,
    loadSettings,
    setCycleStartDay,
    createTemplate,
    updateTemplate,
    applyTemplateToCurrentCycle,
    deleteTemplate,
    setDefaultTemplate,
    deleteSalary,
  };
});
