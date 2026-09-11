/**
 * Theme preference: follow the system, or force light/dark.
 *
 * Three states, not two. A toggle can only say "light" or "dark", so once a user touches it
 * there is no way back to "follow the system" — the state most people actually want and the
 * one the app starts in. The third option is therefore part of the feature, not a nicety.
 *
 * The DOM attribute is the single source of truth for rendering; this module only reads the
 * stored preference and keeps the attribute in sync. `theme-init.js` applies the same value
 * before first paint so there is no flash (see `scripts/vite-plugin-theme-init.mjs`).
 *
 * Module-scope state, matching `composables/useNetwork.ts`: the preference is global but
 * only the settings screen reads it, so a Pinia store would be ceremony.
 */
import { readonly, ref } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Must match `theme-init.js`. */
const THEME_KEY = 'jizhang.theme';

function readStored(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // Private mode throws on access. "system" is the right fallback, so nothing to report.
  }
  return 'system';
}

const preference = ref<ThemePreference>(
  typeof window === 'undefined' ? 'system' : readStored(),
);

/** What the system currently asks for; only consulted while the preference is `system`. */
function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The theme actually in effect. */
export function resolvedTheme(): ResolvedTheme {
  return preference.value === 'system' ? systemTheme() : preference.value;
}

/**
 * Mirrors the preference onto `<html data-theme>`.
 *
 * `system` REMOVES the attribute rather than setting `data-theme="system"`: the CSS media
 * query keys off the attribute's absence, so leaving a stale `dark` behind would pin the
 * theme and stop following the system.
 */
function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preference.value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference.value);
}

let listening = false;

/** Starts following the system, and applies the current preference. Idempotent. */
export function initTheme(): void {
  apply();
  if (listening || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  listening = true;
  // Only matters while the preference is `system`, but re-applying unconditionally is
  // simpler than subscribing and unsubscribing as the preference changes.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

/** Persists and applies a new preference. */
export function setThemePreference(next: ThemePreference): void {
  preference.value = next;
  try {
    if (next === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // The choice still applies for this session even if it cannot be remembered.
  }
  apply();
}

export function useTheme(): {
  readonly preference: ReturnType<typeof readonly<typeof preference>>;
} {
  return { preference: readonly(preference) };
}
