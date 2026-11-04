package com.yansuu1.jizhang.repo

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

/**
 * Four-Purpose Financial Plan wire models and DTOs.
 * Conforms strictly to .trellis/tasks/10-26-four-purpose-financial-plan/contract.md
 * and backend financial-plan spec.
 *
 * All money amounts are safe integer cents.
 * Calculation is canonical on the server/shared layer; Android only renders the decoded analysis.
 */

object FinancialPlanConstants {
    const val MAX_SAFE_INTEGER = 9007199254740991L // 2^53 - 1
    const val EXPECTED_RULE_VERSION = 1
    const val EXPECTED_PLAN_VERSION = 1

    val ALLOWED_WARNINGS = setOf(
        "ESSENTIALS_OVER_HALF",
        "ESSENTIALS_EXCEED_INCOME",
        "RESERVE_UNDER_ONE_MONTH",
        "RESERVE_TARGET_REACHED",
        "RESERVE_CONTRIBUTION_ZERO",
    )

    val EXPECTED_PURPOSES = listOf(
        "growth" to 25,
        "reserve" to 15,
        "essentials" to 50,
        "joy" to 10,
    )
}

private fun JSONObject.requiredSafeLong(key: String, min: Long = 0L, max: Long = FinancialPlanConstants.MAX_SAFE_INTEGER): Long {
    require(has(key) && !isNull(key)) { "缺少字段：$key" }
    val raw = get(key)
    require(raw is Number) { "字段必须是数字：$key" }
    val value = try {
        BigDecimal(raw.toString()).longValueExact()
    } catch (_: Exception) {
        throw IllegalArgumentException("字段非精确整型或越界：$key")
    }
    require(value >= min) { "字段值低于下限：$key" }
    require(value <= max) { "字段值超出上限：$key" }
    return value
}

private fun JSONObject.nullableSafeLong(key: String, min: Long = 0L, max: Long = FinancialPlanConstants.MAX_SAFE_INTEGER): Long? {
    require(has(key)) { "缺少字段：$key" }
    if (isNull(key)) return null
    val raw = get(key)
    require(raw is Number) { "字段必须是数字：$key" }
    val value = try {
        BigDecimal(raw.toString()).longValueExact()
    } catch (_: Exception) {
        throw IllegalArgumentException("字段非精确整型或越界：$key")
    }
    require(value >= min) { "字段值低于下限：$key" }
    require(value <= max) { "字段值超出上限：$key" }
    return value
}

private fun JSONObject.requiredBoolean(key: String): Boolean {
    require(has(key) && !isNull(key)) { "缺少字段：$key" }
    val raw = get(key)
    require(raw is Boolean) { "字段必须是布尔值：$key" }
    return raw
}

private fun JSONObject.requiredProgress(key: String): Double {
    require(has(key) && !isNull(key)) { "缺少字段：$key" }
    val raw = get(key)
    require(raw is Number) { "字段必须是数字：$key" }
    val doubleVal = raw.toDouble()
    require(!doubleVal.isNaN() && !doubleVal.isInfinite()) { "进度值必须是有穷数值：$key" }
    require(doubleVal in 0.0..1.0) { "进度值超出有效区间[0, 1]：$key" }
    return doubleVal
}

enum class PlanPurpose(val wire: String, val label: String, val defaultPercent: Int, val description: String) {
    GROWTH("growth", "成长积累", 25, "成长积累 · 投资与技能提升"),
    RESERVE("reserve", "应急储备", 15, "安全防线 · 备用金补充"),
    ESSENTIALS("essentials", "必要开支", 50, "生活底线 · 固定必须支出"),
    JOY("joy", "随心消费", 10, "活力犒劳 · 当下愿望享受"),
    ;

    companion object {
        fun fromWire(value: String): PlanPurpose? = entries.firstOrNull { it.wire == value }
    }
}

data class PurposeAllocation(
    val purpose: String,
    val percent: Int,
    val amountCents: Long,
) {
    val planPurpose: PlanPurpose? get() = PlanPurpose.fromWire(purpose)

    companion object {
        fun fromJson(json: JSONObject): PurposeAllocation {
            require(json.has("purpose") && !json.isNull("purpose")) { "缺少字段：purpose" }
            val purpose = json.getString("purpose")
            val percentLong = json.requiredSafeLong("percent", min = 1L, max = 100L)
            val amountCents = json.requiredSafeLong("amountCents", min = 0L)
            return PurposeAllocation(purpose, percentLong.toInt(), amountCents)
        }
    }
}

data class ProjectionMonth(
    val month: Int,
    val reserveProjectedCents: Long,
    val growthContributionsCents: Long,
    val reserveGapCents: Long,
    val reserveSurplusCents: Long,
    val targetReached: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): ProjectionMonth {
            val month = json.requiredSafeLong("month", min = 1L, max = 12L).toInt()
            val reserveProjectedCents = json.requiredSafeLong("reserveProjectedCents", min = 0L)
            val growthContributionsCents = json.requiredSafeLong("growthContributionsCents", min = 0L)
            val reserveGapCents = json.requiredSafeLong("reserveGapCents", min = 0L)
            val reserveSurplusCents = json.requiredSafeLong("reserveSurplusCents", min = 0L)
            val targetReached = json.requiredBoolean("targetReached")

            return ProjectionMonth(
                month = month,
                reserveProjectedCents = reserveProjectedCents,
                growthContributionsCents = growthContributionsCents,
                reserveGapCents = reserveGapCents,
                reserveSurplusCents = reserveSurplusCents,
                targetReached = targetReached,
            )
        }
    }
}

data class FinancialPlanInputs(
    val monthlyIncomeCents: Long,
    val essentialMonthlyCents: Long,
    val reserveBalanceCents: Long,
) {
    init {
        require(monthlyIncomeCents > 0) { "月收入必须大于0" }
        require(essentialMonthlyCents > 0) { "必要开支必须大于0" }
        require(reserveBalanceCents >= 0) { "现有储备金不能为负数" }
        require(monthlyIncomeCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "月收入超出安全上限" }
        require(essentialMonthlyCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "必要开支超出安全上限" }
        require(reserveBalanceCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "现有储备金超出安全上限" }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("monthlyIncomeCents", monthlyIncomeCents)
        put("essentialMonthlyCents", essentialMonthlyCents)
        put("reserveBalanceCents", reserveBalanceCents)
    }

    companion object {
        fun fromJson(json: JSONObject): FinancialPlanInputs {
            return FinancialPlanInputs(
                monthlyIncomeCents = json.requiredSafeLong("monthlyIncomeCents", min = 1L),
                essentialMonthlyCents = json.requiredSafeLong("essentialMonthlyCents", min = 1L),
                reserveBalanceCents = json.requiredSafeLong("reserveBalanceCents", min = 0L),
            )
        }
    }
}

data class FinancialPlanAnalysis(
    val ruleVersion: Int,
    val allocations: List<PurposeAllocation>,
    val reserveTargetCents: Long,
    val reserveGapCents: Long,
    val reserveSurplusCents: Long,
    val reserveProgress: Double,
    val monthsToTarget: Long?,
    val targetReached: Boolean,
    val essentialShortfallCents: Long,
    val monthlyDeficitCents: Long,
    val warnings: List<String>,
    val projection: List<ProjectionMonth>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPlanAnalysis {
            val ruleVersion = json.requiredSafeLong("ruleVersion", min = 1L, max = 1L).toInt()

            require(json.has("allocations") && !json.isNull("allocations")) { "缺少字段：allocations" }
            val allocArray = json.getJSONArray("allocations")
            require(allocArray.length() == 4) { "allocations 必须严格包含4项分配" }

            val allocations = (0 until 4).map { i ->
                val allocObj = allocArray.getJSONObject(i)
                val alloc = PurposeAllocation.fromJson(allocObj)
                val (expectedPurpose, expectedPercent) = FinancialPlanConstants.EXPECTED_PURPOSES[i]
                require(alloc.purpose == expectedPurpose) {
                    "allocations 顺序不匹配：索引 $i 应为 $expectedPurpose"
                }
                require(alloc.percent == expectedPercent) {
                    "allocations 比例不匹配：$expectedPurpose 应为 $expectedPercent%"
                }
                alloc
            }

            val reserveTargetCents = json.requiredSafeLong("reserveTargetCents", min = 0L)
            val reserveGapCents = json.requiredSafeLong("reserveGapCents", min = 0L)
            val reserveSurplusCents = json.requiredSafeLong("reserveSurplusCents", min = 0L)
            val reserveProgress = json.requiredProgress("reserveProgress")
            val monthsToTarget = json.nullableSafeLong("monthsToTarget", min = 0L)
            val targetReached = json.requiredBoolean("targetReached")
            val essentialShortfallCents = json.requiredSafeLong("essentialShortfallCents", min = 0L)
            val monthlyDeficitCents = json.requiredSafeLong("monthlyDeficitCents", min = 0L)

            require(json.has("warnings") && !json.isNull("warnings")) { "缺少字段：warnings" }
            val warningsRaw = json.get("warnings")
            require(warningsRaw is JSONArray) { "warnings 必须是数组" }
            val warnings = buildList {
                val seen = mutableSetOf<String>()
                for (i in 0 until warningsRaw.length()) {
                    val rawItem = warningsRaw.get(i)
                    require(rawItem is String) { "warnings 元素必须是字符串" }
                    require(rawItem in FinancialPlanConstants.ALLOWED_WARNINGS) { "未知 warning 类型：$rawItem" }
                    require(seen.add(rawItem)) { "warnings 包含重复项：$rawItem" }
                    add(rawItem)
                }
            }

            require(json.has("projection") && !json.isNull("projection")) { "缺少字段：projection" }
            val projArray = json.getJSONArray("projection")
            require(projArray.length() == 12) { "projection 必须包含严格12个月预测" }
            val projection = (0 until 12).map { i ->
                val p = ProjectionMonth.fromJson(projArray.getJSONObject(i))
                require(p.month == i + 1) { "projection 月份顺序不匹配：应为第 ${i + 1} 月" }
                p
            }

            return FinancialPlanAnalysis(
                ruleVersion = ruleVersion,
                allocations = allocations,
                reserveTargetCents = reserveTargetCents,
                reserveGapCents = reserveGapCents,
                reserveSurplusCents = reserveSurplusCents,
                reserveProgress = reserveProgress,
                monthsToTarget = monthsToTarget,
                targetReached = targetReached,
                essentialShortfallCents = essentialShortfallCents,
                monthlyDeficitCents = monthlyDeficitCents,
                warnings = warnings,
                projection = projection,
            )
        }
    }
}

data class SavedFinancialPlan(
    val version: Int,
    val revision: Long,
    val updatedAt: Long,
    val inputs: FinancialPlanInputs,
    val analysis: FinancialPlanAnalysis,
) {
    companion object {
        fun fromJson(json: JSONObject): SavedFinancialPlan {
            val version = json.requiredSafeLong("version", min = 1L, max = 1L).toInt()
            val revision = json.requiredSafeLong("revision", min = 1L)
            val updatedAt = json.requiredSafeLong("updatedAt", min = 0L)
            require(json.has("inputs") && !json.isNull("inputs")) { "缺少字段：inputs" }
            val inputs = FinancialPlanInputs.fromJson(json.getJSONObject("inputs"))
            require(json.has("analysis") && !json.isNull("analysis")) { "缺少字段：analysis" }
            val analysis = FinancialPlanAnalysis.fromJson(json.getJSONObject("analysis"))
            return SavedFinancialPlan(
                version = version,
                revision = revision,
                updatedAt = updatedAt,
                inputs = inputs,
                analysis = analysis,
            )
        }
    }
}

data class FinancialPlanSaveRequest(
    val expectedRevision: Long,
    val monthlyIncomeCents: Long,
    val essentialMonthlyCents: Long,
    val reserveBalanceCents: Long,
) {
    init {
        require(expectedRevision >= 0) { "expectedRevision 不能为负数" }
        require(monthlyIncomeCents > 0) { "monthlyIncomeCents 必须大于0" }
        require(essentialMonthlyCents > 0) { "essentialMonthlyCents 必须大于0" }
        require(reserveBalanceCents >= 0) { "reserveBalanceCents 不能为负数" }
        require(expectedRevision <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "expectedRevision 超出安全上限" }
        require(monthlyIncomeCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "monthlyIncomeCents 超出安全上限" }
        require(essentialMonthlyCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "essentialMonthlyCents 超出安全上限" }
        require(reserveBalanceCents <= FinancialPlanConstants.MAX_SAFE_INTEGER) { "reserveBalanceCents 超出安全上限" }
    }

    constructor(expectedRevision: Long, inputs: FinancialPlanInputs) : this(
        expectedRevision = expectedRevision,
        monthlyIncomeCents = inputs.monthlyIncomeCents,
        essentialMonthlyCents = inputs.essentialMonthlyCents,
        reserveBalanceCents = inputs.reserveBalanceCents,
    )

    fun toInputs(): FinancialPlanInputs = FinancialPlanInputs(
        monthlyIncomeCents = monthlyIncomeCents,
        essentialMonthlyCents = essentialMonthlyCents,
        reserveBalanceCents = reserveBalanceCents,
    )

    fun toJson(): JSONObject = JSONObject().apply {
        put("expectedRevision", expectedRevision)
        put("monthlyIncomeCents", monthlyIncomeCents)
        put("essentialMonthlyCents", essentialMonthlyCents)
        put("reserveBalanceCents", reserveBalanceCents)
    }
}
