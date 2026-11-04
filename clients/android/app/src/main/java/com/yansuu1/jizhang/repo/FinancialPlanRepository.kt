package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Independent Four-Purpose Financial Plan repository.
 * Consumes `/api/v1/financial-plan` endpoints per contract.md.
 *
 * Rules:
 * - Preview never writes (read-only calculation on server).
 * - Save passes expectedRevision for CAS optimistic concurrency.
 * - Initial unread/error state must not be overwritten.
 * - No client financial calculations; all derived figures come from server Analysis.
 * - Strict wire schema validation (fail-close).
 */
class FinancialPlanRepository(private val api: ApiClient) {

    suspend fun getPlan(): SavedFinancialPlan? = withContext(Dispatchers.IO) {
        val response = api.get("/api/v1/financial-plan")
        require(response.has("plan")) { "响应缺少 plan 字段" }
        if (response.isNull("plan")) {
            null
        } else {
            SavedFinancialPlan.fromJson(response.getJSONObject("plan"))
        }
    }

    suspend fun preview(inputs: FinancialPlanInputs): FinancialPlanAnalysis = withContext(Dispatchers.IO) {
        val response = api.post("/api/v1/financial-plan/preview", inputs.toJson())
        require(response.has("analysis") && !response.isNull("analysis")) { "响应缺少 analysis 字段" }
        FinancialPlanAnalysis.fromJson(response.getJSONObject("analysis"))
    }

    suspend fun savePlan(request: FinancialPlanSaveRequest): SavedFinancialPlan = withContext(Dispatchers.IO) {
        val response = api.put("/api/v1/financial-plan", request.toJson())
        require(response.has("plan") && !response.isNull("plan")) { "响应缺少 plan 字段" }
        SavedFinancialPlan.fromJson(response.getJSONObject("plan"))
    }
}
