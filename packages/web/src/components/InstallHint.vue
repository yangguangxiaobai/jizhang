<script setup lang="ts">
/**
 * "Add to home screen" hint, iOS only.
 *
 * iOS Safari is the one platform where the PWA experience has to be discovered: the
 * share sheet is the only route, and Safari gives no prompt of its own. Shown once and
 * dismissible — a permanent nag would be worse than the problem.
 */
import { onMounted, ref } from 'vue';
import { dismissInstallHint, installHintDismissed, shouldOfferInstall } from '../composables/useNetwork.js';

const visible = ref(false);

onMounted(() => {
  visible.value = shouldOfferInstall() && !installHintDismissed();
});

function dismiss(): void {
  dismissInstallHint();
  visible.value = false;
}
</script>

<template>
  <aside v-if="visible" class="hint">
    <div class="text">
      <strong>添加到主屏幕</strong>
      <p>
        点底部的「分享」
        <span aria-hidden="true">⎋</span>
        按钮，选择「添加到主屏幕」，之后就能像 App 一样打开。
      </p>
    </div>
    <button type="button" aria-label="不再提示" @click="dismiss">✕</button>
  </aside>
</template>

<style scoped>
.hint {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  margin-bottom: 1rem;
  font-size: 0.8rem;
  line-height: 1.6;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 0.65rem;
}

.text {
  flex: 1;
}

strong {
  display: block;
  margin-bottom: 0.15rem;
}

p {
  margin: 0;
  color: var(--muted);
}

button {
  /* 44px minimum target; the glyph stays small via the flex centring. */
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  cursor: pointer;
}
</style>
