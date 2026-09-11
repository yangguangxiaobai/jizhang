/**
 * Session state.
 *
 * The session itself lives in an httpOnly cookie the browser sends automatically, so
 * there is no token in JS to manage (design.md §5). This store only tracks *whether*
 * we are signed in, so the router can gate navigation without a flash of the wrong
 * page.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError, OfflineError, api } from '../api/client.js';

export const useAuthStore = defineStore('auth', () => {
  const username = ref<string | null>(null);
  const checked = ref(false);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);

  /** Resolves the current session. Safe to call repeatedly; used by the router guard. */
  async function refresh(): Promise<void> {
    try {
      const me = await api.auth.me();
      username.value = me.username;
    } catch (error) {
      // 401 is the normal "not signed in" answer, not a failure worth surfacing.
      username.value = null;
      if (!(error instanceof ApiError && error.isUnauthorized)) {
        errorMessage.value =
          error instanceof Error ? error.message : String(error);
      }
    } finally {
      checked.value = true;
    }
  }

  async function login(name: string, password: string): Promise<boolean> {
    loading.value = true;
    errorMessage.value = null;
    try {
      const me = await api.auth.login(name, password);
      username.value = me.username;
      return true;
    } catch (error) {
      errorMessage.value =
        error instanceof OfflineError || error instanceof ApiError
          ? error.message
          : '登录失败，请重试。';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.auth.logout();
    } catch {
      // Clearing local state is what matters; the server session may already be gone.
    }
    username.value = null;
  }

  return { username, checked, loading, errorMessage, refresh, login, logout };
});
