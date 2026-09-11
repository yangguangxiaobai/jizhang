<script setup lang="ts">
/**
 * The locked screen.
 *
 * It shows nothing but a PIN field: no username, no balances, no navigation. A lock screen
 * that leaks the thing it is hiding is worse than none, because it creates the impression of
 * privacy without providing it.
 *
 * "Forgot PIN" clears the lock rather than being a dead end. That is not a hole: this lock
 * guards the screen, not the data — the ledger is still behind the server session, and the
 * user lands on the app exactly as they would have before setting a PIN. The note under the
 * field says so plainly instead of implying the PIN is encryption.
 */
import { computed, ref, watch } from 'vue';
import { clearPin, MAX_PIN_LENGTH, MIN_PIN_LENGTH, markUnlocked, verifyPin } from '../composables/useLock.js';

const pin = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);

const canSubmit = computed(() => pin.value.length >= MIN_PIN_LENGTH && !busy.value);

watch(pin, (next, previous) => {
  // Clear the previous complaint as soon as the user starts correcting it.
  //
  // The `next !== ''` guard is load-bearing, not tidiness: `submit()` clears the field after
  // a failed attempt, which is itself a change and would wipe the message it just set. The
  // user saw no feedback at all for a wrong PIN until this was caught in a browser.
  if (next !== '' && next !== previous) error.value = null;
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = null;
  try {
    if (await verifyPin(pin.value)) {
      markUnlocked();
      return;
    }
    error.value = 'PIN 不正确。';
    pin.value = '';
    input.value?.focus();
  } finally {
    busy.value = false;
  }
}

function forgot(): void {
  if (
    !window.confirm(
      '忘记 PIN？\n\n将清除本机 PIN。账本数据不受影响，仍需要登录密码才能访问。',
    )
  ) {
    return;
  }
  clearPin();
}
</script>

<template>
  <main class="lock">
    <header class="brand">
      <h1>记账</h1>
      <p class="lede">已锁定</p>
    </header>

    <form class="card" @submit.prevent="submit">
      <label class="field">
        <span>输入 PIN</span>
        <input
          ref="input"
          v-model="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          :maxlength="MAX_PIN_LENGTH"
          :placeholder="`${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} 位数字`"
          required
        />
      </label>

      <p v-if="error !== null" class="error" role="alert">{{ error }}</p>

      <button type="submit" :disabled="!canSubmit">
        {{ busy ? '验证中…' : '解锁' }}
      </button>

      <button type="button" class="ghost" @click="forgot">忘记 PIN</button>

      <p class="note">
        PIN 只用于在本机遮挡账目，<strong>不是加密保护</strong>；数据仍由登录密码保护。
      </p>
    </form>
  </main>
</template>

<style scoped>
.lock {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100dvh;
  max-width: 24rem;
  margin: 0 auto;
  padding: calc(2rem + env(safe-area-inset-top)) 1.25rem
    calc(2rem + env(safe-area-inset-bottom));
}

.brand {
  text-align: center;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}

.lede {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}

.card {
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

/*
 * A rejected PIN shakes the whole card: the field, the message and both buttons move as
 * one object refusing, rather than a stray line of text twitching on its own.
 *
 * `:has()` is doing real work here. The card element is never re-created, so a plain
 * `v-if`-driven keyframe would fire once and then never again — but a selector that stops
 * matching when the message is cleared and starts matching when it returns re-applies the
 * animation from the beginning. Verified in a browser by entering a wrong PIN twice.
 */
.card:has([role='alert']) {
  animation: shake-x var(--dur-slow) var(--ease-in-out);
}

/* The card already carries the motion; shaking the message inside it as well would double
   the amplitude on that one line. */
.card [role='alert'] {
  animation: none;
}

.field {
  display: grid;
  gap: 0.3rem;
}

.field > span {
  font-size: 0.85rem;
  color: var(--muted);
}

/* 16px minimum: below it, iOS Safari zooms the page on focus. */
input {
  width: 100%;
  min-height: 44px;
  padding: 0 0.7rem;
  font: inherit;
  font-size: 16px;
  letter-spacing: 0.3em;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.note {
  margin: 0.25rem 0 0;
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--muted);
  text-align: center;
}
</style>
