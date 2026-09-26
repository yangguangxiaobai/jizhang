<script setup lang="ts">
/**
 * Authenticated shell: status banner + header + bottom tab bar + <RouterView>.
 *
 * Mobile-first layout. The bottom bar is padded with the iOS safe-area inset so it
 * is not swallowed by the home indicator, and every target is >= 44px tall.
 */
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import InstallHint from '../components/InstallHint.vue';
import OfflineBanner from '../components/OfflineBanner.vue';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const title = computed(() => (route.meta['title'] as string | undefined) ?? '记账');
const activeNav = computed(() => (route.meta['nav'] as string | undefined) ?? '');
const navItems = [
  { name: 'dashboard', label: '首页' },
  { name: 'transactions', label: '账单' },
  { name: 'budget', label: '预算' },
  { name: 'assistant', label: 'AI 助理' },
  { name: 'stats', label: '统计' },
  { name: 'settings', label: '我的' },
] as const;
</script>

<template>
  <div class="shell">
    <OfflineBanner />

    <header class="topbar">
      <div class="topbar-inner">
        <h1 class="mobile-title">{{ title }}</h1>
        <RouterLink class="desktop-brand" :to="{ name: 'dashboard' }">知账</RouterLink>
        <nav class="desktop-nav" aria-label="主导航">
          <RouterLink
            v-for="item in navItems"
            :key="item.name"
            :to="{ name: item.name }"
            class="desktop-nav-link"
            :class="{ active: activeNav === item.name }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <span class="user"><AppIcon name="user" /> {{ auth.username }}</span>
      </div>
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
        <span class="glyph"><AppIcon name="home" /></span>
        <span>首页</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'transactions' }"
        class="tab"
        :class="{ active: activeNav === 'transactions' }"
      >
        <span class="glyph"><AppIcon name="transactions" /></span>
        <span>账单</span>
      </RouterLink>

      <RouterLink :to="{ name: 'budget' }" class="tab" :class="{ active: activeNav === 'budget' }">
        <span class="glyph"><AppIcon name="budget" /></span>
        <span>预算</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'assistant' }"
        class="tab primary"
        :class="{ active: activeNav === 'assistant' }"
      >
        <span class="glyph"><AppIcon name="sparkles" /></span>
        <span>AI 助理</span>
      </RouterLink>

      <RouterLink :to="{ name: 'stats' }" class="tab" :class="{ active: activeNav === 'stats' }">
        <span class="glyph"><AppIcon name="stats" /></span>
        <span>统计</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'settings' }"
        class="tab"
        :class="{ active: activeNav === 'settings' }"
      >
        <span class="glyph"><AppIcon name="user" /></span>
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
  padding: calc(0.85rem + env(safe-area-inset-top)) 1rem 0.85rem;
  background: var(--surface);
  box-shadow: var(--lift-1);
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 38rem;
  margin: 0 auto;
}

.desktop-brand,
.desktop-nav {
  display: none;
}

h1 {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.03em;
}

.user {
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.8rem;
}

.content {
  flex: 1;
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.2rem 1rem 1.75rem;
}

.tabbar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 0.4rem max(0.35rem, calc((100% - 40rem) / 2)) calc(0.3rem + env(safe-area-inset-bottom));
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 0;
  min-height: 56px;
  padding: 0.25rem 0.1rem 0.45rem;
  font-size: 0.75rem;
  text-align: center;
  color: var(--muted);
  text-decoration: none;
  /* Keep press feedback immediate and the glyph arrival one step ahead of the label. */
  transition:
    transform var(--dur-press) var(--ease-out),
    color var(--dur-quick) var(--ease-out) var(--stagger);
}

.tab.active,
.tab.primary {
  color: var(--accent);
  font-weight: 600;
}

.glyph {
  display: grid;
  place-items: center;
  width: min(2.25rem, 100%);
  height: 1.85rem;
  border-radius: var(--radius-control);
  font-size: 1rem;
  transition: transform var(--dur-base) var(--ease-pop) var(--stagger);
}

.tab.active .glyph {
  background: var(--accent-subtle);
  transform: translateY(-2px) scale(1.12);
}

.tab.primary .glyph {
  background: var(--accent);
  color: var(--on-accent);
}

@media (min-width: 64rem) {
  .topbar {
    padding: 0.6rem 2rem;
  }

  .topbar-inner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 2rem;
    max-width: 88rem;
  }

  .mobile-title {
    display: none;
  }

  .desktop-brand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    color: var(--accent);
    font-size: 1.1rem;
    font-weight: 750;
    letter-spacing: -0.02em;
    text-decoration: none;
  }

  .desktop-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .desktop-nav-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0.55rem 0.8rem;
    color: var(--muted);
    border-radius: var(--radius-control);
    font-size: 0.9rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .desktop-nav-link.active {
    color: var(--accent);
    background: var(--accent-subtle);
    font-weight: 650;
  }

  .user {
    max-width: 12rem;
    font-size: 0.85rem;
  }

  .content {
    max-width: 88rem;
    padding: 1.5rem 2rem 2rem;
  }

  .tabbar {
    display: none;
  }
}
</style>
