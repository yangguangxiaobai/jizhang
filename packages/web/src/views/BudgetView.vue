<script setup lang="ts">
/**
 * Budget overview: each envelope's progress, plus the carryover pool.
 *
 * Every number here comes from the server's engine, so what the user sees matches
 * the salary page and (later) the charts for the same period.
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useBudgetStore } from '../stores/budget.js';
import { formatYuan } from '../utils/money.js';

const budget = useBudgetStore();
const router = useRouter();

onMounted(() => {
  void budget.loadAll();
});

/** Progress bar width, capped so an overspent module does not overflow its track. */
function barWidth(spentCents: number, budgetCents: number): string {
  if (budgetCents <= 0) return spentCents > 0 ? '100%' : '0%';
  return `${Math.min(100, Math.round((spentCents / budgetCents) * 100))}%`;
}

function usedPercent(spentCents: number, budgetCents: number): number {
  if (budgetCents <= 0) return spentCents > 0 ? 100 : 0;
  return Math.round((spentCents / budgetCents) * 100);
}

const cycleLabel = computed(() => {
  const cycle = budget.overview?.cycle;
  if (cycle === undefined || cycle === null) return '';
  return cycle.kind === 'natural-month'
    ? '自然月周期'
    : `每月 ${cycle.day} 号起算`;
});

const poolLabel = computed(() =>
  formatYuan(budget.overview?.carryoverPoolCents ?? 0),
);
</script>

<template>
  <p v-if="budget.loading && budget.overview === null" class="muted">加载中…</p>

  <template v-else>
    <section v-if="!budget.overview?.hasBudget" class="empty card">
      <h2>还没有预算周期</h2>
      <p>记一次工资，系统会按模板比例自动分配各模块预算。</p>
      <button type="button" @click="router.push({ name: 'salary-new' })">记工资</button>
    </section>

    <template v-else>
      <section class="summary card">
        <div class="row">
          <span class="label">本周期预算</span>
          <strong>{{ formatYuan(budget.overview.totalBudgetCents) }}</strong>
        </div>
        <div class="row">
          <span class="label">已用</span>
          <strong>{{ formatYuan(budget.overview.totalSpentCents) }}</strong>
        </div>
        <div class="row">
          <span class="label">剩余</span>
          <strong
            :class="{
              negative: budget.overview.totalBudgetCents - budget.overview.totalSpentCents < 0,
            }"
          >
            {{ formatYuan(budget.overview.totalBudgetCents - budget.overview.totalSpentCents) }}
          </strong>
        </div>
        <p class="cycle">{{ cycleLabel }}</p>
      </section>

      <section class="pool card" :class="{ borrowed: budget.poolIsNegative }">
        <div>
          <span class="label">累积结余池</span>
          <strong :class="{ negative: budget.poolIsNegative }">{{ poolLabel }}</strong>
        </div>
        <p class="hint">
          <template v-if="budget.poolIsNegative">
            本周期超支，已从结余池借用。
          </template>
          <template v-else>
            历史周期未用完的额度会累积到这里，超支时可借用。
          </template>
        </p>
      </section>

      <section v-if="budget.overBudgetModules.length > 0" class="alert">
        有 {{ budget.overBudgetModules.length }} 个模块超支
      </section>

      <ul class="modules">
        <li v-for="module in budget.overview.modules" :key="module.categoryId">
          <div class="module-head">
            <span class="name">{{ module.categoryName }}</span>
            <span class="figures">
              <strong :class="{ negative: module.remainingCents < 0 }">
                {{ formatYuan(module.remainingCents) }}
              </strong>
              <small>
                {{ formatYuan(module.spentCents) }} / {{ formatYuan(module.budgetCents) }}
              </small>
            </span>
          </div>

          <div
            class="track"
            role="progressbar"
            :aria-valuenow="usedPercent(module.spentCents, module.budgetCents)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${module.categoryName} 已用比例`"
          >
            <span
              class="fill"
              :class="{ over: module.spentCents > module.budgetCents }"
              :style="{ width: barWidth(module.spentCents, module.budgetCents) }"
            />
          </div>

          <small class="percent">
            已用 {{ usedPercent(module.spentCents, module.budgetCents) }}%
          </small>
        </li>
      </ul>

      <div class="actions">
        <button type="button" @click="router.push({ name: 'salary-new' })">记工资</button>
        <button
          type="button"
          class="ghost"
          @click="router.push({ name: 'salary-records' })"
        >
          工资记录
        </button>
        <button
          type="button"
          class="ghost"
          @click="router.push({ name: 'templates' })"
        >
          分配模板
        </button>
      </div>
    </template>
  </template>
</template>

<style scoped>
.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

.summary .row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.3rem 0;
}

.summary strong {
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}

.label {
  color: var(--muted);
  font-size: 0.85rem;
}

.cycle {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.pool {
  display: grid;
  gap: 0.35rem;
  border-left: 3px solid var(--accent);
}

.pool.borrowed {
  border-left-color: var(--danger);
}

.pool > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.pool strong {
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--danger);
}

.hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--muted);
}

.alert {
  padding: 0.6rem 0.85rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 0.6rem;
}

.modules {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.modules li {
  padding: 0.75rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.module-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.name {
  font-size: 0.95rem;
}

.figures {
  display: grid;
  justify-items: end;
  gap: 0.1rem;
}

.figures strong {
  font-variant-numeric: tabular-nums;
}

.figures small {
  font-size: 0.72rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.track {
  height: 8px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.2s ease;
}

.fill.over {
  background: var(--danger);
}

.percent {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: var(--muted);
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions button:first-child {
  grid-column: 1 / -1;
}

.actions button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.empty {
  text-align: center;
}

.empty h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}

.empty p {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.empty button {
  min-height: 44px;
  padding: 0 1.25rem;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.muted {
  color: var(--muted);
}
</style>
