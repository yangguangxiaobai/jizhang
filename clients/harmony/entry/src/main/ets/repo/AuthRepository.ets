// Auth repository (H1). Mirrors Android AuthRepository + web `stores/auth.ts`:
// - `refresh()` → `GET auth/me`; 401 is "not signed in", not a surfaced error.
// - `login(name, password)` → `POST auth/login` (CSRF header by ApiClient).
// - `logout()` → `POST auth/logout` (bodiless, N4); local state cleared anyway.
// - `changePassword()` → `POST auth/password`.

import { call, clearSession, ApiError } from '../net/ApiClient';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface MeInfo {
  username: string;
  expiresAt: number;
}

export class AuthRepository {
  username: string = '';
  checked: boolean = false;
  lastError: string = '';

  async refresh(): Promise<void> {
    try {
      const text = await call('/api/v1/auth/me');
      const me = JSON.parse(text) as MeInfo;
      this.username = me.username ?? '';
      this.lastError = '';
    } catch (e) {
      this.username = '';
      if (!(e instanceof ApiError && e.isUnauthorized)) {
        this.lastError = String(e);
      }
    } finally {
      this.checked = true;
    }
  }

  async login(name: string, password: string): Promise<boolean> {
    this.lastError = '';
    try {
      const text = await call('/api/v1/auth/login', {
        method: 'POST',
        body: { username: name, password: password },
      });
      const me = JSON.parse(text) as MeInfo;
      this.username = me.username ?? '';
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await call('/api/v1/auth/logout', { method: 'POST' });
    } catch (e) {
      hilog.error(0x0000, 'jizhang', 'logout call failed: %{public}s', String(e));
    } finally {
      await clearSession();
      this.username = '';
    }
  }

  async changePassword(current: string, next: string): Promise<void> {
    await call('/api/v1/auth/password', {
      method: 'POST',
      body: { currentPassword: current, newPassword: next },
    });
  }
}
