<script setup lang="ts">
/**
 * Statistics: category share, monthly trend, and the carryover-pool series.
 *
 * Every number is computed by the server from the shared accounting rules, so this
 * view does no aggregation of its own — it only chooses a window and renders. That
 * is what keeps the charts consistent with the budget page (spend is gross — refunds
 * are income, not expense deductions — and the pool series ends where the engine says
 * it does).
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import type {
  CategoryShareResult,
  MonthlyTrendPoint,
  PoolTrendResult,
} from '../api/client.js';
import BarChart from '../components/BarChart.vue';
import DonutChart from '../components/DonutChart.vue';
import type { Slice } from '../components/DonutChart.vue';
import { categoryCssColor } from '../utils/category-color.js';
import { formatYuan, startOfMonth, startOfNextMonth } from '../utils/money.js';

type WindowKind = 'thisMonth' | 'last30' | 'last3Months';

const windowKind = ref<WindowKind>('thisMonth');
const months = ref(6);

const share = ref<CategoryShareResult | null>(null);
const trend = ref<MonthlyTrendPoint[]>([]);
const pool = ref<PoolTrendResult | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

/** `[from, to)` for the selected window, in local time. */
function windowFor(kind: WindowKind): { from: number; to: number } {
  const today = new Date();
  const endOfToday = startOfNextMonth(today.getTime());

  // A lookup rather than a switch: every branch returns, so there is no unreachable
  // fall-through for a linter (or a future reader) to puzzle over.
  const windows: Record<WindowKind, { from: number; to: number }> = {
    thisMonth: { from: startOfMonth(today.getTime()), to: endOfToday },
    last30: { from: today.getTime() - 30 * 86_400_000, to: endOfToday },
    last3Months: {
      from: startOfMonth(new Date(today.getFullYear(), today.getMonth() - 2, 1).getTime()),
      to: endOfToday,
    },
  };

  return windows[kind];
}

const WINDOW_LABELS: Record<WindowKind, string> = {
  thisMonth: '本月',
  last30: '近 30 天',
  last3Months: '近 3 个月',
};

const windowLabel = computed(() => WINDOW_LABELS[windowKind.value]);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    const { from, to } = windowFor(windowKind.value);
    const [shareResult, trendResult, poolResult] = await Promise.all([
      api.stats.categoryShare(from, to),
      api.stats.monthlyTrend(months.value),
      api.stats.poolTrend(),
    ]);
    share.value = shareResult;
    trend.value = trendResult.items;
    pool.value = poolResult;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Positive slices only: the donut cannot draw a negative wedge. */
const positiveSlices = computed<Slice[]>(() =>
  (share.value?.items ?? [])
    .filter((item) => item.amountCents > 0)
    .map((item) => ({
      label: item.categoryName,
      value: item.amountCents,
      amountLabel: formatYuan(item.amountCents),
      // A palette token, so the slice follows the theme; a custom colour passes through.
      color: categoryCssColor(item.color),
    })),
);

const barGroups = computed(() =>
  trend.value.map((point) => ({
    label: point.month,
    incomeCents: point.incomeCents,
    netExpenseCents: point.netExpenseCents,
  })),
);

/** Sparkline geometry for the pool series. */
const poolSeries = computed(() => pool.value?.points ?? []);

const sparkline = computed(() => {
  const points = poolSeries.value;
  if (points.length < 2) return null;

  const width = 300;
  const height = 60;
  const values = points.map((p) => p.poolCents);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (min === max) max = min + 1;

  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / (max - min)) * height;

  return {
    path: points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.poolCents).toFixed(1)}`).join(' '),
    zeroY: y(0).toFixed(1),
    width,
    height,
  };
});

/** Percentage of the window total spent on the top category, for the headline. */
const topCategory = computed(() => {
  const items = share.value?.items ?? [];
  return items.find((item) => item.amountCents > 0);
});
</script>

<template>
  <nav class="windows" aria-label="统计区间">
    <button
      v-for="option in [
        { id: 'thisMonth' as WindowKind, label: '本月' },
        { id: 'last30' as WindowKind, label: '近 30 天' },
        { id: 'last3Months' as WindowKind, label: '近 3 个月' },
      ]"
      :key="option.id"
      type="button"
      :class="{ active: windowKind === option.id }"
      :aria-pressed="windowKind === option.id"
      @click="
        () => {
          windowKind = option.id;
          load();
        }
      "
    >
      {{ option.label }}
    </button>
  </nav>

  <p v-if="loading" class="muted">加载中…</p>
  <p v-else-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

  <template v-else>
    <!-- ── category share ──────────────────────────────────────────────── -->
    <section class="card">
      <header class="card-head">
        <h2>分类占比</h2>
        <span class="muted small">{{ windowLabel }}</span>
      </header>

      <p class="headline">
        净支出 <strong>{{ formatYuan(share?.totalCents ?? 0) }}</strong>
        <template v-if="topCategory">
          · 最高 <strong>{{ topCategory.categoryName }}</strong>
          {{ formatYuan(topCategory.amountCents) }}
        </template>
      </p>

      <DonutChart
        v-if="positiveSlices.length > 0"
        :slices="positiveSlices"
        :size="200"
        :center-value="formatYuan(share?.totalCents ?? 0)"
        center-label="净支出"
      />

      <p v-else class="empty">
        {{ windowLabel }}没有支出记录。
      </p>
    </section>

    <!-- ── monthly trend ───────────────────────────────────────────────── -->
    <section class="card">
      <header class="card-head">
        <h2>月度收支</h2>
        <select v-model.number="months" aria-label="统计月数" @change="load">
          <option :value="3">近 3 个月</option>
          <option :value="6">近 6 个月</option>
          <option :value="12">近 12 个月</option>
        </select>
      </header>

      <BarChart :groups="barGroups" :height="170" />

      <table class="trend-table">
        <thead>
          <tr>
            <th scope="col">月份</th>
            <th scope="col" class="num">收入</th>
            <th scope="col" class="num">净支出</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in [...trend].reverse()" :key="point.month">
            <td>{{ point.month }}</td>
            <td class="num">{{ formatYuan(point.incomeCents) }}</td>
            <td class="num" :class="{ negative: point.netExpenseCents < 0 }">
              {{ formatYuan(point.netExpenseCents) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ── carryover pool ──────────────────────────────────────────────── -->
    <section class="card">
      <header class="card-head">
        <h2>结余池趋势</h2>
      </header>

      <p class="headline">
        当前结余池
        <strong :class="{ negative: (pool?.currentCents ?? 0) < 0 }">
          {{ formatYuan(pool?.currentCents ?? 0) }}
        </strong>
      </p>

      <svg
        v-if="sparkline"
        :viewBox="`0 0 ${sparkline.width} ${sparkline.height}`"
        class="sparkline"
        role="img"
        aria-label="结余池随周期变化"
      >
        <line
          :x1="0"
          :x2="sparkline.width"
          :y1="sparkline.zeroY"
          :y2="sparkline.zeroY"
          class="zero-line"
        />
        <path :d="sparkline.path" class="spark-path" />
      </svg>

      <p v-if="poolSeries.length < 2" class="empty">
        记满两个预算周期后可以看到趋势。
      </p>

      <p class="hint">
        每个点是一个预算周期开始时的余额，末点已包含本周期的超支借用 ——
        与预算页显示的当前结余池一致。
      </p>
    </section>
  </template>
</template>

<style scoped>
.windows {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  padding: 0.25rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.windows button {
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}

.windows button.active {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 600;
}

.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
}

select {
  font-size: 16px;
  /* 44px minimum touch target. */
  min-height: 44px;
  padding: 0.3rem 0.5rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.45rem;
}

.headline {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.headline strong {
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}

.trend-table {
  width: 100%;
  margin-top: 0.75rem;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.trend-table th {
  padding: 0.35rem 0.25rem;
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.trend-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.trend-table td {
  padding: 0.35rem 0.25rem;
  border-bottom: 1px dashed var(--border);
}

.trend-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--danger);
}

.sparkline {
  width: 100%;
  height: auto;
  display: block;
}

.zero-line {
  stroke: var(--border);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.spark-path {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
}

.refund-note {
  margin-top: 0.85rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--border);
}

.refund-note ul {
  list-style: none;
  margin: 0.35rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.refund-note li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.hint {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted);
}

.small {
  font-size: 0.78rem;
}

.negative {
  color: var(--danger);
}

.empty {
  padding: 1.5rem 0.5rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
}

.error {
  color: var(--danger);
}

.muted {
  color: var(--muted);
}
</style>
