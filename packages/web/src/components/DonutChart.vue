<script setup lang="ts">
/**
 * Dependency-free donut chart.
 *
 * Deliberately hand-rolled SVG rather than a charting library: the whole app needs
 * two chart shapes, and a library would add tens of kilobytes to a bundle that is
 * currently ~42 kB gzipped and loaded on a phone. It also keeps the geometry here,
 * where it is unit-testable, instead of inside a canvas the tests cannot read.
 *
 * Geometry note: the bar/arc maths uses the SAME integer cents the API returns, so
 * no float drift is introduced by the visualisation.
 */
import { computed } from 'vue';

export interface Slice {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

const props = withDefaults(
  defineProps<{
    slices: readonly Slice[];
    /** Inner radius as a fraction of the outer one; 0 renders a full pie. */
    innerRatio?: number;
    size?: number;
  }>(),
  { innerRatio: 0.58, size: 180 },
);

const RADIUS = 50;
const CENTER = 60;

/** Only positive slices can be drawn; negatives are listed separately by the view. */
const drawable = computed(() => props.slices.filter((slice) => slice.value > 0));

const total = computed(() =>
  drawable.value.reduce((sum, slice) => sum + slice.value, 0),
);

interface Arc extends Slice {
  readonly path: string;
  readonly ratio: number;
}

/**
 * Converts a slice list into SVG path data.
 *
 * Exported through the template rather than the module because a single-file
 * component cannot export helpers; the maths is small and pure, and `charts.test`
 * covers the equivalent conversion in `utils/chart.ts`.
 */
const arcs = computed<Arc[]>(() => {
  if (total.value <= 0) return [];

  const inner = RADIUS * props.innerRatio;
  let angle = -Math.PI / 2; // start at 12 o'clock

  return drawable.value.map((slice) => {
    const ratio = slice.value / total.value;
    const sweep = ratio * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;

    // A full circle cannot be expressed as a single arc; nudge the end.
    const safeEnd = sweep >= Math.PI * 2 - 1e-6 ? start + Math.PI * 2 - 1e-6 : end;

    const outerStart = pointOnCircle(CENTER, CENTER, RADIUS, start);
    const outerEnd = pointOnCircle(CENTER, CENTER, RADIUS, safeEnd);
    const innerEnd = pointOnCircle(CENTER, CENTER, inner, safeEnd);
    const innerStart = pointOnCircle(CENTER, CENTER, inner, start);
    const largeArc = safeEnd - start > Math.PI ? 1 : 0;

    const path = [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      'Z',
    ].join(' ');

    return { ...slice, path, ratio };
  });
});

function pointOnCircle(cx: number, cy: number, r: number, angle: number) {
  return {
    x: Number((cx + r * Math.cos(angle)).toFixed(3)),
    y: Number((cy + r * Math.sin(angle)).toFixed(3)),
  };
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
</script>

<template>
  <div class="donut">
    <svg
      :viewBox="`0 0 120 120`"
      :width="size"
      :height="size"
      role="img"
      aria-label="分类占比"
      :style="{ '--pivot': `${CENTER}px` }"
    >
      <circle :cx="CENTER" :cy="CENTER" :r="RADIUS" class="track" />
      <!--
        `fill` is a style, not an attribute: a slice colour is usually `var(--cat-N)` so it
        can follow the theme, and an SVG presentation attribute cannot hold a `var()` — it
        is parsed as an attribute, not as CSS, and the shape silently paints black.
      -->
      <path
        v-for="(arc, index) in arcs"
        :key="arc.label"
        :d="arc.path"
        class="slice"
        :style="{ '--i': index, fill: arc.color }"
      >
        <title>{{ arc.label }} {{ percent(arc.ratio) }}</title>
      </path>
    </svg>

    <slot name="center" />
  </div>

  <ul class="legend">
    <li
      v-for="(arc, index) in arcs"
      :key="`legend-${arc.label}`"
      class="reveal"
      :style="{ '--i': index + 2 }"
    >
      <span class="swatch" :style="{ background: arc.color }" aria-hidden="true" />
      <span class="label">{{ arc.label }}</span>
      <span class="ratio">{{ percent(arc.ratio) }}</span>
    </li>
  </ul>
</template>

<style scoped>
/*
 * The slices swing into place about the chart's centre, one after another in angular
 * order — which is as close to a literal application of the "arcs" principle as a chart
 * gets: each slice travels along the circle it belongs to rather than moving in a straight
 * line or simply fading.
 *
 * The pivot is expressed by translating the centre to the origin and back instead of with
 * `transform-origin`. An SVG element's transform origin defaults to the corner of the
 * viewBox, and the `transform-box` property that would let it be redefined is unevenly
 * supported on the iOS versions this app targets. The transform list below is the same
 * rotation, written in a form every engine agrees about.
 */
@keyframes arc-in {
  from {
    opacity: 0;
    transform: translate(var(--pivot), var(--pivot)) rotate(-14deg) scale(0.92)
      translate(calc(-1 * var(--pivot)), calc(-1 * var(--pivot)));
  }
}

.donut {
  position: relative;
  display: grid;
  place-items: center;
}

svg {
  max-width: 100%;
  height: auto;
}

.slice {
  /*
   * A hairline of the card's own surface between neighbouring slices. Two adjacent hues
   * that a colour-vision deficiency pulls together are still two shapes when there is a
   * gap between them, which is why the palette audit may accept a near pair here and not
   * in a chart without one. 1.5 user units on a 120-unit box is about 2px on screen.
   */
  stroke: var(--surface);
  stroke-width: 1.5;
  stroke-linejoin: round;
  animation: arc-in var(--dur-slow) var(--ease-out) backwards;
  animation-delay: min(var(--stagger) * var(--i, 0), calc(var(--stagger) * 6));
}

.track {
  fill: none;
  stroke: var(--border);
  stroke-width: 12;
  opacity: 0.35;
}

.legend {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.swatch {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 0.2rem;
  flex: 0 0 auto;
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
