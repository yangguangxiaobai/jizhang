<script setup lang="ts">
/**
 * Login. Single account (parent task D7): no "sign up" affordance, because the
 * account is provisioned with the server's `set-password` CLI.
 */
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');

async function submit(): Promise<void> {
  if (username.value.trim() === '' || password.value === '') return;

  const ok = await auth.login(username.value.trim(), password.value);
  if (!ok) return;

  const next = route.query['next'];
  await router.push(typeof next === 'string' && next !== '' ? next : { name: 'dashboard' });
}
</script>

<template>
  <main class="page">
    <header class="brand">
      <h1>记账</h1>
      <p class="lede">信封预算法 · 个人账本</p>
    </header>

    <form class="card" @submit.prevent="submit">
      <label>
        <span>用户名</span>
        <input
          v-model="username"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        />
      </label>

      <label>
        <span>密码</span>
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>

      <p v-if="auth.errorMessage" class="error" role="alert">{{ auth.errorMessage }}</p>

      <button type="submit" :disabled="auth.loading">
        {{ auth.loading ? '登录中…' : '登录' }}
      </button>
    </form>

    <p class="hint">
      首次使用请在服务器上运行
      <code>docker compose exec -it jizhang node packages/server/dist/cli.js set-password</code>
      设置密码。
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 24rem;
  margin: 0 auto;
  padding: calc(3rem + env(safe-area-inset-top)) 1rem calc(2rem + env(safe-area-inset-bottom));
}

.brand {
  text-align: center;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.75rem;
}

.lede {
  margin: 0.4rem 0 0;
  color: var(--muted);
}

.card {
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 0.85rem;
  background: var(--surface);
}

label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.9rem;
  color: var(--muted);
}

input {
  /* 16px minimum stops iOS Safari from zooming the page on focus. */
  font-size: 16px;
  min-height: 44px;
  padding: 0.55rem 0.75rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.6rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
}

.hint {
  margin-top: 1.25rem;
  font-size: 0.8rem;
  line-height: 1.7;
  color: var(--muted);
}

code {
  display: block;
  margin-top: 0.35rem;
  padding: 0.5rem;
  font-size: 0.72rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  overflow-wrap: anywhere;
}
</style>
