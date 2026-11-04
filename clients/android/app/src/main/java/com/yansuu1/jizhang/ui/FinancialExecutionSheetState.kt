package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialCategoryRule
import com.yansuu1.jizhang.repo.FinancialConfig
import com.yansuu1.jizhang.repo.FinancialConfigUpdateRequest
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialCycleKind
import com.yansuu1.jizhang.repo.FinancialMappingCategory
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialRefundOriginalRef
import com.yansuu1.jizhang.repo.FinancialRefundOriginalState
import com.yansuu1.jizhang.repo.FinancialRefundReview
import com.yansuu1.jizhang.repo.FinancialRefundSplit
import com.yansuu1.jizhang.repo.FinancialRefundSplitsUpdateRequest
import com.yansuu1.jizhang.repo.SpendingPurpose
import org.json.JSONObject
import java.io.IOException
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLEncoder

/**
 * Pure state/validation helpers for the three Phase 1 financial-execution sheets.
 *
 * Everything here is deliberately Android-free so JVM tests can exercise the exact
 * decimal, dirty, mapping-rule and refund-cap rules without a Compose host. The UI
 * remains a thin renderer; it never invents totals or falls back to zero.
 */

internal object FinancialSheetDecimal {
    private val PERCENT_REGEX = Regex("^[0-9]{1,3}(\\.[0-9]{1,2})?$")
    private val TARGET_MONTHS_REGEX = Regex("^[0-9]{1,3}$")
    private val CYCLE_DAY_REGEX = Regex("^[0-9]{1,2}$")

    /** Percent with at most two decimals -> integer basis points (1 bps = 0.01%). */
    fun parsePercentToBps(text: String, fieldName: String): Int {
        val value = text.trim()
        require(value.isNotEmpty()) { "请填写${fieldName}" }
        require(PERCENT_REGEX.matches(value)) { "${fieldName}格式不正确，最多两位小数且不能为负数" }
        val bps = try {
            BigDecimal(value).movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).intValueExact()
        } catch (_: Exception) {
            throw IllegalArgumentException("${fieldName}超出范围")
        }
        require(bps in 0..10000) { "${fieldName}必须在 0% 到 100% 之间" }
        return bps
    }

    fun formatPercent(bps: Int): String {
        require(bps >= 0) { "比例基点不能为负数" }
        return BigDecimal(bps).movePointLeft(2).stripTrailingZeros().toPlainString()
    }

    fun parseTargetMonths(text: String): Int {
        val value = text.trim()
        require(TARGET_MONTHS_REGEX.matches(value)) { "目标月数必须是整数" }
        val months = value.toInt()
        require(months in 1..120) { "目标月数必须在 1 到 120 之间" }
        return months
    }

    fun parseCycleDay(text: String): Int {
        val value = text.trim()
        require(CYCLE_DAY_REGEX.matches(value)) { "周期起始日必须是整数" }
        val day = value.toInt()
        require(day in 1..28) { "周期起始日必须在 1 到 28 之间" }
        return day
    }

    /** Null/blank means "not set"; never silently becomes zero. */
    fun parseOptionalPositiveCents(text: String, fieldName: String): Long? {
        if (text.isBlank()) return null
        return FinancialPlanMoneyParser.parseYuanToCents(text, allowZero = false, fieldName = fieldName)
    }
}

// ── Config sheet ─────────────────────────────────────────────────────────────

internal data class FinancialConfigDraft(
    val enabled: Boolean,
    val growthPercent: String,
    val reservePercent: String,
    val essentialsPercent: String,
    val joyPercent: String,
    val essentialYuan: String,
    val targetMonths: String,
    val cycleKind: FinancialCycleKind,
    val cycleDay: String,
    val timeZone: String,
)

internal data class FinancialConfigParsed(
    val enabled: Boolean,
    val ratios: FinancialRatiosBps,
    val essentialMonthlyCents: Long?,
    val targetMonths: Int,
    val cycle: FinancialCycle,
    val timeZone: String,
)

internal object FinancialConfigDraftLogic {

    fun from(config: FinancialConfig): FinancialConfigDraft = FinancialConfigDraft(
        enabled = config.enabled,
        growthPercent = FinancialSheetDecimal.formatPercent(config.ratiosBps.growth),
        reservePercent = FinancialSheetDecimal.formatPercent(config.ratiosBps.reserve),
        essentialsPercent = FinancialSheetDecimal.formatPercent(config.ratiosBps.essentials),
        joyPercent = FinancialSheetDecimal.formatPercent(config.ratiosBps.joy),
        essentialYuan = config.essentialMonthlyCents?.let(FinancialPlanMoneyParser::formatCentsToYuan).orEmpty(),
        targetMonths = config.targetMonths.toString(),
        cycleKind = config.cycle.kind,
        cycleDay = (config.cycle.day ?: 1).toString(),
        timeZone = config.timeZone,
    )

    fun validate(draft: FinancialConfigDraft): Result<FinancialConfigParsed> = runCatching {
        val growth = FinancialSheetDecimal.parsePercentToBps(draft.growthPercent, "成长比例")
        val reserve = FinancialSheetDecimal.parsePercentToBps(draft.reservePercent, "储备比例")
        val essentials = FinancialSheetDecimal.parsePercentToBps(draft.essentialsPercent, "必要开支比例")
        val joy = FinancialSheetDecimal.parsePercentToBps(draft.joyPercent, "随心消费比例")
        val sum = growth.toLong() + reserve.toLong() + essentials.toLong() + joy.toLong()
        require(sum == 10000L) { "四项比例合计必须正好 100%（当前 ${FinancialSheetDecimal.formatPercent(sum.toInt())}%）" }
        val ratios = FinancialRatiosBps(growth = growth, reserve = reserve, essentials = essentials, joy = joy)
        val essential = FinancialSheetDecimal.parseOptionalPositiveCents(draft.essentialYuan, "每月必要开支")
        val targetMonths = FinancialSheetDecimal.parseTargetMonths(draft.targetMonths)
        val cycle = when (draft.cycleKind) {
            FinancialCycleKind.NATURAL_MONTH -> FinancialCycle.naturalMonth()
            FinancialCycleKind.START_DAY -> FinancialCycle.startDay(
                FinancialSheetDecimal.parseCycleDay(draft.cycleDay),
            )
        }
        val timeZone = draft.timeZone.trim()
        require(timeZone.isNotEmpty()) { "请填写 IANA 时区，例如 Asia/Shanghai" }
        FinancialConfigParsed(
            enabled = draft.enabled,
            ratios = ratios,
            essentialMonthlyCents = essential,
            targetMonths = targetMonths,
            cycle = cycle,
            timeZone = timeZone,
        )
    }

    fun isDirty(draft: FinancialConfigDraft, baseline: FinancialConfigDraft): Boolean = draft != baseline

    fun buildUpdate(
        operationId: String,
        expectedRevision: Long,
        parsed: FinancialConfigParsed,
    ): FinancialConfigUpdateRequest = FinancialConfigUpdateRequest(
        operationId = operationId,
        expectedRevision = expectedRevision,
        enabled = parsed.enabled,
        ratiosBps = parsed.ratios,
        essentialMonthlyCents = parsed.essentialMonthlyCents,
        targetMonths = parsed.targetMonths,
        cycle = parsed.cycle,
        timeZone = parsed.timeZone,
    )
}

// ── Category mapping sheet ───────────────────────────────────────────────────

/**
 * Four distinct states. INHERIT means "no entry in the full-replacement payload";
 * EXPLICIT_UNRESOLVED means a rule entry with `purpose = null`, which deliberately
 * stops ancestor inheritance. These must never be conflated in the UI.
 */
internal enum class FinancialRuleChoice {
    INHERIT,
    ESSENTIALS,
    JOY,
    EXPLICIT_UNRESOLVED,
    ;

    fun toPurpose(): SpendingPurpose? = when (this) {
        ESSENTIALS -> SpendingPurpose.ESSENTIALS
        JOY -> SpendingPurpose.JOY
        EXPLICIT_UNRESOLVED -> null
        INHERIT -> null
    }
}

internal data class FinancialMappingRow(
    val categoryId: String,
    val label: String,
    val depth: Int,
    val deleted: Boolean,
    val hasRule: Boolean,
)

internal data class FinancialInheritedPurpose(
    val purpose: SpendingPurpose?,
    val sourceCategoryId: String?,
    val stoppedByExplicitUnresolved: Boolean,
    val ruleFound: Boolean,
)

internal object FinancialMappingDraftLogic {

    fun choicesOf(rules: List<FinancialCategoryRule>): Map<String, FinancialRuleChoice> =
        rules.associate { rule ->
            rule.categoryId to when (rule.purpose) {
                SpendingPurpose.ESSENTIALS -> FinancialRuleChoice.ESSENTIALS
                SpendingPurpose.JOY -> FinancialRuleChoice.JOY
                null -> FinancialRuleChoice.EXPLICIT_UNRESOLVED
            }
        }

    /** Only non-inherit choices are serialized; inherit is represented by absence. */
    fun rulesOf(choices: Map<String, FinancialRuleChoice>): List<FinancialCategoryRule> =
        choices.entries
            .filter { it.value != FinancialRuleChoice.INHERIT }
            .sortedBy { it.key }
            .map { FinancialCategoryRule(categoryId = it.key, purpose = it.value.toPurpose()) }

    fun validate(
        choices: Map<String, FinancialRuleChoice>,
        allowedCategoryIds: Set<String>,
    ): Result<List<FinancialCategoryRule>> = runCatching {
        val explicit = choices.filterValues { it != FinancialRuleChoice.INHERIT }
        require(explicit.size <= 2000) { "分类规则不能超过 2000 条" }
        val unknown = explicit.keys.filterNot { it in allowedCategoryIds }
        require(unknown.isEmpty()) { "存在当前映射快照之外的分类规则，请重新加载后再编辑" }
        rulesOf(choices)
    }

    /**
     * Rows shown by the editor: all live categories plus deleted categories that still
     * carry a historical rule (so full replacement never drops them silently). A rule
     * whose category is absent from the snapshot is surfaced as an explicit unknown row.
     */
    fun buildRows(
        categories: List<FinancialMappingCategory>,
        labels: Map<String, String>,
        rules: List<FinancialCategoryRule>,
    ): List<FinancialMappingRow> {
        val ruleIds = rules.map { it.categoryId }.toSet()
        val visible = categories.filter { !it.deleted || it.id in ruleIds }
        val knownIds = visible.map { it.id }.toSet()
        val unknownRuleRows = ruleIds.filterNot { it in knownIds }.map { missingId ->
            FinancialMappingCategory(id = missingId, parentId = null, deleted = true)
        }
        val all = visible + unknownRuleRows
        val byId = all.associateBy { it.id }
        val sort = compareBy<FinancialMappingCategory>({ labels[it.id] ?: it.id }, { it.id })
        val children = all.groupBy { it.parentId }
        val rows = mutableListOf<FinancialMappingRow>()
        val visited = mutableSetOf<String>()

        fun labelOf(id: String): String = labels[id]?.takeIf { it.isNotBlank() } ?: "未知分类（$id）"

        fun walk(category: FinancialMappingCategory, depth: Int) {
            if (!visited.add(category.id)) return
            rows += FinancialMappingRow(
                categoryId = category.id,
                label = labelOf(category.id),
                depth = depth.coerceAtMost(8),
                deleted = category.deleted,
                hasRule = category.id in ruleIds,
            )
            children[category.id].orEmpty().sortedWith(sort).forEach { child ->
                walk(child, depth + 1)
            }
        }

        val roots = all.filter { it.parentId == null || it.parentId !in byId.keys }.sortedWith(sort)
        roots.forEach { walk(it, 0) }
        // Defensive: cycles (or malformed parent links) still render once instead of vanishing.
        all.filterNot { it.id in visited }.sortedWith(sort).forEach { walk(it, 0) }
        return rows
    }

    /** Live hint for the current draft; explicit unresolved stops the walk. */
    fun effectivePurpose(
        categoryId: String,
        choices: Map<String, FinancialRuleChoice>,
        parentById: Map<String, String?>,
    ): FinancialInheritedPurpose {
        var cursor: String? = categoryId
        val visited = mutableSetOf<String>()
        while (cursor != null && visited.add(cursor)) {
            when (choices[cursor] ?: FinancialRuleChoice.INHERIT) {
                FinancialRuleChoice.ESSENTIALS -> return FinancialInheritedPurpose(
                    purpose = SpendingPurpose.ESSENTIALS,
                    sourceCategoryId = cursor,
                    stoppedByExplicitUnresolved = false,
                    ruleFound = true,
                )
                FinancialRuleChoice.JOY -> return FinancialInheritedPurpose(
                    purpose = SpendingPurpose.JOY,
                    sourceCategoryId = cursor,
                    stoppedByExplicitUnresolved = false,
                    ruleFound = true,
                )
                FinancialRuleChoice.EXPLICIT_UNRESOLVED -> return FinancialInheritedPurpose(
                    purpose = null,
                    sourceCategoryId = cursor,
                    stoppedByExplicitUnresolved = true,
                    ruleFound = true,
                )
                FinancialRuleChoice.INHERIT -> cursor = parentById[cursor]
            }
        }
        return FinancialInheritedPurpose(
            purpose = null,
            sourceCategoryId = null,
            stoppedByExplicitUnresolved = false,
            ruleFound = false,
        )
    }
}

// ── Refund split dialog ──────────────────────────────────────────────────────

internal data class FinancialRefundCandidate(
    val originalId: String,
    val token: String,
    val amountCents: Long,
    val remainingCents: Long,
    val date: Long,
    val state: FinancialRefundOriginalState,
    val otherConfirmedRefundCents: Long,
    val isExternal: Boolean = false,
) {
    val selectable: Boolean
        get() = state == FinancialRefundOriginalState.LIVE && token.isNotBlank() && remainingCents > 0
}

internal data class FinancialRefundSaveDraft(
    val splits: List<FinancialRefundSplit>,
    val originals: List<FinancialRefundOriginalRef>,
    val totalCents: Long,
    val remainingCents: Long,
)

internal object FinancialRefundDraftLogic {

    fun candidates(review: FinancialRefundReview): List<FinancialRefundCandidate> =
        review.originals.map { original ->
            FinancialRefundCandidate(
                originalId = original.transactionId,
                token = original.transactionToken,
                amountCents = original.amountCents,
                remainingCents = original.remainingRefundableCents,
                date = original.date,
                state = original.state,
                otherConfirmedRefundCents = original.otherConfirmedRefundCents,
            )
        }

    fun initialDraft(review: FinancialRefundReview): Map<String, String> =
        review.splits.associate { split ->
            split.originalTransactionId to FinancialPlanMoneyParser.formatCentsToYuan(split.amountCents)
        }

    fun suggestedDraft(review: FinancialRefundReview): Map<String, String>? =
        review.suggestedSplits?.associate { split ->
            split.originalTransactionId to FinancialPlanMoneyParser.formatCentsToYuan(split.amountCents)
        }

    fun validate(
        draft: Map<String, String>,
        review: FinancialRefundReview,
        extraCandidates: Map<String, FinancialRefundCandidate> = emptyMap(),
    ): Result<FinancialRefundSaveDraft> = runCatching {
        val candidates = (candidates(review) + extraCandidates.values).associateBy { it.originalId }
        val entries = draft.entries.filter { it.value.isNotBlank() }
        require(entries.size <= 100) { "退款分摊不能超过 100 笔" }

        var total = 0L
        val splits = entries
            .sortedBy { it.key }
            .map { (originalId, amountText) ->
                val candidate = candidates[originalId]
                    ?: throw IllegalArgumentException("原单不可用或未加载：$originalId")
                require(candidate.selectable) { "原单当前不可分摊：${candidate.originalId}" }
                val cents = FinancialPlanMoneyParser.parseYuanToCents(
                    amountText,
                    allowZero = false,
                    fieldName = "分摊金额",
                )
                require(cents <= candidate.remainingCents) {
                    "分摊金额超过原单剩余可退额度 \"${candidate.originalId}\""
                }
                total = try {
                    Math.addExact(total, cents)
                } catch (_: ArithmeticException) {
                    throw IllegalArgumentException("分摊金额合计超出安全整数范围")
                }
                FinancialRefundSplit(originalTransactionId = originalId, amountCents = cents)
            }

        require(total <= review.amountCents) { "分摊合计不能超过退款金额" }
        val originals = splits.map { split ->
            val candidate = candidates.getValue(split.originalTransactionId)
            FinancialRefundOriginalRef(
                transactionId = split.originalTransactionId,
                expectedTransactionToken = candidate.token,
            )
        }
        FinancialRefundSaveDraft(
            splits = splits,
            originals = originals,
            totalCents = total,
            remainingCents = review.amountCents - total,
        )
    }

    fun buildRequest(
        operationId: String,
        review: FinancialRefundReview,
        draft: FinancialRefundSaveDraft,
    ): FinancialRefundSplitsUpdateRequest = FinancialRefundSplitsUpdateRequest(
        operationId = operationId,
        expectedRevision = review.revision,
        expectedRefundToken = review.refundToken,
        originals = draft.originals,
        splits = draft.splits,
    )
}

// ── Pending-operation helpers / failure classification ──────────────────────

internal const val FINANCIAL_PLANNING_PATH = "/api/v1/financial-planning"

internal fun financialPathSegment(value: String): String {
    require(value.isNotBlank()) { "路径 ID 不能为空白" }
    require(value.length <= 128) { "路径 ID 过长" }
    return URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

internal fun financialPendingOperation(
    operationId: String,
    method: String,
    path: String,
    payload: JSONObject,
): PendingFinancialOperation = PendingFinancialOperation(
    operationId = operationId,
    method = method,
    path = path,
    payloadJson = payload.toString(),
)

internal sealed interface FinancialWriteFailure {
    data object AuthExpired : FinancialWriteFailure
    data class Rejected(val code: String, val message: String) : FinancialWriteFailure
    data class Unknown(val message: String) : FinancialWriteFailure
}

/**
 * A 4xx response is a definitive rejection (the operation was not committed) except
 * 408/429, which can be produced before or around dispatch and therefore stay unknown.
 * Transport/decoding/5xx failures may have committed the write and must retain the
 * exact pending operation for explicit replay.
 */
internal fun classifyFinancialWriteFailure(error: Throwable): FinancialWriteFailure = when {
    error is AuthExpiredException -> FinancialWriteFailure.AuthExpired
    error is ApiException -> {
        if (error.status in 400..499 && error.status != 408 && error.status != 429) {
            FinancialWriteFailure.Rejected(
                code = error.code,
                message = error.message?.takeIf { it.isNotBlank() } ?: "请求被服务端拒绝（${error.status}）",
            )
        } else {
            FinancialWriteFailure.Unknown(error.message ?: "服务端暂时不可用（${error.status}）")
        }
    }
    error is IOException -> FinancialWriteFailure.Unknown(error.message ?: "网络中断，保存结果未知")
    else -> FinancialWriteFailure.Unknown(error.message ?: "保存结果未知")
}
