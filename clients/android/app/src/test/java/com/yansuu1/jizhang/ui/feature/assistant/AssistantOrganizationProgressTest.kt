package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.repo.organizationStartBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantOrganizationProgressTest {
    private fun progress(phase: String = "analysing", suggestions: Int = 3) = OrganizationProgress(
        phase, 2, 1, 2, suggestions, 1000, 66000,
        listOf(OrganizationProgressEvent(1, "validating", 1, 25, "第1批已校验；建议尚未应用。", 66000)), null,
    )
    private fun run() = OrganizationRun("r", "running", "2026-10-01", "2026-10-31", 30, 25, null, 1000, 66000, progress())
    private fun json() = JSONObject().put("runId", "r").put("status", "running")
        .put("startDate", "2026-10-01").put("endDate", "2026-10-31")
        .put("eligibleCount", 30).put("completedCount", 25)
    private fun progressJson() = JSONObject().put("phase", "analysing").put("totalBatches", 2)
        .put("completedBatches", 1).put("currentBatch", 2).put("suggestionCount", 3)
        .put("startedAt", 1000).put("updatedAt", 66000).put("events", JSONArray())
        .put("errorDetail", JSONObject.NULL)

    @Test fun exactStartReplayRetainsImmutableIdentityAndBackgroundFlag() {
        val id = "1d44a879-53fb-4813-b163-4b30e840d230"
        val request = OrganizationStartRequest(OrganizationDateRange("2026-10-01", "2026-10-31"), id)
        val first = organizationStartBody(request.range.startDate, request.range.endDate, request.clientRequestId)
        val replay = organizationStartBody(request.range.startDate, request.range.endDate, request.clientRequestId)
        assertEquals(first.toString(), replay.toString())
        assertTrue(first.getBoolean("background"))
        assertEquals(id, first.getString("clientRequestId"))
        assertEquals(4, first.length())
    }
    @Test fun oldServerHasSafeUnknownProgressNotFakePercentage() {
        val projection = organizationProgressProjection(parseOrganizationRun(json()))
        assertEquals("批次进度未知", projection.batches)
        assertEquals("服务端用时未知", projection.elapsed)
        assertTrue(projection.suggestions.contains("未知"))
        assertTrue(projection.timeline.isEmpty())
        assertNull(parseOrganizationRun(json().put("progress", JSONObject.NULL)).progress)
    }
    @Test fun actualProjectionUsesServerElapsedAndValidatedNotAppliedCounts() {
        val projection = organizationProgressProjection(run())
        assertEquals("AI 逐批分析", projection.stage)
        assertTrue(projection.batches.contains("2/2"))
        assertEquals("已处理 25/30 笔", projection.processed)
        assertEquals("已校验建议 3 项 · 尚未应用", projection.suggestions)
        assertTrue(projection.elapsed.contains("1分5秒"))
        assertTrue(projection.timeline.single().contains("第1批已校验"))
        assertFalse(run().canLoadCard)
    }
    @Test fun failedDiagnosisOnlyRendersKnownSchemaFields() {
        val failed = run().copy(status = "failed", progress = progress("failed", 0).copy(
            errorDetail = OrganizationErrorDetail("validating", "reclassifications", 2)))
        val projection = organizationProgressProjection(failed)
        assertTrue(projection.diagnosis!!.contains("分类调整 reclassifications"))
        assertTrue(projection.diagnosis.contains("第2批"))
        assertFalse(failed.canLoadCard)
        val unsafe = failed.copy(progress = failed.progress!!.copy(errorDetail = OrganizationErrorDetail("raw secret", "private note", 2)))
        assertFalse(organizationProgressProjection(unsafe).diagnosis!!.contains("private note"))
        assertFalse(organizationProgressProjection(unsafe).diagnosis!!.contains("raw secret"))
        assertEquals(failed, validateOrganizationRunUpdate(run(), failed))
    }
    @Test fun integerCountsRejectFractionsStringsOverflowAndNegative() {
        listOf<Any>(1.2, "25", Long.MAX_VALUE, -1).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(json().put("completedCount", value)) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseOrganizationRun(json().put("createdAt", java.math.BigDecimal("9223372036854775808")))
        }
        listOf<Any>(1.5, "2", 2147483648L, -1).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                parseOrganizationRun(json().put("progress", progressJson().put("currentBatch", value)))
            }
        }
    }
    @Test fun incompleteReadyAndExcessCountsNeverLoadCard() {
        assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(json().put("status", "ready")) }
        assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(json().put("completedCount", 31)) }
        assertThrows(IllegalArgumentException::class.java) { parseOrganizationCard(json().put("status", "ready")) }
        val ready = parseOrganizationRun(json().put("status", "ready").put("completedCount", 30))
        assertTrue(ready.canLoadCard)
    }
    @Test fun actualReducerRejectsRegressionWrongRunAndChangedFrozenScope() {
        listOf(run().copy(completedCount = 24), run().copy(runId = "other"), run().copy(eligibleCount = 31),
            run().copy(progress = progress().copy(completedBatches = 0)),
            run().copy(progress = progress().copy(suggestionCount = 2))).forEach { next ->
            assertThrows(IllegalArgumentException::class.java) { validateOrganizationRunUpdate(run(), next) }
        }
        val ready = run().copy(status = "ready", completedCount = 30)
        assertThrows(IllegalArgumentException::class.java) { validateOrganizationRunUpdate(ready, run()) }
    }
    @Test fun synchronousOwnerRejectsDoubleTapStaleDisposalServerAndSession() {
        val owner = OrganizationWorkOwner()
        val first = owner.begin()!!
        assertNull(owner.begin())
        assertTrue(owner.accepts(first, "A", "A", true, true))
        assertFalse(owner.accepts(first, "A", "B", true, true))
        assertFalse(owner.accepts(first, "A", "A", true, false))
        assertFalse(owner.accepts(first, "A", "A", false, true))
        owner.invalidate()
        val second = owner.begin()!!
        owner.finish(first)
        assertFalse(owner.accepts(first, "A", "A", true, true))
        assertTrue(owner.accepts(second, "A", "A", true, true))
        owner.finish(second)
        assertNotNull(owner.begin())
    }
    @Test fun additiveWireProgressEventsAndSafeDiagnosisDecode() {
        val event = JSONObject().put("seq", 1).put("phase", "validating").put("batch", 1)
            .put("completedCount", 25).put("message", "第1批已校验；建议尚未应用。") .put("at", 66000)
        val p = progressJson().put("events", JSONArray().put(event)).put("errorDetail",
            JSONObject().put("stage", "validating").put("field", "tagSuggestions").put("batch", 2))
        val decoded = parseOrganizationRun(json().put("progress", p))
        assertEquals(1, decoded.progress!!.events.single().seq)
        assertTrue(organizationProgressProjection(decoded).diagnosis!!.contains("tagSuggestions"))
        p.put("events", JSONArray().put(event).put(event))
        assertThrows(IllegalArgumentException::class.java) { parseOrganizationRun(json().put("progress", p)) }
    }
    @Test fun definiteStartRejectionAllowsCorrectedRangeButUncertaintyRetainsIdentity() {
        assertTrue(organizationStartDefinitelyRejected(null, 400))
        assertTrue(organizationStartDefinitelyRejected(null, 422))
        assertFalse(organizationStartDefinitelyRejected(null, null))
        assertFalse(organizationStartDefinitelyRejected(null, 500))
        assertFalse(organizationStartDefinitelyRejected(null, 408))
        assertFalse(organizationStartDefinitelyRejected(null, 409))
        assertFalse(organizationStartDefinitelyRejected(run(), 400))
    }
    @Test fun observationWindowIsBoundedAndLongEnoughForTwentyBatches() {
        assertEquals(900000L, ORGANIZATION_OBSERVATION_MS)
        assertEquals(1000L, ORGANIZATION_POLL_MS)
    }
}
