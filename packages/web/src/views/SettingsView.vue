<script setup lang="ts">
/**
 * Settings: session info, password rotation, and the sign-out path.
 *
 * Changing the password invalidates every session server-side (T3 AC7), so this
 * view sends the user back to login rather than leaving them on a dead cookie.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import {
  clearPin,
  lockNow,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  pinLengthIsValid,
  refreshLock,
  setPin,
  useLock,
} from '../composables/useLock.js';
import { setThemePreference, useTheme, type ThemePreference } from '../composables/useTheme.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();
const { preference: themePreference } = useTheme();
const { hasPin } = useLock();

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

// ── app lock ─────────────────────────────────────────────────────────────────
const pinDraft = ref('');
const pinConfirm = ref('');
const pinMessage = ref<string | null>(null);
const pinError = ref<string | null>(null);

const pinReady = computed(
  () => pinLengthIsValid(pinDraft.value) && pinDraft.value === pinConfirm.value,
);

async function savePin(): Promise<void> {
  pinError.value = null;
  pinMessage.value = null;
  if (!pinReady.value) {
    pinError.value = `请输入 ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} 位数字，且两次输入一致。`;
    return;
  }
  await setPin(pinDraft.value);
  pinDraft.value = '';
  pinConfirm.value = '';
  pinMessage.value = 'PIN 已设置。刷新页面后需要输入 PIN 才能查看账目。';
}

function removePin(): void {
  pinError.value = null;
  pinMessage.value = null;
  if (!window.confirm('关闭应用锁？\n\n关闭后打开应用不再需要 PIN。')) return;
  clearPin();
  refreshLock();
  pinMessage.value = '应用锁已关闭。';
}

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
    <h2>外观</h2>
    <p class="hint">默认跟随系统的深浅色设置。</p>
    <div class="segmented">
      <button
        v-for="option in THEME_OPTIONS"
        :key="option.value"
        type="button"
        :class="{ active: themePreference === option.value }"
        :aria-pressed="themePreference === option.value"
        @click="setThemePreference(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </section>

  <section class="card">
    <h2>应用锁</h2>
    <p class="hint">
      PIN 用于在本机遮挡账目，例如把手机递给别人时。它
      <strong>不是加密保护</strong>：数据仍由登录密码与服务端会话保护。
    </p>

    <template v-if="hasPin">
      <div class="actions">
        <button type="button" class="ghost" @click="lockNow">立即锁定</button>
        <button type="button" class="ghost danger" @click="removePin">关闭应用锁</button>
      </div>
    </template>

    <label class="field">
      <span>{{ hasPin ? '设置新 PIN' : '设置 PIN' }}</span>
      <input
        v-model="pinDraft"
        type="password"
        inputmode="numeric"
        autocomplete="new-password"
        :maxlength="MAX_PIN_LENGTH"
        :placeholder="`${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} 位数字`"
      />
    </label>
    <label class="field">
      <span>确认 PIN</span>
      <input
        v-model="pinConfirm"
        type="password"
        inputmode="numeric"
        autocomplete="new-password"
        :maxlength="MAX_PIN_LENGTH"
      />
    </label>

    <button type="button" :disabled="!pinReady" @click="savePin">
      {{ hasPin ? '更新 PIN' : '启用应用锁' }}
    </button>

    <p v-if="pinError !== null" class="error" role="alert">{{ pinError }}</p>
    <p v-if="pinMessage !== null" class="ok" role="status">{{ pinMessage }}</p>
  </section>

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
    <button type="button" class="ghost" @click="router.push({ name: 'data' })">
      导出与备份
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

/* ── theme + app lock ─────────────────────────────────────────────────────── */
.field {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.field > span {
  font-size: 0.85rem;
  color: var(--muted);
}

/* 16px minimum: below it, iOS Safari zooms the page on focus. */
.field input {
  width: 100%;
  min-height: 44px;
  padding: 0 0.7rem;
  font: inherit;
  font-size: 16px;
  letter-spacing: 0.2em;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.segmented button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  cursor: pointer;
}

.segmented button.active {
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}

.actions button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.55rem;
  cursor: pointer;
}

.ghost.danger {
  color: var(--danger);
  border-color: var(--danger);
}

/*
 * The budget-cycle row.
 *
 * This class was referenced in the template with no rule behind it, so the `<select>` fell
 * back to the browser default (~19px tall) and the button had no styling at all. A static CSS
 * audit cannot see a control that never declares a height, which is how it survived the
 * 44px check until a browser measured the rendered box.
 */
.cycle-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.cycle-row select {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 0.6rem;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.cycle-row button {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  border-radius: 0.55rem;
  cursor: pointer;
}

.cycle-row button:disabled {
  opacity: 0.55;
  cursor: default;
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
  color: var(--on-accent);
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
