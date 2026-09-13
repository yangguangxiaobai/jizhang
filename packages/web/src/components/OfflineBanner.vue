<script setup lang="ts">
/**
 * Offline banner.
 *
 * Reads as a status line rather than an error: being offline is a normal state on a
 * phone, and the app shell itself still works. The message states what is and is not
 * possible, because a silent failure on save is the worst outcome.
 */
import { computed, ref, watch } from 'vue';
import { useOfflineBanner } from '../composables/useNetwork.js';

const { offline } = useOfflineBanner();

/** Briefly confirm reconnection, then get out of the way. */
const showRestored = ref(false);
watch(offline, (isOffline, wasOffline) => {
  if (wasOffline === true && !isOffline) {
    showRestored.value = true;
    window.setTimeout(() => {
      showRestored.value = false;
    }, 2500);
  }
});

const visible = computed(() => offline.value || showRestored.value);
</script>

<template>
  <div
    v-if="visible"
    class="banner"
    :class="{ restored: !offline }"
    role="status"
    aria-live="polite"
  >
    <template v-if="offline">
      离线中 — 可以查看已打开的页面，但<b>记账需要联网</b>。
    </template>
    <template v-else>已恢复连接。</template>
  </div>
</template>

<style scoped>
/*
 * Warning, not danger: the component's own contract is that being offline is a normal state
 * on a phone, and the red tier is for things that went wrong. The text token is the one
 * that belongs to the fill — `--on-warning`, not `--on-accent` — so the pairing cannot come
 * apart if a preset ever changes the accent's polarity.
 */
.banner {
  padding: 0.45rem 1rem;
  font-size: 0.8rem;
  line-height: 1.5;
  text-align: center;
  color: var(--on-warning);
  background: var(--warning);
  /*
   * Arrives from above, because that is where it lives on screen — a top bar rising from
   * below would read as content that had been pushed out of the way.
   *
   * Only `opacity` and `transform` move, so the page below is never reflowed: the space
   * the banner occupies is reserved the moment it is inserted, and it slides into it.
   */
  --rise-distance: -6px;
  animation: rise-in var(--dur-base) var(--ease-out) backwards;
}

.banner.restored {
  color: var(--on-ok);
  background: var(--ok);
}

b {
  font-weight: 600;
}
</style>
