package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Auth repository (A2). Mirrors web `stores/auth.ts` + `api.auth`:
 * - `refresh()` → `GET auth/me`; 401 is "not signed in", not an error to surface.
 * - `login(name, password)` → `POST auth/login` (CSRF header included by ApiClient).
 * - `logout()` → `POST auth/logout` (bodiless, no Content-Type per N4);
 *   local state is cleared even if the call fails.
 * - `changePassword()` → `POST auth/password`.
 */
class AuthRepository(private val api: ApiClient) {
    var username: String? = null
        private set
    var checked: Boolean = false
        private set
    var lastError: String? = null
        private set

    suspend fun refresh() = withContext(Dispatchers.IO) {
        try {
            val me = api.get("/api/v1/auth/me")
            username = me.optString("username").ifEmpty { null }
            lastError = null
        } catch (e: AuthExpiredException) {
            username = null
        } catch (e: Exception) {
            username = null
            lastError = e.message
        } finally {
            checked = true
        }
    }

    suspend fun login(name: String, password: String): Boolean = withContext(Dispatchers.IO) {
        lastError = null
        try {
            val me = api.post(
                "/api/v1/auth/login",
                JSONObject().put("username", name).put("password", password),
            )
            username = me.optString("username").ifEmpty { null }
            true
        } catch (e: Exception) {
            lastError = e.message ?: "登录失败，请重试。"
            false
        }
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        try {
            api.post("/api/v1/auth/logout")
        } catch (_: Exception) {
            // Clearing local state is what matters; the server session may be gone.
        } finally {
            api.clearSession()
            username = null
        }
    }

    suspend fun changePassword(current: String, next: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                api.post(
                    "/api/v1/auth/password",
                    JSONObject().put("currentPassword", current).put("newPassword", next),
                )
                Result.success(Unit)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
}
