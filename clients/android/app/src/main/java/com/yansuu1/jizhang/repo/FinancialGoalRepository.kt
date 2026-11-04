package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.ui.PendingFinancialOperation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class FinancialGoalUnsupportedException(message: String, cause: Throwable? = null) : Exception(message, cause)

class FinancialGoalRepository(private val api: ApiClient) {

    suspend fun load(from: Long? = null, to: Long? = null): FinancialGoalView = withContext(Dispatchers.IO) {
        val query = mutableMapOf<String, String>()
        if (from != null) query["from"] = from.toString()
        if (to != null) query["to"] = to.toString()
        try {
            val json = api.get("/api/v1/financial-goals", query)
            FinancialGoalView.fromJson(json)
        } catch (e: ApiException) {
            if (e.status == 404) {
                throw FinancialGoalUnsupportedException("当前服务端不支持存钱与投资进度接口 (404)，请升级服务端。", e)
            }
            throw e
        }
    }

    suspend fun putOpening(
        goal: ManualGoal,
        openingCents: Long,
        openingAt: Long,
        expectedRevision: Long,
        operationId: String,
    ): FinancialGoalView = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("goal", goal.wireValue)
            put("openingCents", openingCents)
            put("openingAt", openingAt)
            put("expectedRevision", expectedRevision)
            put("operationId", operationId)
        }
        val json = api.put("/api/v1/financial-goals/opening", body)
        FinancialGoalView.fromJson(json)
    }

    suspend fun listEntries(
        goal: ManualGoal? = null,
        from: Long? = null,
        to: Long? = null,
        limit: Int? = null,
        cursor: String? = null,
        includeDeleted: Boolean = false,
    ): FinancialGoalEntryPageView = withContext(Dispatchers.IO) {
        val query = mutableMapOf<String, String>()
        if (goal != null) query["goal"] = goal.wireValue
        if (from != null) query["from"] = from.toString()
        if (to != null) query["to"] = to.toString()
        if (limit != null) query["limit"] = limit.toString()
        if (!cursor.isNullOrBlank()) query["cursor"] = cursor
        if (includeDeleted) query["includeDeleted"] = "true"

        val json = api.get("/api/v1/financial-goals/entries", query)
        FinancialGoalEntryPageView.fromJson(json)
    }

    suspend fun createEntry(
        goal: ManualGoal,
        kind: ManualGoalEntryKind,
        amountCents: Long,
        date: Long,
        note: String,
        expectedRevision: Long,
        operationId: String,
    ): FinancialGoalView = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("goal", goal.wireValue)
            put("kind", kind.wireValue)
            put("amountCents", amountCents)
            put("date", date)
            put("note", note)
            put("expectedRevision", expectedRevision)
            put("operationId", operationId)
        }
        val json = api.post("/api/v1/financial-goals/entries", body)
        FinancialGoalView.fromJson(json)
    }

    suspend fun patchEntry(
        entryId: String,
        goal: ManualGoal? = null,
        kind: ManualGoalEntryKind? = null,
        amountCents: Long? = null,
        date: Long? = null,
        note: String? = null,
        expectedRevision: Long,
        operationId: String,
    ): FinancialGoalView = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            if (goal != null) put("goal", goal.wireValue)
            if (kind != null) put("kind", kind.wireValue)
            if (amountCents != null) put("amountCents", amountCents)
            if (date != null) put("date", date)
            if (note != null) put("note", note)
            put("expectedRevision", expectedRevision)
            put("operationId", operationId)
        }
        val json = api.patch("/api/v1/financial-goals/entries/$entryId", body)
        FinancialGoalView.fromJson(json)
    }

    suspend fun deleteEntry(
        entryId: String,
        expectedRevision: Long,
        operationId: String,
    ): FinancialGoalView = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("expectedRevision", expectedRevision)
            put("operationId", operationId)
        }
        val json = api.delete("/api/v1/financial-goals/entries/$entryId", body = body)
        FinancialGoalView.fromJson(json)
    }

    suspend fun operation(operationId: String): JSONObject = withContext(Dispatchers.IO) {
        api.get("/api/v1/financial-goals/operations/$operationId")
    }

    suspend fun sendExact(operation: PendingFinancialOperation): FinancialGoalView = withContext(Dispatchers.IO) {
        val body = JSONObject(operation.payloadJson)
        val json = when (operation.method.uppercase()) {
            "PUT" -> api.put(operation.path, body)
            "POST" -> api.post(operation.path, body)
            "PATCH" -> api.patch(operation.path, body)
            "DELETE" -> api.delete(operation.path, body)
            else -> throw IllegalArgumentException("不支持的手动财务目标操作方法: ${operation.method}")
        }
        FinancialGoalView.fromJson(json)
    }

    suspend fun operationResult(operationId: String): FinancialOperationResult = withContext(Dispatchers.IO) {
        val root = operation(operationId)
        val target = if (root.has("operation") && !root.isNull("operation")) {
            root.getJSONObject("operation")
        } else {
            root
        }
        val result = FinancialOperationResult.fromJson(target)
        require(result.operationId == operationId) { "重放结果 operationId 不匹配" }
        result
    }
}
