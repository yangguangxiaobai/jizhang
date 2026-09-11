/**
 * The app lock: a four-to-eight digit PIN that gates the UI.
 *
 * ## What this is NOT
 *
 * **It is not a security boundary, and the UI must not imply that it is.** The app is a web
 * page: its JavaScript is readable, the ledger lives on the server, and the real credential
 * is the session cookie the server checks on every request. Anyone who can reach the API can
 * read the data whether or not a PIN was entered here.
 *
 * What the PIN actually buys is the ordinary case it was asked for: handing an unlocked phone
 * to someone, or leaving it on a table, without the account balances being on screen. That is
 * a real benefit and it is the whole benefit. The reference Flutter app's lock IS a security
 * boundary because its data is local and its code is compiled; copying that claim onto a web
 * client would be a lie, so it is stated plainly in the settings UI.
 *
 * Consequently there is deliberately **no attempt counter**. A lockout enforced in JavaScript
 * is bypassed by clearing storage, so it would be security theatre; the boundary against
 * guessing is the server's login.
 *
 * ## Why the PIN is still hashed
 *
 * Storing a plaintext PIN would have no advantage and one clear cost: it would sit in
 * `localStorage` in the clear, and people reuse PINs. Hashing with a random salt via Web
 * Crypto (`crypto.subtle`, built in, no dependency) costs a few lines and matches how the
 * login password is treated on the server.
 *
 * ## Why the unlocked flag is IN MEMORY, not in sessionStorage
 *
 * The first version stored it in `sessionStorage`, on the assumption that a reload would
 * clear it. It does not: per the Storage spec a session store survives reload and is only
 * dropped when the tab closes. Reloading therefore stayed unlocked, and "cold start requires
 * the PIN" was never true — verified in a browser, not assumed.
 *
 * The reference Flutter app relies on a timeout plus a resume hook. A web client has no
 * equivalent resume signal it can trust, so the honest reading of "cold start" on this
 * platform is **loading the application**. In-memory state makes a reload, a bookmark, a
 * home-screen launch and a new tab all require the PIN, which is exactly that meaning, and
 * it needs no timer.
 *
 * The cost is that a refresh re-prompts. For a lock whose entire purpose is hiding balances
 * from an onlooker, re-prompting is the safe direction to err in.
 */
import { readonly, ref } from 'vue';

/** `{ salt, hash }`, both base64. Must match this module's key. */
const PIN_KEY = 'jizhang.pin';
/** Left behind by an earlier version that used sessionStorage; cleared on sight. */
const LEGACY_UNLOCKED_KEY = 'jizhang.unlocked';

/** The shortest PIN worth accepting; four digits is the conventional phone length. */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 8;

interface StoredPin {
  readonly salt: string;
  readonly hash: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * `SHA-256(salt || pin)`.
 *
 * A single SHA-256 is not a password KDF: an 8-digit PIN has only 10^8 possibilities and a
 * fast hash is cheap to brute force offline. That is acceptable *here specifically* because
 * the PIN is not protecting the data (see the module comment) — it is protecting the screen.
 * Using PBKDF2 would be easy to add and would still not make this a security boundary, so it
 * would buy nothing but a slower unlock and a false sense of strength.
 */
async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const material = new Uint8Array(salt.length + pin.length);
  material.set(salt, 0);
  material.set(encoder.encode(pin), salt.length);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return toBase64(new Uint8Array(digest));
}

function readStoredPin(): StoredPin | null {
  try {
    const raw = window.localStorage.getItem(PIN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record['salt'] !== 'string' || typeof record['hash'] !== 'string') return null;
    return { salt: record['salt'], hash: record['hash'] };
  } catch {
    // Unreadable storage means "no PIN"; the alternative is locking the user out of an app
    // that has no security stake in the lock.
    return null;
  }
}

function readUnlocked(): boolean {
  // In memory only, so every fresh load of the application starts locked (see the module
  // comment). `unlockedThisPage` is the whole store.
  return unlockedThisPage;
}

const locked = ref(false);
const hasPin = ref(false);
/**
 * Whether THIS page load has been unlocked.
 *
 * Module scope, so it lives exactly as long as the loaded application does: a reload starts
 * with `false` and the PIN is required again.
 */
let unlockedThisPage = false;

/** True when a PIN is set and this page session has not been unlocked yet. */
export function isLocked(): boolean {
  return locked.value;
}

export function pinIsSet(): boolean {
  return hasPin.value;
}

export function pinLengthIsValid(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= MIN_PIN_LENGTH && pin.length <= MAX_PIN_LENGTH;
}

/**
 * Recomputes the lock state from storage.
 *
 * Called on boot and again after the settings screen changes the PIN, so a single place
 * decides what "locked" means.
 */
export function refreshLock(): void {
  const stored = readStoredPin();
  hasPin.value = stored !== null;
  locked.value = stored !== null && !readUnlocked();
}

export function markUnlocked(): void {
  unlockedThisPage = true;
  locked.value = false;
  clearLegacyKey();
}

/** Re-locks immediately, for the "lock now" action. */
export function lockNow(): void {
  if (!hasPin.value) return;
  unlockedThisPage = false;
  locked.value = true;
  clearLegacyKey();
}

/** Removes the flag an earlier sessionStorage-based version may have left behind. */
function clearLegacyKey(): void {
  try {
    window.sessionStorage.removeItem(LEGACY_UNLOCKED_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Returns true when the PIN matches. */
export async function verifyPin(pin: string): Promise<boolean> {
  const stored = readStoredPin();
  if (stored === null) return false;
  const candidate = await hashPin(pin, fromBase64(stored.salt));
  // Length is not secret, and a constant-time comparison is not meaningful for a value that
  // is not a security boundary.
  return candidate === stored.hash;
}

/** Sets (replacing any existing) PIN and unlocks the current page session. */
export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt);
  window.localStorage.setItem(PIN_KEY, JSON.stringify({ salt: toBase64(salt), hash }));
  refreshLock();
  markUnlocked();
}

/**
 * Removes the PIN.
 *
 * "Forgot PIN" uses this too, which is why it does not require the old PIN: the fallback
 * must not be a lockout. It is not a bypass — clearing the lock leaves the user on the
 * settings screen and the ledger is still behind the server session, exactly as it was
 * before a PIN ever existed.
 */
export function clearPin(): void {
  unlockedThisPage = false;
  try {
    window.localStorage.removeItem(PIN_KEY);
  } catch {
    // Nothing further to do.
  }
  clearLegacyKey();
  refreshLock();
}

/** Changes the PIN after confirming the current one. */
export async function changePin(currentPin: string, nextPin: string): Promise<boolean> {
  if (!(await verifyPin(currentPin))) return false;
  await setPin(nextPin);
  return true;
}

export function useLock(): {
  readonly locked: ReturnType<typeof readonly<typeof locked>>;
  readonly hasPin: ReturnType<typeof readonly<typeof hasPin>>;
} {
  return { locked: readonly(locked), hasPin: readonly(hasPin) };
}
