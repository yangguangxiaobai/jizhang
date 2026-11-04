package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Old servers have no additive monthly-plan endpoint; never treat that as an empty plan. */
class MonthlyPlanUnsupportedException(cause: Throwable? = null) :
    IllegalStateException("当前服务不支持月计划，请使用明细工具中的旧版预算。", cause)

/**
 * Read-only repository for the server-owned monthly-plan view. Android forwards the exact
 * server cents/window and does not derive or aggregate any amounts.
 */
class MonthlyPlanRepository(private val api: ApiClient) {
    suspend fun load(periodId: String? = null, month: String? = null): MonthlyPlanView =
        withContext(Dispatchers.IO) {
            require(periodId == null || periodId.isNotBlank()) { "periodId 不能为空白" }
            require(month == null || Regex("^\\d{4}-(0[1-9]|1[0-2])$").matches(month)) {
                "month 必须为 YYYY-MM"
            }
            require(periodId == null || month == null) { "periodId 与 month 不能同时指定" }

            val query = buildMap {
                if (periodId != null) put("periodId", periodId)
                if (month != null) put("month", month)
            }
            val response = try {
                api.get(MonthlyPlanContract.PATH, query)
            } catch (error: ApiException) {
                // With no explicit period selection, a 404 means this older server has
                // no route. For a periodId request, preserve the normal resource 404.
                if (error.status == 404 && periodId == null) {
                    throw MonthlyPlanUnsupportedException(error)
                }
                throw error
            }
            MonthlyPlanView.fromJson(response)
        }
}
