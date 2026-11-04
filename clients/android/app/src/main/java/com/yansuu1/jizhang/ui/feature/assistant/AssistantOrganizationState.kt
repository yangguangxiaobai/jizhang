package com.yansuu1.jizhang.ui.feature.assistant

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

internal const val ORGANIZATION_MAX_APPLY_ACTIONS = 100

internal data class OrganizationDateRange(
    val startDate: String,
    val endDate: String,
) {
    val label: String get() = "$startDate 至 $endDate"
}

internal enum class OrganizationRangePreset(val label: String) {
    THIS_MONTH("本月"),
    LAST_MONTH("上月"),
    LAST_THREE_MONTHS("近3个月"),
    THIS_YEAR("今年"),
    CUSTOM("自定义"),
}

internal data class OrganizationDefaultSelection(
    val actionIds: Set<String>,
    val truncated: Boolean,
)

internal fun organizationRangeForPreset(
    preset: OrganizationRangePreset,
    today: LocalDate = LocalDate.now(),
): OrganizationDateRange? = when (preset) {
    OrganizationRangePreset.THIS_MONTH -> monthRange(today.withDayOfMonth(1))
    OrganizationRangePreset.LAST_MONTH -> monthRange(today.minusMonths(1).withDayOfMonth(1))
    OrganizationRangePreset.LAST_THREE_MONTHS -> OrganizationDateRange(
        startDate = today.minusMonths(2).withDayOfMonth(1).toString(),
        endDate = today.toString(),
    )
    OrganizationRangePreset.THIS_YEAR -> OrganizationDateRange(
        startDate = today.withDayOfYear(1).toString(),
        endDate = today.toString(),
    )
    OrganizationRangePreset.CUSTOM -> null
}

internal fun organizationRangeValidationError(startDate: String, endDate: String): String? {
    val start = parseOrganizationDay(startDate) ?: return "请选择有效的开始日期。"
    val end = parseOrganizationDay(endDate) ?: return "请选择有效的结束日期。"
    if (start.isAfter(end)) return "开始日期不能晚于结束日期。"
    return null
}

internal fun defaultOrganizationSelection(
    actions: List<OrganizationAction>,
    limit: Int = ORGANIZATION_MAX_APPLY_ACTIONS,
): OrganizationDefaultSelection {
    val selectable = actions.filter { it.selectable }
    return OrganizationDefaultSelection(
        actionIds = selectable.take(limit).map { it.actionId }.toSet(),
        truncated = selectable.size > limit,
    )
}

internal fun updateOrganizationSelection(
    current: Set<String>,
    action: OrganizationAction,
    checked: Boolean,
    limit: Int = ORGANIZATION_MAX_APPLY_ACTIONS,
): Set<String> = when {
    !action.selectable -> current
    !checked -> current - action.actionId
    action.actionId in current -> current
    current.size >= limit -> current
    else -> current + action.actionId
}

internal fun selectedOrganizationActionIds(
    actions: List<OrganizationAction>,
    selected: Set<String>,
): List<String> = actions
    .asSequence()
    .filter { it.selectable && it.actionId in selected }
    .map { it.actionId }
    .toList()

internal fun organizationApplyErrorMessage(code: String?, fallback: String?): String = when (code) {
    "AI_NOT_CONFIGURED" -> "AI 接口尚未配置或未启用。请先到“我的 → AI 接口设置”完成配置并启用。"
    "AI_SECRET_UNAVAILABLE" -> "AI 密钥当前不可用，请重新保存接口配置后再试。"
    "AI_PROVIDER_TIMEOUT" -> "等待模型响应超时，未生成可应用的整理结果。若无法继续，请先检查 AI 服务、模型与超时设置，不要盲目重复分析。"
    "AI_PROVIDER_ERROR" -> "AI 服务暂时不可用，本次分析未完成。请稍后重新分析。"
    "AI_RESPONSE_INVALID" -> "AI 返回的整理结果无法完整校验，本次分析未生成审查卡片。"
    "AI_ORGANIZATION_OVER_CAP" -> fallback ?: "该时间段超过单次分析上限，请缩小日期范围。"
    "AI_ORGANIZATION_CONFLICT" -> fallback ?: "账单或分类已发生变化，请重新分析后再应用。"
    "AI_ORGANIZATION_INVALID",
    "AI_ORGANIZATION_RUNS_INVALID",
    -> fallback ?: "整理参数无效，请检查日期范围。"
    "AI_ORGANIZATION_INTERRUPTED" -> "服务端重启或停止导致分析中断，未生成可应用结果。可明确发起新的分析。"
    "AI_ORGANIZATION_BUSY" -> "服务端已有整理任务正在运行。本页没有其任务编号，不能自动重新发起；请勿反复创建请求。"
    "AI_ORGANIZATION_NOT_READY" -> "分析尚未完成，暂时不能应用。"
    "AI_ORGANIZATION_RUN_NOT_FOUND" -> "这次分析任务不存在或已失效，请重新分析。"
    else -> fallback?.takeIf { it.isNotBlank() } ?: "整理请求失败，请稍后重试。"
}

internal fun organizationDatePickerMillis(date: String): Long? =
    parseOrganizationDay(date)
        ?.atStartOfDay(ZoneOffset.UTC)
        ?.toInstant()
        ?.toEpochMilli()

internal fun organizationDateFromPickerMillis(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()

private fun monthRange(firstDay: LocalDate): OrganizationDateRange =
    OrganizationDateRange(
        startDate = firstDay.toString(),
        endDate = firstDay.withDayOfMonth(firstDay.lengthOfMonth()).toString(),
    )

private fun parseOrganizationDay(value: String): LocalDate? = try {
    LocalDate.parse(value)
} catch (_: DateTimeParseException) {
    null
}

internal const val ORGANIZATION_OBSERVATION_MS = 15 * 60 * 1000L
internal const val ORGANIZATION_POLL_MS = 1_000L

internal data class OrganizationStartRequest(val range: OrganizationDateRange, val clientRequestId: String)

/** Created only by a user tap; retained unchanged until acceptance is observed or definitely rejected. */
internal data class OrganizationResumeRequest(val runId: String, val fromAttempt: Int, val clientRequestId: String)

internal fun organizationResumeRequest(run: OrganizationRun, pending: OrganizationResumeRequest?, newId: () -> String): OrganizationResumeRequest {
    if (pending != null) {
        require(pending.runId == run.runId && pending.fromAttempt == run.attempt) { "继续请求与任务不一致。" }
        return pending
    }
    require(run.resumableTimeout) { "本次整理不能继续，请先检查 AI 服务设置。" }
    return OrganizationResumeRequest(run.runId, run.attempt, newId())
}

internal fun organizationResumeDefinitelyRejected(status: Int?): Boolean =
    status != null && status in 400..499 && status != 408

internal fun organizationFailureMessage(run: OrganizationRun): String =
    if (run.resumableTimeout) "等待模型响应超时，未生成可应用的整理结果。可手动继续未完成批次；已校验账单会复用，不会再次发送模型或重复产生这些账单的调用费用。继续仍可能产生 AI 调用费用。"
    else organizationApplyErrorMessage(run.errorCode, null)

internal fun organizationStartDefinitelyRejected(run: OrganizationRun?, status: Int?): Boolean =
    run == null && status != null && status in 400..499 && status !in setOf(408, 409)

/** Synchronous main-thread lock also covers time spent obtaining current server scope. */
internal class OrganizationWorkOwner {
    private var generation = 0L
    private var active: Long? = null
    fun begin(): Long? {
        if (active != null) return null
        return (++generation).also { active = it }
    }
    fun accepts(ticket: Long, expectedScope: String, currentScope: String, alive: Boolean, sessionValid: Boolean): Boolean =
        alive && sessionValid && active == ticket && expectedScope == currentScope
    fun finish(ticket: Long) { if (active == ticket) active = null }
    fun invalidate() { generation++; active = null }
}

internal fun validateOrganizationRunUpdate(
    previous: OrganizationRun?, next: OrganizationRun, authorizedResume: OrganizationResumeRequest? = null,
): OrganizationRun {
    require(next.completedCount <= next.eligibleCount && (next.status != "ready" || next.canLoadCard)) { "整理覆盖计数无效。" }
    if (previous == null) return next
    require(previous.runId == next.runId && previous.startDate == next.startDate && previous.endDate == next.endDate) { "整理任务身份不一致。" }
    // Preparing may not have read the snapshot yet; afterwards eligibility is frozen.
    require(previous.eligibleCount == next.eligibleCount ||
        (previous.completedCount == 0 && previous.progress?.phase == "preparing")) { "整理范围计数已改变。" }
    val resumed = next.attempt > previous.attempt
    require(next.attempt >= previous.attempt) { "整理尝试次数发生回退。" }
    if (resumed) {
        require(previous.resumableTimeout && next.attempt == previous.attempt + 1 &&
            authorizedResume?.runId == previous.runId && authorizedResume.fromAttempt == previous.attempt) {
            "未经明确授权的继续分析。"
        }
    }
    require(next.completedCount >= previous.completedCount &&
        (!previous.terminal || previous.status == next.status || (resumed && next.status in setOf("running", "ready")))) {
        "整理进度发生回退。"
    }
    val a = previous.progress
    val b = next.progress
    if (a != null && b != null) {
        require(b.completedBatches >= a.completedBatches && (b.suggestionCount >= a.suggestionCount ||
            (next.status == "failed" && b.suggestionCount == 0)) &&
            b.updatedAt >= a.updatedAt && b.startedAt == a.startedAt) { "整理批次进度发生回退。" }
        val oldLast = a.events.lastOrNull()?.seq
        require(oldLast == null || (b.events.lastOrNull()?.seq ?: -1) >= oldLast) { "整理事件序号发生回退。" }
        val oldEvents = a.events.associateBy { it.seq }
        require(b.events.all { oldEvents[it.seq]?.let { old -> old == it } ?: true }) { "整理事件内容已改变。" }
    }
    return next
}

internal fun organizationPhaseLabel(phase: String?): String = when (phase) {
    "preparing" -> "准备账单快照"
    "analysing" -> "AI 逐批分析"
    "validating" -> "校验建议结构"
    "publishing" -> "生成完整审查卡片"
    "ready" -> "分析完成"
    "failed" -> "分析失败"
    "interrupted" -> "服务端任务中断"
    else -> "服务端未提供当前阶段"
}

internal data class OrganizationProgressProjection(
    val stage: String, val batches: String, val processed: String,
    val suggestions: String, val elapsed: String, val timeline: List<String>, val diagnosis: String?,
)

internal fun organizationProgressProjection(run: OrganizationRun?): OrganizationProgressProjection {
    val p = run?.progress
    val elapsedSeconds = p?.let { (it.updatedAt - it.startedAt).coerceAtLeast(0) / 1000 }
    return OrganizationProgressProjection(
        stage = organizationPhaseLabel(p?.phase),
        batches = p?.let { "当前批次 ${it.currentBatch}/${it.totalBatches} · 已完成 ${it.completedBatches} 批" } ?: "批次进度未知",
        processed = run?.let { "已处理 ${it.completedCount}/${it.eligibleCount} 笔" } ?: "待服务端确认账单数量",
        suggestions = p?.let { "已校验建议 ${it.suggestionCount} 项 · 尚未应用" } ?: "已校验建议数量未知 · 尚未应用",
        elapsed = elapsedSeconds?.let { "服务端已用时 ${it / 60}分${it % 60}秒（截至最近更新）" } ?: "服务端用时未知",
        timeline = p?.events.orEmpty().map { "#${it.seq} · ${organizationPhaseLabel(it.phase)} · 第${it.batch}批 · 已处理${it.completedCount}笔 · ${it.message}" },
        diagnosis = p?.errorDetail?.let { detail ->
            val fields = mapOf("response" to "响应结构 response", "reclassifications" to "分类调整 reclassifications",
                "tagSuggestions" to "标签建议 tagSuggestions", "noteSuggestions" to "备注建议 noteSuggestions",
                "newCategories" to "新分类建议 newCategories", "templateProposals" to "模板建议 templateProposals")
            val reason = if (run.errorCode == "AI_PROVIDER_TIMEOUT") "等待模型响应超时" else "失败阶段"
            val field = detail.field?.let { " · 字段：${fields[it] ?: "未识别的结构字段"}" }.orEmpty()
            "$reason：${organizationPhaseLabel(detail.stage)} · 第${detail.batch}批$field。未生成可应用的部分卡片。"
        },
    )
}
