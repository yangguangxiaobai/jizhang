<script setup lang="ts">
/** A small shared line-icon vocabulary; visible control labels carry the accessible name. */
const paths = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  transactions:
    'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h6m-6 4h6m-6 4h4',
  budget: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 7l9 6 9-6',
  plus: 'M12 5v14M5 12h14',
  stats: 'M5 20V10m7 10V4m7 16v-8',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  transfer: 'M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  wallet:
    'M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h15V7H5a2 2 0 0 1 0-4m15 8h-5v6h5m-4-3h1',
  system: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 17h8m-4-4v4',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4-10v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.8 13.4A9 9 0 0 1 10.6 3.2a9 9 0 1 0 10.2 10.2Z',
  check: 'm5 12 4 4L19 6',
} as const;

defineProps<{ name: keyof typeof paths }>();
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
