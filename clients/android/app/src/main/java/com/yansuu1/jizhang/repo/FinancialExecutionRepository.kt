package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Phase 1 financial-execution repository.
 *
 * Consumes the frozen `/api/v1/financial-planning` contract (child contract.md).
 * All typing/validation lives in [FinancialExecutionModels]; this class only
 * builds safe paths/queries, executes the request on Dispatchers.IO and hands the
 * raw JSON to the matching typed decoder. No figure is calculated on Android.
 *
 * Error semantics:
 * - HTTP 401 is left as [AuthExpiredException] for the UI session guard.
 * - `GET capabilities` 404 means an old server without FP support and is mapped
 *   to [FinancialExecutionUnsupportedException]; 5xx/transport stay retryable.
 * - All other 404s remain normal [ApiException] resource errors.
 */
class FinancialExecutionRepository(private val api: ApiClient) {

    suspend fun getCapabilities(): FinancialCapabilitiesResponse = withContext(Dispatchers.IO) {
        val response = try {
            api.get("$BASE/capabilities")
        } catch (error: ApiException) {
            throw financialCapabilitiesFailure(error)
        }
        FinancialCapabilitiesResponse.fromJson(response)
    }

    suspend fun getConfig(): FinancialConfigResponse = withContext(Dispatchers.IO) {
        FinancialConfigResponse.fromJson(api.get("$BASE/config"))
    }

    suspend fun updateConfig(request: FinancialConfigUpdateRequest): FinancialConfigUpdateResponse =
        withContext(Dispatchers.IO) {
            FinancialConfigUpdateResponse.fromJson(api.put("$BASE/config", request.toJson()))
        }

    suspend fun getCurrentExecution(): FinancialCurrentExecutionResponse = withContext(Dispatchers.IO) {
        FinancialCurrentExecutionResponse.fromJson(api.get("$BASE/execution"))
    }

    suspend fun getPeriodExecution(periodId: String): FinancialExecution = withContext(Dispatchers.IO) {
        val response = api.get("$BASE/periods/${segment(periodId)}/execution")
        requirement(response, "execution")
        FinancialExecution.fromJson(response.getJSONObject("execution"))
    }

    suspend fun getPeriodDetails(
        periodId: String,
        purpose: FinancialDetailPurpose? = null,
        kind: FinancialDetailKind? = null,
        limit: Int = DEFAULT_PAGE_SIZE,
        offset: Int = 0,
    ): FinancialExecutionDetailsResponse = withContext(Dispatchers.IO) {
        requirePage(limit, offset)
        val query = buildMap {
            if (purpose != null) put("purpose", purpose.wire)
            if (kind != null) put("kind", kind.wire)
            put("limit", limit.toString())
            put("offset", offset.toString())
        }
        FinancialExecutionDetailsResponse.fromJson(
            api.get("$BASE/periods/${segment(periodId)}/details", query),
        )
    }

    suspend fun getPeriods(
        limit: Int = DEFAULT_PAGE_SIZE,
        offset: Int = 0,
    ): FinancialPeriodsResponse = withContext(Dispatchers.IO) {
        requirePage(limit, offset)
        FinancialPeriodsResponse.fromJson(
            api.get("$BASE/periods", pageQuery(limit, offset)),
        )
    }

    suspend fun getPeriod(
        periodId: String,
        revision: Long? = null,
    ): FinancialPeriodResponse = withContext(Dispatchers.IO) {
        require(revision == null || revision >= 0) { "revision 不能为负数" }
        val query = if (revision == null) emptyMap() else mapOf("revision" to revision.toString())
        FinancialPeriodResponse.fromJson(
            api.get("$BASE/periods/${segment(periodId)}", query),
        )
    }

    suspend fun getPeriodRevisions(
        periodId: String,
        limit: Int = DEFAULT_PAGE_SIZE,
        offset: Int = 0,
    ): FinancialPeriodRevisionsResponse = withContext(Dispatchers.IO) {
        requirePage(limit, offset)
        FinancialPeriodRevisionsResponse.fromJson(
            api.get(
                "$BASE/periods/${segment(periodId)}/revisions",
                pageQuery(limit, offset),
            ),
        )
    }

    suspend fun getSalarySources(
        groupMonth: String? = null,
        timeZone: String? = null,
        limit: Int = DEFAULT_PAGE_SIZE,
        offset: Int = 0,
    ): FinancialSalarySourcesResponse = withContext(Dispatchers.IO) {
        requirePage(limit, offset)
        if (groupMonth != null) {
            require(Regex("^\\d{4}-(0[1-9]|1[0-2])$").matches(groupMonth)) { "groupMonth 必须是 YYYY-MM" }
        }
        if (timeZone != null) require(timeZone.isNotBlank()) { "timeZone 不能为空白" }
        val query = buildMap {
            if (groupMonth != null) put("groupMonth", groupMonth)
            if (timeZone != null) put("timeZone", timeZone)
            put("limit", limit.toString())
            put("offset", offset.toString())
        }
        FinancialSalarySourcesResponse.fromJson(api.get("$BASE/sources/salaries", query))
    }

    suspend fun getSalarySource(salaryId: String): FinancialSalarySourceResponse = withContext(Dispatchers.IO) {
        FinancialSalarySourceResponse.fromJson(api.get("$BASE/sources/salaries/${segment(salaryId)}"))
    }

    /** Pure read: preview never creates rows. */
    suspend fun previewPeriod(proposal: FinancialPeriodProposal): FinancialPreview = withContext(Dispatchers.IO) {
        val response = api.post("$BASE/periods/preview", proposal.toJson())
        requirement(response, "preview")
        FinancialPreview.fromJson(response.getJSONObject("preview"), response)
    }

    suspend fun confirmPeriod(request: FinancialPeriodConfirmRequest): FinancialPeriodConfirmResponse =
        withContext(Dispatchers.IO) {
            FinancialPeriodConfirmResponse.fromJson(
                api.post("$BASE/periods/confirm", request.toJson()),
            )
        }

    suspend fun reconcilePeriod(
        periodId: String,
        request: FinancialPeriodConfirmRequest,
    ): FinancialPeriodConfirmResponse = withContext(Dispatchers.IO) {
        FinancialPeriodConfirmResponse.fromJson(
            api.post("$BASE/periods/${segment(periodId)}/reconcile", request.toJson()),
        )
    }

    suspend fun getCategoryRules(): FinancialCategoryRulesResponse = withContext(Dispatchers.IO) {
        FinancialCategoryRulesResponse.fromJson(api.get("$BASE/category-rules"))
    }

    suspend fun updateCategoryRules(
        request: FinancialCategoryRulesUpdateRequest,
    ): FinancialCategoryRulesResponse = withContext(Dispatchers.IO) {
        FinancialCategoryRulesResponse.fromJson(api.put("$BASE/category-rules", request.toJson()))
    }

    suspend fun getBillPurpose(transactionId: String): FinancialBillPurposeResponse =
        withContext(Dispatchers.IO) {
            FinancialBillPurposeResponse.fromJson(
                api.get("$BASE/bill-purposes/${segment(transactionId)}"),
            )
        }

    suspend fun updateBillPurpose(
        transactionId: String,
        request: FinancialBillPurposeUpdateRequest,
    ): FinancialBillPurposeUpdateResponse = withContext(Dispatchers.IO) {
        FinancialBillPurposeUpdateResponse.fromJson(
            api.put("$BASE/bill-purposes/${segment(transactionId)}", request.toJson()),
        )
    }

    /**
     * Omit [state] for all live refund income; only `review-required` is a frozen
     * filter value in Phase 1.
     */
    suspend fun getRefunds(
        state: String? = null,
        limit: Int = DEFAULT_PAGE_SIZE,
        offset: Int = 0,
    ): FinancialRefundReviewsResponse = withContext(Dispatchers.IO) {
        requirePage(limit, offset)
        if (state != null) require(state == "review-required") { "不支持的退款筛选状态：$state" }
        val query = buildMap {
            if (state != null) put("state", state)
            put("limit", limit.toString())
            put("offset", offset.toString())
        }
        FinancialRefundReviewsResponse.fromJson(api.get("$BASE/refunds", query))
    }

    suspend fun getRefund(refundTransactionId: String): FinancialRefundResponse =
        withContext(Dispatchers.IO) {
            FinancialRefundResponse.fromJson(
                api.get("$BASE/refunds/${segment(refundTransactionId)}"),
            )
        }

    suspend fun updateRefundSplits(
        refundTransactionId: String,
        request: FinancialRefundSplitsUpdateRequest,
    ): FinancialRefundSplitsUpdateResponse = withContext(Dispatchers.IO) {
        FinancialRefundSplitsUpdateResponse.fromJson(
            api.put("$BASE/refunds/${segment(refundTransactionId)}/splits", request.toJson()),
        )
    }

    suspend fun getOperation(operationId: String): FinancialOperationResult = withContext(Dispatchers.IO) {
        FinancialOperationResult.fromJson(api.get("$BASE/operations/${segment(operationId)}"))
    }

    /**
     * Exact replay of a persisted pending mutation. The UI owns the pending store;
     * this method sends the SAME method/resource/payload it saved before the first
     * attempt and returns the raw JSON so the caller can run the typed decoder.
     *
     * Restricted on purpose: only financial-planning mutations and the salary /
     * transaction endpoints that accept `operationId` may be replayed. Arbitrary
     * origins, queries, fragments and traversal are rejected.
     */
    suspend fun replayOperation(
        method: String,
        resource: String,
        payload: JSONObject,
    ): JSONObject = withContext(Dispatchers.IO) {
        val normalizedMethod = method.uppercase(java.util.Locale.ROOT)
        require(normalizedMethod in setOf("POST", "PUT", "PATCH")) { "不支持的待重放方法：$method" }
        require(isFinancialReplayResourceAllowed(resource)) { "不允许的待重放资源：$resource" }
        when (normalizedMethod) {
            "POST" -> api.post(resource, payload)
            "PUT" -> api.put(resource, payload)
            else -> api.patch(resource, payload)
        }
    }

    private fun pageQuery(limit: Int, offset: Int): Map<String, String> = mapOf(
        "limit" to limit.toString(),
        "offset" to offset.toString(),
    )

    private fun requirePage(limit: Int, offset: Int) {
        require(limit in 1..FinancialExecutionContract.MAX_PAGE_SIZE) { "limit 必须在 1..100" }
        require(offset >= 0) { "offset 不能为负数" }
    }

    private fun requirement(response: JSONObject, key: String) {
        require(response.has(key) && !response.isNull(key)) { "响应缺少字段：$key" }
    }

    private fun segment(value: String): String {
        require(value.isNotBlank()) { "路径 ID 不能为空白" }
        require(value.length <= 128) { "路径 ID 过长" }
        return URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }

    private companion object {
        const val BASE = "/api/v1/financial-planning"
        const val DEFAULT_PAGE_SIZE = 50
    }
}

/**
 * Replay allowlist. Case-sensitive paths only; encoded dots/slashes, backslashes,
 * traversal and query/fragment/absolute URLs are rejected before any request.
 */
internal fun isFinancialReplayResourceAllowed(resource: String): Boolean {
    if (!resource.startsWith("/") || resource.length > 512) return false
    if (resource.contains("?") || resource.contains("#") || resource.contains("://")) return false
    if (resource.contains("..") || resource.contains("\\") || resource.contains("//")) return false
    if (resource.any { it.isWhitespace() || it.isISOControl() }) return false
    val lower = resource.lowercase(java.util.Locale.ROOT)
    if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c") || lower.contains("%00")) {
        return false
    }
    return resource.startsWith("/api/v1/financial-planning/") ||
        resource == "/api/v1/salaries" ||
        resource.startsWith("/api/v1/salaries/") ||
        resource == "/api/v1/transactions" ||
        resource.startsWith("/api/v1/transactions/")
}

/** Old authenticated server without the Phase 1 financial-planning routes. */
class FinancialExecutionUnsupportedException(
    message: String = "当前服务端不支持财务执行功能",
    cause: Throwable? = null,
) : Exception(message, cause)

internal fun financialCapabilitiesFailure(error: ApiException): Exception =
    if (error is AuthExpiredException || error.status != 404) {
        error
    } else {
        FinancialExecutionUnsupportedException(error.message ?: "当前服务端不支持财务执行功能", error)
    }
