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
import AppIcon from '../components/AppIcon.vue';
import {
  setAccentPreset,
  setThemePreference,
  useTheme,
  type AccentPreset,
  type ThemePreference,
} from '../composables/useTheme.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();
const { preference: themePreference, accent: accentPreset } = useTheme();

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: 'system' | 'sun' | 'moon' }[] =
  [
    { value: 'system', label: '跟随系统', icon: 'system' },
    { value: 'light', label: '浅色', icon: 'sun' },
    { value: 'dark', label: '深色', icon: 'moon' },
  ];

/** The labels are what `scripts/render-color.mjs` clicks; keep them in step. */
const ACCENT_OPTIONS: { value: AccentPreset; label: string; description: string }[] = [
  { value: 'titanium', label: '钛蓝', description: '温暖底色，沉静深蓝' },
  { value: 'forest', label: '森林绿', description: '自然留白，柔和青绿' },
  { value: 'mono', label: '极简黑白', description: '克制中性，清晰层次' },
];

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
  <section class="theme-card card appearance">
    <div class="appearance-intro">
      <p class="hint kicker">让记账，也赏心悦目</p>
      <h2>外观</h2>
      <p class="hint">选一种喜欢的日常，深浅色默认跟随系统。</p>
    </div>
    <h3>显示模式</h3>
    <div class="segmented" role="group" aria-label="深浅色">
      <button
        class="theme-button"
        v-for="option in THEME_OPTIONS"
        :key="option.value"
        type="button"
        :class="{ active: themePreference === option.value }"
        :aria-pressed="themePreference === option.value"
        @click="setThemePreference(option.value)"
      >
        <AppIcon :name="option.icon" />{{ option.label }}
      </button>
    </div>

    <h3 class="accent-heading">主题风格</h3>
    <div class="presets" role="group" aria-label="主色">
      <button
        v-for="option in ACCENT_OPTIONS"
        :key="option.value"
        type="button"
        class="theme-button preset"
        :class="{ active: accentPreset === option.value }"
        :aria-label="option.label"
        :aria-describedby="'preset-' + option.value + '-description'"
        :aria-pressed="accentPreset === option.value"
        @click="setAccentPreset(option.value)"
      >
        <!-- Only this decorative child receives a preview palette; the button keeps the actual theme. -->
        <svg
          class="theme-preview"
          :data-accent="option.value"
          viewBox="0 0 64 54"
          aria-hidden="true"
          focusable="false"
        >
          <rect width="64" height="54" rx="6" style="fill: var(--bg)" />
          <rect x="7" y="7" width="50" height="24" rx="4" style="fill: var(--hero)" />
          <path d="M13 18h20" stroke-width="2" style="stroke: var(--on-hero)" />
          <rect x="7" y="37" width="23" height="10" rx="2" style="fill: var(--surface)" />
          <rect x="34" y="37" width="23" height="10" rx="2" style="fill: var(--surface)" />
        </svg>
        <span class="preset-copy">
          <strong>{{ option.label }}</strong>
          <span :id="'preset-' + option.value + '-description'">{{ option.description }}</span>
        </span>
        <span class="selection" aria-hidden="true"
          ><AppIcon v-if="accentPreset === option.value" name="check"
        /></span>
      </button>
    </div>
    <p class="hint appearance-note">主色、背景与重点卡片一起变化。收入、预警等状态色保持一致。</p>
  </section>

  <section class="theme-card card">
    <h2>账号</h2>
    <dl>
      <div>
        <dt>用户名</dt>
        <dd>{{ auth.username }}</dd>
      </div>
    </dl>
    <button type="button" class="theme-button ghost" @click="signOut">退出登录</button>
  </section>

  <section class="theme-card card">
    <h2>数据管理</h2>
    <p class="hint">分类的图标与颜色、账户、标签的重命名与删除。</p>
    <button type="button" class="theme-button ghost" @click="router.push({ name: 'manage' })">
      分类与账户管理
    </button>
    <button type="button" class="theme-button ghost" @click="router.push({ name: 'templates' })">
      分配模板
    </button>
    <button
      type="button"
      class="theme-button ghost"
      @click="router.push({ name: 'salary-records' })"
    >
      工资记录
    </button>
    <button type="button" class="theme-button ghost" @click="router.push({ name: 'trash' })">
      回收站
    </button>
    <button
      type="button"
      class="theme-button ghost"
      @click="router.push({ name: 'recurring-rules' })"
    >
      周期账单
    </button>
    <button type="button" class="theme-button ghost" @click="router.push({ name: 'data' })">
      导出与备份
    </button>
  </section>

  <section class="theme-card card">
    <h2>预算周期</h2>
    <p class="hint">默认按自然月划分周期。也可以指定每月某一天为周期起点（例如发薪日 15 号）。</p>
    <div class="cycle-row">
      <select v-model.number="cycleDayChoice">
        <option :value="0">自然月（默认）</option>
        <option v-for="day in 28" :key="day" :value="day">每月 {{ day }} 号</option>
      </select>
      <button class="theme-button" type="button" :disabled="cycleSaving" @click="saveCycle">
        保存
      </button>
    </div>
    <p v-if="cycleMessage" class="ok" role="status">{{ cycleMessage }}</p>
    <p v-if="cycleError" class="error" role="alert">{{ cycleError }}</p>
  </section>

  <section class="theme-card card">
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

      <button class="theme-button" type="submit" :disabled="saving">
        {{ saving ? '提交中…' : '修改密码' }}
      </button>
    </form>
  </section>

  <section class="theme-card card">
    <h2>关于</h2>
    <p class="hint">信封预算法记账 · 自建部署。预算、统计与模板功能在后续任务中加入。</p>
  </section>
</template>

<style scoped>
h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.appearance-intro h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.appearance .kicker {
  color: var(--accent);
}

.appearance h3 {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
  padding: 0.3rem;
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.segmented button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 60px;
  padding: 0.4rem 0.1rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--muted);
  background: none;
}

.segmented button.active {
  color: var(--accent);
  background: var(--surface);
  box-shadow: var(--lift-1);
  font-weight: 650;
}

.appearance .accent-heading {
  margin-top: 1.5rem;
}

.presets {
  display: grid;
  gap: 0.65rem;
}

.preset {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.75rem;
  text-align: left;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
}

.preset.active {
  border-color: var(--accent);
  background: var(--surface-soft);
}

.theme-preview {
  flex-shrink: 0;
  width: 3.6rem;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
}

.preset-copy {
  display: grid;
  flex: 1 1 7rem;
  gap: 0.25rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.preset-copy strong {
  font-size: 0.9rem;
}

.preset-copy > span {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--muted);
}

.selection {
  flex-shrink: 0;
  width: 1.25rem;
  margin-left: auto;
  color: var(--accent);
}

.appearance .appearance-note {
  margin: 1rem 0 0;
}

.cycle-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.cycle-row select {
  flex: 1;
  min-width: 0;
  font-family: inherit;
}

.cycle-row button {
  flex-shrink: 0;
  padding: 0 1rem;
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

input,
.cycle-row select {
  font-size: 16px;
  min-height: 44px;
  padding: 0.5rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
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
  color: var(--ok);
  font-size: 0.85rem;
}
</style>
