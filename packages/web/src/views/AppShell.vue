<script setup lang="ts">
/**
 * Authenticated shell: status banner + header + bottom tab bar + <RouterView>.
 *
 * Mobile-first layout. The bottom bar is padded with the iOS safe-area inset so it
 * is not swallowed by the home indicator, and every target is >= 44px tall.
 */
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import InstallHint from '../components/InstallHint.vue';
import OfflineBanner from '../components/OfflineBanner.vue';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const route = useRoute();

const title = computed(() => (route.meta['title'] as string | undefined) ?? '记账');
const activeNav = computed(() => (route.meta['nav'] as string | undefined) ?? '');
</script>

<template>
  <div class="shell">
    <OfflineBanner />

    <header class="topbar">
      <h1>{{ title }}</h1>
      <span class="user">{{ auth.username }}</span>
    </header>

    <main class="content">
      <InstallHint />
      <RouterView />
    </main>

    <nav class="tabbar" aria-label="主导航">
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="tab"
        :class="{ active: activeNav === 'dashboard' }"
      >
        <span class="glyph" aria-hidden="true">🏠</span>
        <span>首页</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'transactions' }"
        class="tab"
        :class="{ active: activeNav === 'transactions' }"
      >
        <span class="glyph" aria-hidden="true">📋</span>
        <span>账单</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'budget' }"
        class="tab"
        :class="{ active: activeNav === 'budget' }"
      >
        <span class="glyph" aria-hidden="true">✉️</span>
        <span>预算</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'transaction-new' }"
        class="tab primary"
        :class="{ active: activeNav === 'new' }"
      >
        <span class="glyph" aria-hidden="true">＋</span>
        <span>记一笔</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'stats' }"
        class="tab"
        :class="{ active: activeNav === 'stats' }"
      >
        <span class="glyph" aria-hidden="true">📊</span>
        <span>统计</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'settings' }"
        class="tab"
        :class="{ active: activeNav === 'settings' }"
      >
        <span class="glyph" aria-hidden="true">⚙️</span>
        <span>我的</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: calc(0.75rem + env(safe-area-inset-top)) 1rem 0.75rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

h1 {
  margin: 0;
  font-size: 1.1rem;
}

.user {
  font-size: 0.85rem;
  color: var(--muted);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  flex: 1;
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem 1rem 1.5rem;
}

.tabbar {
  position: sticky;
  bottom: 0;
  display: grid;
  /* 首页 / 账单 / 预算 / 记一笔 / 统计 / 我的 */
  grid-template-columns: repeat(6, 1fr);
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  min-height: 56px;
  padding: 0.4rem 0.25rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--muted);
  text-decoration: none;
  background: none;
  border: 0;
  cursor: pointer;
}

.tab.active {
  color: var(--accent);
}

.tab.primary .glyph {
  font-size: 1.5rem;
  line-height: 1;
}

.tab.primary {
  color: var(--accent);
  font-weight: 600;
}

.glyph {
  font-size: 1.15rem;
  line-height: 1;
}

@media (min-width: 40rem) {
  .content {
    padding-bottom: 2rem;
  }
}
</style>
