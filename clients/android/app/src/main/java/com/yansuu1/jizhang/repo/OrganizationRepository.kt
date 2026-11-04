package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.ui.feature.assistant.OrganizationApplyResult
import com.yansuu1.jizhang.ui.feature.assistant.OrganizationCard
import com.yansuu1.jizhang.ui.feature.assistant.OrganizationRun
import com.yansuu1.jizhang.ui.feature.assistant.parseOrganizationApplyResult
import com.yansuu1.jizhang.ui.feature.assistant.parseOrganizationCard
import com.yansuu1.jizhang.ui.feature.assistant.parseOrganizationRun
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * AI spending organization against the dedicated run/card/apply/undo routes.
 *
 * Analysis starts a background run with an exact-replay request identity.
 * Status GETs only observe it and never start provider work.
 * The server owns eligibility, the card fingerprint,
 * idempotent apply replay and conditional undo.
 */
internal class OrganizationRepository(private val api: ApiClient) {
    fun sessionValid(): Boolean = !api.sessionExpired.value

    suspend fun startAnalysis(startDate: String, endDate: String, clientRequestId: String): OrganizationRun =
        withContext(Dispatchers.IO) {
            val body = organizationStartBody(startDate, endDate, clientRequestId)
            parseOrganizationRun(
                api.post(
                    "/api/v1/ai/organization-runs",
                    body,
                    timeoutMs = 30_000L,
                ),
            )
        }

    suspend fun resumeAnalysis(runId: String, clientRequestId: String): OrganizationRun =
        withContext(Dispatchers.IO) {
            parseOrganizationRun(api.post(
                "/api/v1/ai/organization-runs/${encode(runId)}/resume",
                organizationResumeBody(clientRequestId),
                timeoutMs = 30_000L,
            ))
        }

    suspend fun getRun(runId: String): OrganizationRun =
        withContext(Dispatchers.IO) {
            parseOrganizationRun(api.get("/api/v1/ai/organization-runs/${encode(runId)}"))
        }

    suspend fun getCard(runId: String): OrganizationCard =
        withContext(Dispatchers.IO) {
            parseOrganizationCard(api.get("/api/v1/ai/organization-runs/${encode(runId)}/card"))
        }

    suspend fun apply(runId: String, actionIds: List<String>): OrganizationApplyResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("actionIds", JSONArray(actionIds))
            parseOrganizationApplyResult(
                api.post(
                    "/api/v1/ai/organization-runs/${encode(runId)}/apply",
                    body,
                    timeoutMs = 2 * 60 * 1000L,
                ),
            )
        }

    suspend fun undo(operationId: String): OrganizationApplyResult =
        withContext(Dispatchers.IO) {
            parseOrganizationApplyResult(
                api.post(
                    "/api/v1/ai/organization-operations/${encode(operationId)}/undo",
                    JSONObject(),
                    timeoutMs = 2 * 60 * 1000L,
                ),
            )
        }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}

internal fun organizationResumeBody(clientRequestId: String): JSONObject {
    require(java.util.UUID.fromString(clientRequestId).toString() == clientRequestId) { "请求编号必须为 UUID。" }
    return JSONObject().put("clientRequestId", clientRequestId)
}

internal fun organizationStartBody(startDate: String, endDate: String, clientRequestId: String): JSONObject {
    require(java.util.UUID.fromString(clientRequestId).toString() == clientRequestId) { "请求编号必须为 UUID。" }
    return JSONObject().put("startDate", startDate).put("endDate", endDate)
        .put("background", true).put("clientRequestId", clientRequestId)
}
