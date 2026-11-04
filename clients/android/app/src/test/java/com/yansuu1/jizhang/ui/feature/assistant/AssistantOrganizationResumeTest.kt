package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.repo.organizationResumeBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantOrganizationResumeTest {
    private val id = "1d44a879-53fb-4813-b163-4b30e840d230"
    private fun failed() = OrganizationRun("r", "failed", "2026-10-01", "2026-10-31", 65, 20,
        "AI_PROVIDER_TIMEOUT", progress = OrganizationProgress("failed", 7, 2, 3, 0, 1000, 66000,
            listOf(OrganizationProgressEvent(4, "failed", 3, 20, "分析失败", 66000)),
            OrganizationErrorDetail("analysing", null, 3)), canResume = true)
    private fun resumed() = failed().copy(status = "running", attempt = 2, canResume = false, errorCode = null,
        progress = failed().progress!!.copy(phase = "analysing", suggestionCount = 6, updatedAt = 67000,
            events = failed().progress!!.events + OrganizationProgressEvent(5, "analysing", 3, 20, "继续分析", 67000)))
    private fun wire() = JSONObject().put("runId", "r").put("status", "failed")
        .put("startDate", "2026-10-01").put("endDate", "2026-10-31")
        .put("eligibleCount", 65).put("completedCount", 20).put("errorCode", "AI_PROVIDER_TIMEOUT")

    @Test fun additiveFieldsUseLegacyDefaultsAndStrictParsing() {
        assertEquals(1, parseOrganizationRun(wire()).attempt)
        assertFalse(parseOrganizationRun(wire()).canResume)
        assertTrue(parseOrganizationRun(wire().put("attempt", 2).put("canResume", true)).resumableTimeout)
        listOf<Any>(0, -1, 1.2, "2", 2147483648L, JSONObject.NULL).forEach {
            assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(wire().put("attempt", it)) }
        }
        listOf<Any>("true", 1, JSONObject.NULL).forEach {
            assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(wire().put("canResume", it)) }
        }
    }

    @Test fun explicitRequestReusesRunAttemptAndUuidWithoutNewStartFields() {
        val request = organizationResumeRequest(failed(), null) { id }
        val replay = organizationResumeRequest(failed(), request) { error("Must retain original UUID") }
        assertSame(request, replay)
        assertEquals("r", replay.runId)
        assertEquals(1, replay.fromAttempt)
        val body = organizationResumeBody(replay.clientRequestId)
        assertEquals(1, body.length())
        assertEquals(id, body.getString("clientRequestId"))
        assertEquals(body.toString(), organizationResumeBody(request.clientRequestId).toString())
        assertThrows(IllegalArgumentException::class.java) { organizationResumeBody("invalid") }
    }

    @Test fun noCheckpointNonTimeoutAndExhaustedBudgetCannotAuthorizeResume() {
        listOf(failed().copy(canResume = false), failed().copy(attempt = 3),
            failed().copy(errorCode = "AI_RESPONSE_INVALID"), failed().copy(status = "running")).forEach {
            assertFalse(it.resumableTimeout)
            assertThrows(IllegalArgumentException::class.java) { organizationResumeRequest(it, null) { id } }
        }
    }

    @Test fun increasedAttemptRequiresExplicitAuthorizationAlsoForGetRecovery() {
        val request = organizationResumeRequest(failed(), null) { id }
        assertThrows(IllegalArgumentException::class.java) { validateOrganizationRunUpdate(failed(), resumed()) }
        assertEquals(resumed(), validateOrganizationRunUpdate(failed(), resumed(), request))
        val ready = resumed().copy(status = "ready", completedCount = 65)
        assertTrue(validateOrganizationRunUpdate(failed(), ready, request).canLoadCard)
        assertEquals(failed(), validateOrganizationRunUpdate(failed(), failed(), request))
        assertThrows(IllegalArgumentException::class.java) {
            validateOrganizationRunUpdate(failed(), resumed(), request.copy(runId = "other"))
        }
    }

    @Test fun attemptProgressAndEventHistoryNeverRegressOrChangeIdentity() {
        val request = organizationResumeRequest(failed(), null) { id }
        listOf(resumed().copy(attempt = 1), resumed().copy(attempt = 3), resumed().copy(completedCount = 19),
            resumed().copy(runId = "other"), resumed().copy(startDate = "2026-09-01"),
            resumed().copy(progress = resumed().progress!!.copy(startedAt = 2000)),
            resumed().copy(progress = resumed().progress!!.copy(completedBatches = 1)),
            resumed().copy(progress = resumed().progress!!.copy(events = emptyList()))).forEach {
            assertThrows(IllegalArgumentException::class.java) { validateOrganizationRunUpdate(failed(), it, request) }
        }
        assertThrows(IllegalArgumentException::class.java) { validateOrganizationRunUpdate(resumed(), resumed().copy(attempt = 1)) }
        val failedAgain = resumed().copy(status = "failed", errorCode = "AI_PROVIDER_TIMEOUT", canResume = true,
            progress = resumed().progress!!.copy(phase = "failed", suggestionCount = 0))
        assertEquals(failedAgain, validateOrganizationRunUpdate(resumed(), failedAgain))
        assertFalse(failedAgain.canLoadCard)
    }

    @Test fun transportUncertaintyRetainsRequestWhileDefiniteConflictRejects() {
        listOf<Int?>(null, 408, 500, 503).forEach { assertFalse(organizationResumeDefinitelyRejected(it)) }
        listOf(400, 401, 404, 409, 422).forEach { assertTrue(organizationResumeDefinitelyRejected(it)) }
    }

    @Test fun timeoutDiagnosisDoesNotInventStructuralFieldAndExplainsCost() {
        val projection = organizationProgressProjection(failed())
        assertTrue(projection.diagnosis!!.contains("等待模型响应超时"))
        assertTrue(projection.diagnosis.contains("第3批"))
        assertFalse(projection.diagnosis.contains("字段"))
        assertFalse(projection.diagnosis.contains("未提供"))
        assertTrue(organizationFailureMessage(failed()).contains("不会再次发送模型"))
        assertTrue(organizationFailureMessage(failed()).contains("费用"))
        assertTrue(organizationFailureMessage(failed().copy(canResume = false)).contains("不要盲目"))
        assertFalse(failed().canLoadCard)
    }
}
