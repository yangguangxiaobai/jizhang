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
      <!--
        Keyed on the route path so every navigation mounts fresh elements, which is what
        lets the CSS arrival in `styles/main.css` replay. Without the key, moving between
        two records of the same view (`/transactions/new` -> `/transactions/:id/edit`)
        would reuse the DOM and keep the previous form's values on screen.

        Deliberately NOT wrapped in `<Transition>`: every view renders a fragment rather
        than a single root element, and a transition around a fragment silently does
        nothing. The arrival is expressed in CSS instead, and the departure is an instant
        cut — one thing moving at a time is the point, and a tab bar that waits for the
        outgoing page to finish leaving feels broken.
      -->
      <div :key="route.path" class="view-slot">
        <RouterView />
      </div>
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
  /* One step up the elevation ladder, so scrolled content passes *under* the bar rather
     than appearing to slide behind a flat sheet of the same colour. */
  box-shadow: var(--lift-1);
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
  position: relative;
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
  /*
   * The press squash is undelayed (it is the touch itself), while the label colour waits
   * one `--stagger` step behind the indicator below. Two parts of the same control
   * settling at different times is the whole of "follow through and overlapping action";
   * if they moved together the bar would read as a row of switches flipping.
   */
  transition:
    transform var(--dur-press) var(--ease-out),
    color var(--dur-quick) var(--ease-out) var(--stagger);
}

/*
 * The active indicator. It is a second, decorative element rather than a styling of the
 * label, so it can arrive on its own curve: it stretches out from the centre with a slight
 * overshoot while the label above it is still on its way to the accent colour.
 */
.tab::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0.3rem;
  width: 1.1rem;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0;
  transform: translateX(-50%) scaleX(0);
  transition:
    transform var(--dur-base) var(--ease-pop),
    opacity var(--dur-quick) var(--ease-out);
}

.tab.active::after {
  opacity: 1;
  transform: translateX(-50%) scaleX(1);
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
  transition: transform var(--dur-base) var(--ease-pop) var(--stagger);
}

.tab.active .glyph {
  transform: translateY(-2px) scale(1.12);
}

@media (min-width: 40rem) {
  .content {
    padding-bottom: 2rem;
  }
}
</style>
