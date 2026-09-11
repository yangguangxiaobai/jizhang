<script setup lang="ts">
/**
 * Settings: session info, password rotation, and the sign-out path.
 *
 * Changing the password invalidates every session server-side (T3 AC7), so this
 * view sends the user back to login rather than leaving them on a dead cookie.
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

// ── budget cycle start day ───────────────────────────────────────────────────
// 0 is the sentinel for "natural month"; the server accepts 1..28.
const cycleDayChoice = ref(0);
const cycleSaving = ref(false);
const cycleMessage = ref<string | null>(null);
const cycleError = ref<string | null>(null);

onMounted(async () => {
  try {
    const settings = await api.settings.get();
    cycleDayChoice.value = settings.cycleStartDay ?? 0;
  } catch {
    // Read-only failure: leave the default selected.
  }
});

async function saveCycle(): Promise<void> {
  cycleSaving.value = true;
  cycleMessage.value = null;
  cycleError.value = null;
  try {
    const day = cycleDayChoice.value === 0 ? null : cycleDayChoice.value;
    const result = await api.settings.setCycleStartDay(day);
    cycleDayChoice.value = result.cycleStartDay ?? 0;
    cycleMessage.value =
      result.cycleStartDay === null
        ? '已切换为自然月周期。'
        : `已设置为每月 ${result.cycleStartDay} 号起算。`;
  } catch (error) {
    cycleError.value = error instanceof Error ? error.message : String(error);
  } finally {
    cycleSaving.value = false;
  }
}

async function changePassword(): Promise<void> {
  errorMessage.value = null;
  successMessage.value = null;

  if (newPassword.value.length < 8) {
    errorMessage.value = '新密码至少 8 位。';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的新密码不一致。';
    return;
  }

  saving.value = true;
  try {
    await api.auth.changePassword(currentPassword.value, newPassword.value);
    successMessage.value = '密码已修改，所有设备需要重新登录。';
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';

    // The server dropped every session, including this one.
    auth.username = null;
    await router.push({ name: 'login' });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

async function signOut(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <section class="card">
    <h2>账号</h2>
    <dl>
      <div>
        <dt>用户名</dt>
        <dd>{{ auth.username }}</dd>
      </div>
    </dl>
    <button type="button" class="ghost" @click="signOut">退出登录</button>
  </section>

  <section class="card">
    <h2>数据管理</h2>
    <p class="hint">分类的图标与颜色、账户、标签的重命名与删除。</p>
    <button type="button" class="ghost" @click="router.push({ name: 'manage' })">
      分类与账户管理
    </button>
    <button type="button" class="ghost" @click="router.push({ name: 'templates' })">
      分配模板
    </button>
    <button type="button" class="ghost" @click="router.push({ name: 'salary-records' })">
      工资记录
    </button>
    <button type="button" class="ghost" @click="router.push({ name: 'trash' })">
      回收站
    </button>
    <button type="button" class="ghost" @click="router.push({ name: 'recurring-rules' })">
      周期账单
    </button>
  </section>

  <section class="card">
    <h2>预算周期</h2>
    <p class="hint">
      默认按自然月划分周期。也可以指定每月某一天为周期起点（例如发薪日 15 号）。
    </p>
    <div class="cycle-row">
      <select v-model.number="cycleDayChoice">
        <option :value="0">自然月（默认）</option>
        <option v-for="day in 28" :key="day" :value="day">每月 {{ day }} 号</option>
      </select>
      <button type="button" :disabled="cycleSaving" @click="saveCycle">保存</button>
    </div>
    <p v-if="cycleMessage" class="ok" role="status">{{ cycleMessage }}</p>
    <p v-if="cycleError" class="error" role="alert">{{ cycleError }}</p>
  </section>

  <section class="card">
    <h2>修改密码</h2>
    <p class="hint">修改后所有设备上的会话都会失效，需要重新登录。</p>

    <form @submit.prevent="changePassword">
      <label>
        <span>当前密码</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" required />
      </label>

      <label>
        <span>新密码（至少 8 位）</span>
        <input v-model="newPassword" type="password" autocomplete="new-password" required />
      </label>

      <label>
        <span>重复新密码</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" required />
      </label>

      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="ok" role="status">{{ successMessage }}</p>

      <button type="submit" :disabled="saving">{{ saving ? '提交中…' : '修改密码' }}</button>
    </form>
  </section>

  <section class="card">
    <h2>关于</h2>
    <p class="hint">
      信封预算法记账 · 自建部署。预算、统计与模板功能在后续任务中加入。
    </p>
  </section>
</template>

<style scoped>
.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

dl {
  margin: 0 0 0.85rem;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px dashed var(--border);
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

form {
  display: grid;
  gap: 0.75rem;
}

label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--muted);
}

input {
  font-size: 16px;
  min-height: 44px;
  padding: 0.5rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

button.ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.hint {
  margin: 0 0 0.85rem;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--muted);
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.85rem;
}

.ok {
  margin: 0;
  color: var(--ok, #3f9e6a);
  font-size: 0.85rem;
}
</style>
