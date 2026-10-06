package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Budget domain (A4). Mirrors `api.budget/salaries/templates/settings`:
 * every figure is server-computed; unknown `periodStart` is a server 400,
 * never a silent fallback (backend spec: naming a budget cycle).
 */
class BudgetRepository(private val api: ApiClient) {
    suspend fun overview(periodStart: Long? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val q = if (periodStart == null) emptyMap() else mapOf("periodStart" to periodStart.toString())
            api.get("/api/v1/budget/overview", q)
        }

    suspend fun periods(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/budget/periods") }

    suspend fun salaries(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/salaries") }

    suspend fun createSalary(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/salaries", JSONObject(input))
        }

    suspend fun removeSalary(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/salaries/$id") }

    suspend fun templates(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/templates") }

    suspend fun createTemplate(name: String, modules: List<Map<String, Any?>>, isDefault: Boolean = false): JSONObject =
        withContext(Dispatchers.IO) {
            api.post(
                "/api/v1/templates",
                JSONObject()
                    .put("name", name)
                    .put("modules", org.json.JSONArray(modules.map { JSONObject(it) }))
                    .put("isDefault", isDefault),
            )
        }

    suspend fun updateTemplate(id: String, changes: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/templates/$id", JSONObject(changes))
        }

    suspend fun removeTemplate(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/templates/$id") }

    suspend fun setDefaultTemplate(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/templates/$id/default") }

    suspend fun applyTemplateToCurrent(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/templates/$id/apply-current") }

    suspend fun getSettings(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/settings") }

    suspend fun setCycleStartDay(day: Int?): JSONObject =
        withContext(Dispatchers.IO) {
            api.put(
                "/api/v1/settings",
                JSONObject().put("cycleStartDay", day ?: JSONObject.NULL),
            )
        }
}

/** Recurring bills (A5 slice, surfaced on dashboard + its own tab later). */
class RecurringRepository(private val api: ApiClient) {
    suspend fun rules(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/recurring/rules") }

    suspend fun createRule(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/recurring/rules", JSONObject(input))
        }

    suspend fun updateRule(id: String, changes: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/recurring/rules/$id", JSONObject(changes))
        }

    suspend fun removeRule(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/recurring/rules/$id") }

    suspend fun setEnabled(id: String, enabled: Boolean): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/recurring/rules/$id/enabled", JSONObject().put("enabled", enabled))
        }

    /** Explicit POST, idempotent — never a GET side effect (backend spec). */
    suspend fun generate(): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/recurring/generate") }

    suspend fun pending(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/recurring/pending") }

    /** Idempotent: repeat returns the same bill with `created:false`. */
    suspend fun confirm(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/recurring/occurrences/$id/confirm") }

    suspend fun ignore(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/recurring/occurrences/$id/ignore") }
}

/** Statistics (A6 slice, rendered on dashboard + stats tab later). */
class StatsRepository(private val api: ApiClient) {
    suspend fun categoryShare(from: Long, to: Long): JSONObject =
        withContext(Dispatchers.IO) {
            api.get(
                "/api/v1/stats/category-share",
                mapOf("from" to from.toString(), "to" to to.toString()),
            )
        }

    suspend fun monthlyTrend(months: Int = 6): JSONObject =
        withContext(Dispatchers.IO) {
            api.get("/api/v1/stats/monthly-trend", mapOf("months" to months.toString()))
        }

    suspend fun poolTrend(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/stats/pool-trend") }
}
