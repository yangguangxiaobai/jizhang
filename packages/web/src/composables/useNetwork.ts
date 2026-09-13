/**
 * Connectivity state and the iOS "add to home screen" hint.
 *
 * The app is online-first (parent task D4): writes need the network, reads are
 * cached-shell-only. So the UI has to be explicit about which mode it is in rather
 * than letting a save silently fail.
 *
 * `navigator.onLine` is a coarse signal — it means "there is an interface", not "the
 * server is reachable" — so it is combined with the request-level `OfflineError` that
 * `api/client.ts` throws when a fetch actually fails.
 */
import { computed, onMounted, readonly, ref } from 'vue';
import type { Ref } from 'vue';

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

/** Set when a request failed for network reasons, until the next success. */
const lastRequestFailed = ref(false);

let listenersAttached = false;

function attach(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  window.addEventListener('online', () => {
    online.value = true;
    // A fresh connection clears the "your last request failed" flag; the page reloads
    // its data on its own.
    lastRequestFailed.value = false;
  });
  window.addEventListener('offline', () => {
    online.value = false;
  });
}

/** True when the browser reports no connection at all. */
export function useOnline(): {
  readonly online: ReturnType<typeof readonly<typeof online>>;
} {
  onMounted(attach);
  return { online: readonly(online) };
}

/** Records that a request failed for network reasons (called by the API client). */
export function markRequestFailed(): void {
  lastRequestFailed.value = true;
}

/** Records that a request succeeded. */
export function markRequestSucceeded(): void {
  lastRequestFailed.value = false;
  online.value = true;
}

/**
 * Whether to show the offline banner: either the browser is offline, or the last
 * request failed for a network reason (captive portal, server down, DNS broken).
 *
 * Derived, not snapshotted. This previously copied both sources into a plain `ref`
 * re-copied only on `online`/`offline` window events, with a comment claiming the
 * template recomputed it — the template read the copy, so `markRequestFailed()` could
 * never surface. That is precisely the self-hosted case worth covering: the phone is
 * online, the VPS is not, and the only feedback was the form's own error. `iphone.spec`
 * caught it by stopping the server and asserting the banner, not just the alert.
 */
export function useOfflineBanner(): { readonly offline: Readonly<Ref<boolean>> } {
  attach();
  return { offline: computed(() => !online.value || lastRequestFailed.value) };
}

/** Whether the app is already running as an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari predates `display-mode` and uses `navigator.standalone`.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
}

/** True on an iOS browser that is NOT yet installed as an app. */
export function shouldOfferInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  // Only Safari can add to the home screen on iOS, so offering it in Chrome there
  // would be a dead end.
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium/.test(ua);
  return isIos && isSafari && !isStandalone();
}

const INSTALL_DISMISSED_KEY = 'jizhang.installHintDismissed';

/** Remembers that the user closed the install hint, so it does not nag. */
export function installHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    // Private mode: the hint simply reappears next time.
  }
}
