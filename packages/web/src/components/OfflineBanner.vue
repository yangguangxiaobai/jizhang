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
.banner {
  padding: 0.45rem 1rem;
  font-size: 0.8rem;
  line-height: 1.5;
  text-align: center;
  color: #fff;
  background: var(--danger);
}

.banner.restored {
  background: var(--ok, #3f9e6a);
}

b {
  font-weight: 600;
}
</style>
