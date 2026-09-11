<script setup lang="ts">
/**
 * Dependency-free grouped bar chart (income vs net expense per month).
 *
 * Hand-rolled for the same reason as `DonutChart.vue`: two chart shapes do not
 * justify a library on a phone bundle. It also has to render NEGATIVE net expense
 * (a month where refunds exceeded spending) without inverting the axis, which is
 * easy to control here and awkward to discover inside a library.
 */
import { computed } from 'vue';

export interface BarGroup {
  /** Axis label, e.g. `2026-08`. */
  readonly label: string;
  readonly incomeCents: number;
  readonly netExpenseCents: number;
}

const props = withDefaults(
  defineProps<{
    groups: readonly BarGroup[];
    height?: number;
  }>(),
  { height: 160 },
);

/** Internal viewBox geometry; the SVG scales to its container. */
const WIDTH = 320;
const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
const plotHeight = computed(() => props.height - PAD_TOP - PAD_BOTTOM);

/**
 * Scale bounds.
 *
 * The baseline is 0 and the extremes cover BOTH series, so a refund-heavy month
 * (negative net expense) is drawn below the baseline rather than clamped to it.
 */
const bounds = computed(() => {
  let max = 0;
  let min = 0;
  for (const group of props.groups) {
    max = Math.max(max, group.incomeCents, group.netExpenseCents);
    min = Math.min(min, group.incomeCents, group.netExpenseCents);
  }
  // Include 0 so the baseline is always inside the plot.
  max = Math.max(max, 0);
  min = Math.min(min, 0);
  // A flat all-zero series would divide by zero; give it a nominal range.
  if (max === min) max = min + 1;
  return { max, min };
});

/** Y coordinate for a value, in viewBox units. */
function y(value: number): number {
  const { max, min } = bounds.value;
  const span = max - min;
  const ratio = (value - min) / span;
  // SVG y grows downward; flip it.
  return PAD_TOP + (1 - ratio) * plotHeight.value;
}

const zeroY = computed(() => y(0));

const slotWidth = computed(() =>
  props.groups.length === 0 ? plotWidth : plotWidth / props.groups.length,
);

/** Each group draws two bars side by side inside its slot. */
const barWidth = computed(() => Math.max(3, Math.min(16, slotWidth.value * 0.32)));

interface RenderedBar {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly className: string;
  readonly title: string;
}

const bars = computed<RenderedBar[]>(() => {
  const out: RenderedBar[] = [];
  const baseline = zeroY.value;

  props.groups.forEach((group, index) => {
    const slotStart = PAD_LEFT + index * slotWidth.value;
    const center = slotStart + slotWidth.value / 2;

    const entries: { value: number; kind: string }[] = [
      { value: group.incomeCents, kind: 'income' },
      { value: group.netExpenseCents, kind: 'expense' },
    ];

    entries.forEach((entry, entryIndex) => {
      const valueY = y(entry.value);
      const top = Math.min(valueY, baseline);
      const barHeight = Math.max(1, Math.abs(valueY - baseline));
      const x =
        center -
        (barWidth.value * entries.length) / 2 +
        entryIndex * barWidth.value;

      out.push({
        key: `${group.label}-${entry.kind}`,
        x: Number(x.toFixed(2)),
        y: Number(top.toFixed(2)),
        height: Number(barHeight.toFixed(2)),
        className: entry.kind,
        title: `${group.label} ${entry.kind === 'income' ? '收入' : '净支出'} ${(entry.value / 100).toFixed(2)}`,
      });
    });
  });

  return out;
});

/** Label every Nth group so the axis does not collide on a narrow phone screen. */
const labelStep = computed(() => (props.groups.length > 6 ? 2 : 1));

function shortLabel(label: string): string {
  // `2026-08` -> `8月`
  const parts = label.split('-');
  const month = parts[1];
  return month === undefined ? label : `${Number(month)}月`;
}
</script>

<template>
  <svg
    :viewBox="`0 0 ${WIDTH} ${height}`"
    class="bars"
    role="img"
    aria-label="月度收支趋势"
  >
    <!-- baseline -->
    <line
      :x1="PAD_LEFT"
      :x2="WIDTH - PAD_RIGHT"
      :y1="zeroY"
      :y2="zeroY"
      class="baseline"
    />

    <rect
      v-for="bar in bars"
      :key="bar.key"
      :x="bar.x"
      :y="bar.y"
      :width="barWidth"
      :height="bar.height"
      :class="['bar', bar.className]"
    >
      <title>{{ bar.title }}</title>
    </rect>

    <text
      v-for="(group, index) in groups"
      v-show="index % labelStep === 0"
      :key="`label-${group.label}`"
      :x="PAD_LEFT + index * slotWidth + slotWidth / 2"
      :y="height - 5"
      class="axis-label"
      text-anchor="middle"
    >
      {{ shortLabel(group.label) }}
    </text>
  </svg>

  <ul class="legend">
    <li><span class="swatch income" aria-hidden="true" />收入</li>
    <li><span class="swatch expense" aria-hidden="true" />净支出</li>
  </ul>
</template>

<style scoped>
.bars {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.baseline {
  stroke: var(--border);
  stroke-width: 1;
}

.bar {
  rx: 1.5;
}

.bar.income {
  fill: var(--ok, #3f9e6a);
}

.bar.expense {
  fill: var(--accent);
}

.axis-label {
  font-size: 9px;
  fill: var(--muted);
}

.legend {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  gap: 1rem;
  font-size: 0.78rem;
  color: var(--muted);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 0.15rem;
}

.swatch.income {
  background: var(--ok, #3f9e6a);
}

.swatch.expense {
  background: var(--accent);
}
</style>
