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
  BudgetOverview,
  BudgetTemplate,
  SalaryRecord,
  TemplateModule,
} from '../api/client.js';

export const useBudgetStore = defineStore('budget', () => {
  const overview = ref<BudgetOverview | null>(null);
  const salaries = ref<SalaryRecord[]>([]);
  const templates = ref<BudgetTemplate[]>([]);
  const cycleStartDay = ref<number | null>(null);

  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  /** Modules with worse-than-100% usage, for the "over budget" section. */
  const overBudgetModules = computed(() =>
    (overview.value?.modules ?? []).filter(
      (module) => module.spentCents > module.budgetCents,
    ),
  );

  /** Pool is negative when the current cycle borrowed from it. */
  const poolIsNegative = computed(() => (overview.value?.carryoverPoolCents ?? 0) < 0);

  /** Overall usage ratio, 0 when nothing is budgeted. */
  const usedRatio = computed(() => {
    const total = overview.value?.totalBudgetCents ?? 0;
    if (total <= 0) return 0;
    return (overview.value?.totalSpentCents ?? 0) / total;
  });

  const defaultTemplate = computed(
    () => templates.value.find((template) => template.isDefault) ?? templates.value[0],
  );

  async function loadOverview(): Promise<void> {
    try {
      overview.value = await api.budget.overview();
    } catch (error) {
      if (!(error instanceof ApiError && error.isUnauthorized)) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
      }
    }
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
      await loadOverview();
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
      await Promise.all([loadSalaries(), loadOverview()]);
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
    loading,
    errorMessage,
    overBudgetModules,
    poolIsNegative,
    usedRatio,
    defaultTemplate,
    loadAll,
    loadOverview,
    loadSalaries,
    loadTemplates,
    loadSettings,
    setCycleStartDay,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
    deleteSalary,
  };
});
