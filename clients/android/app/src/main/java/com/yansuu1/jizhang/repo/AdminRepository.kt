package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Master-data admin (A7). Mirrors `api.categories/accounts/tagsAdmin` + T7 rules:
 * - builtin rows: renamable, NOT deletable (server enforces; UI labels 内建).
 * - delete is soft: confirmation shows referencing-transaction count via `usage`.
 * - tags have no table: rename/delete rewrites referencing transactions server-side.
 */
class AdminRepository(private val api: ApiClient) {
    // ── categories ──
    suspend fun categories(type: Int? = null, includeDeleted: Boolean = false): JSONObject =
        withContext(Dispatchers.IO) {
            val q = mutableMapOf("includeDeleted" to includeDeleted.toString())
            if (type != null) q["type"] = type.toString()
            api.get("/api/v1/categories", q)
        }

    suspend fun createCategory(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/categories", JSONObject(input))
        }

    suspend fun updateCategory(id: String, changes: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/categories/$id", JSONObject(changes))
        }

    suspend fun removeCategory(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/categories/$id") }

    suspend fun moveCategory(id: String, dir: Int): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/categories/$id/move", JSONObject().put("dir", dir))
        }

    suspend fun categoryUsage(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/categories/$id/usage") }

    // ── accounts ──
    suspend fun accounts(includeDeleted: Boolean = false): JSONObject =
        withContext(Dispatchers.IO) {
            api.get("/api/v1/accounts", mapOf("includeDeleted" to includeDeleted.toString()))
        }

    suspend fun createAccount(name: String, type: Int, initialCents: Long = 0): JSONObject =
        withContext(Dispatchers.IO) {
            api.post(
                "/api/v1/accounts",
                JSONObject()
                    .put("name", name)
                    .put("type", type)
                    .put("initialBalanceCents", initialCents),
            )
        }

    suspend fun updateAccount(id: String, changes: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/accounts/$id", JSONObject(changes))
        }

    suspend fun removeAccount(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/accounts/$id") }

    suspend fun moveAccount(id: String, dir: Int): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/accounts/$id/move", JSONObject().put("dir", dir))
        }

    suspend fun accountUsage(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/accounts/$id/usage") }

    // ── tags (no table; name is the identity) ──
    suspend fun renameTag(from: String, to: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/tags", JSONObject().put("from", from).put("to", to))
        }

    suspend fun removeTag(name: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.delete("/api/v1/tags/${java.net.URLEncoder.encode(name, "UTF-8")}")
        }
}
