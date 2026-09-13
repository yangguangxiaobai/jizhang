/**
 * Theme preference (follow the system, or force light/dark) and the colour preset.
 *
 * Three states, not two. A toggle can only say "light" or "dark", so once a user touches it
 * there is no way back to "follow the system" — the state most people actually want and the
 * one the app starts in. The third option is therefore part of the feature, not a nicety.
 *
 * The colour preset is the same shape one level down: `titanium` is the default and the
 * absence of an attribute; `forest` and `mono` are explicit. It changes the accent rungs
 * only — see `styles/main.css` — so it composes with either theme.
 *
 * The DOM attributes are the single source of truth for rendering; this module only reads
 * the stored preferences and keeps the attributes in sync. `theme-init.js` applies the same
 * values before first paint so there is no flash (see `vite-plugin-theme-init.ts`).
 *
 * Module-scope state, matching `composables/useNetwork.ts`: the preferences are global but
 * only the settings screen reads them, so a Pinia store would be ceremony.
 */
import { readonly, ref } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type AccentPreset = 'titanium' | 'forest' | 'mono';

/** Must match `theme-init.js`. */
const THEME_KEY = 'jizhang.theme';
/** Must match `theme-init.js`. */
const ACCENT_KEY = 'jizhang.accent';

/** The preset that needs no attribute; the values in `:root`. */
export const DEFAULT_ACCENT: AccentPreset = 'titanium';

function readStoredTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // Private mode throws on access. "system" is the right fallback, so nothing to report.
  }
  return 'system';
}

function readStoredAccent(): AccentPreset {
  try {
    const raw = window.localStorage.getItem(ACCENT_KEY);
    if (raw === 'forest' || raw === 'mono') return raw;
  } catch {
    // As above: the default preset is the right fallback.
  }
  return DEFAULT_ACCENT;
}

const preference = ref<ThemePreference>(
  typeof window === 'undefined' ? 'system' : readStoredTheme(),
);

const accent = ref<AccentPreset>(
  typeof window === 'undefined' ? DEFAULT_ACCENT : readStoredAccent(),
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
 * Keeps the browser chrome the colour of the app's own top bar.
 *
 * `<meta name="theme-color">` paints the status bar (iOS standalone) and the toolbar
 * (Android). The bar directly beneath it is `.topbar`, which is `--surface`, so that is the
 * value it takes — not the accent: a blue strip over a white bar reads as a mistake, and in
 * the dark theme the accent is a light blue, which over `#1e2127` would be worse.
 *
 * `index.html` ships one meta per system theme (with `media` queries) so the first paint is
 * right without JavaScript; once the bundle runs, every meta is set to the surface actually
 * in effect, which is what makes an explicit "dark on a light phone" reach the status bar.
 * The value is read from the computed style rather than restated here, so the stylesheet
 * stays the only list of colours.
 */
function syncThemeColorMeta(): void {
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (surface === '') return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = surface;
  }
}

/**
 * Mirrors the preferences onto `<html data-theme data-accent>`.
 *
 * `system` REMOVES the attribute rather than setting `data-theme="system"`: the CSS media
 * query keys off the attribute's absence, so leaving a stale `dark` behind would pin the
 * theme and stop following the system. The default preset is removed for the same reason.
 */
function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preference.value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference.value);
  if (accent.value === DEFAULT_ACCENT) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', accent.value);
  syncThemeColorMeta();
}

let listening = false;

/** Starts following the system, and applies the current preferences. Idempotent. */
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

/** Persists and applies a new theme preference. */
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

/** Persists and applies a new colour preset. */
export function setAccentPreset(next: AccentPreset): void {
  accent.value = next;
  try {
    if (next === DEFAULT_ACCENT) window.localStorage.removeItem(ACCENT_KEY);
    else window.localStorage.setItem(ACCENT_KEY, next);
  } catch {
    // As above.
  }
  apply();
}

export function useTheme(): {
  readonly preference: ReturnType<typeof readonly<typeof preference>>;
  readonly accent: ReturnType<typeof readonly<typeof accent>>;
} {
  return { preference: readonly(preference), accent: readonly(accent) };
}
