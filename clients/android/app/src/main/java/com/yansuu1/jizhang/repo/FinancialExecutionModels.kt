package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.JsonNumberReaders
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

/**
 * Phase 1 financial-execution wire models.
 *
 * Frozen contract: `.trellis/tasks/10-27-financial-execution-phase1/contract.md`
 * Base route: `/api/v1/financial-planning` (FP).
 *
 * Rules enforced while decoding:
 * - `contractVersion` and all five rule versions are exact; unknown versions fail closed.
 * - Every amount/time/revision is an exact safe integer (|v| <= 2^53-1).
 * - Required fields must be present; a missing value is never treated as zero or null.
 * - `null` is accepted only where the frozen contract declares it nullable.
 * - Ratios are nonnegative basis points summing to exactly 10000.
 * - Growth/reserve execution is always `not-connected` with null executed/remaining.
 * - No DTO computes totals, targets, remaining or net values; server values are preserved verbatim.
 */

object FinancialExecutionContract {
    const val MAX_SAFE_INTEGER = 9007199254740991L // 2^53 - 1
    const val CONTRACT_VERSION = 1L

    const val ALLOCATION_RULE = "financial-allocation-bps-v1"
    const val CYCLE_RULE = "financial-cycle-frozen-month-v1"
    const val PURPOSE_RULE = "financial-purpose-snapshot-v1"
    const val REFUND_RULE = "financial-refund-splits-v1"
    const val EXECUTION_RULE = "financial-net-v1"
    const val GROUPING_RULE = "financial-cycle-frozen-month-v1"

    const val DEFAULT_TARGET_MONTHS = 5
    const val MAX_SELECTED_SOURCES = 200
    const val MAX_REFUND_SPLITS = 100
    const val MAX_CATEGORY_RULES = 2000
    const val MAX_PAGE_SIZE = 100
}

// ── Strict JSON primitives ───────────────────────────────────────────────────

private fun JSONObject.requiredRaw(key: String): Any {
    require(has(key)) { "缺少字段：$key" }
    require(!isNull(key)) { "字段不能为 null：$key" }
    return get(key)
}

private fun JSONObject.requiredString(key: String, allowBlank: Boolean = false): String {
    val raw = requiredRaw(key)
    require(raw is String) { "字段必须是字符串：$key" }
    if (!allowBlank) require(raw.isNotBlank()) { "字段不能为空白：$key" }
    return raw
}

private fun JSONObject.requiredId(key: String): String {
    val value = requiredString(key)
    require(value.length <= 128) { "ID 过长：$key" }
    return value
}

private fun JSONObject.nullableString(key: String): String? {
    require(has(key)) { "缺少字段：$key" }
    if (isNull(key)) return null
    val raw = get(key)
    require(raw is String) { "字段必须是字符串：$key" }
    require(raw.isNotBlank()) { "字段不能为空白：$key" }
    return raw
}

private fun JSONObject.requiredSafeLong(
    key: String,
    min: Long = 0L,
    max: Long = FinancialExecutionContract.MAX_SAFE_INTEGER,
): Long {
    val raw = requiredRaw(key)
    val value = try {
        JsonNumberReaders.requireExactLong(raw, key)
    } catch (e: IllegalArgumentException) {
        throw IllegalArgumentException("字段非精确整型或越界：$key", e)
    }
    require(value >= min) { "字段值低于下限：$key" }
    require(value <= max) { "字段值超出上限：$key" }
    return value
}

private fun JSONObject.nullableSafeLong(
    key: String,
    min: Long = 0L,
    max: Long = FinancialExecutionContract.MAX_SAFE_INTEGER,
): Long? {
    require(has(key)) { "缺少字段：$key" }
    if (isNull(key)) return null
    val raw = get(key)
    val value = try {
        JsonNumberReaders.requireExactLong(raw, key)
    } catch (e: IllegalArgumentException) {
        throw IllegalArgumentException("字段非精确整型或越界：$key", e)
    }
    require(value >= min) { "字段值低于下限：$key" }
    require(value <= max) { "字段值超出上限：$key" }
    return value
}

private fun JSONObject.requiredInt(key: String, min: Int = 0, max: Int = Int.MAX_VALUE): Int {
    val value = requiredSafeLong(key, min.toLong(), max.toLong())
    return value.toInt()
}

private fun JSONObject.requiredBoolean(key: String): Boolean {
    val raw = requiredRaw(key)
    require(raw is Boolean) { "字段必须是布尔值：$key" }
    return raw
}

private fun JSONObject.requiredObject(key: String): JSONObject {
    val raw = requiredRaw(key)
    require(raw is JSONObject) { "字段必须是对象：$key" }
    return raw
}

private fun JSONObject.nullableObject(key: String): JSONObject? {
    require(has(key)) { "缺少字段：$key" }
    if (isNull(key)) return null
    val raw = get(key)
    require(raw is JSONObject) { "字段必须是对象或 null：$key" }
    return raw
}

private fun JSONObject.requiredArray(key: String): JSONArray {
    val raw = requiredRaw(key)
    require(raw is JSONArray) { "字段必须是数组：$key" }
    return raw
}

private fun JSONObject.requiredStringList(key: String): List<String> {
    val array = requiredArray(key)
    return List(array.length()) { index ->
        val raw = array.get(index)
        require(raw is String) { "数组元素必须是字符串：$key" }
        require(raw.isNotBlank()) { "数组元素不能为空白：$key" }
        raw
    }
}

private fun JSONArray.requiredObjectAt(index: Int, label: String): JSONObject {
    val raw = get(index)
    require(raw is JSONObject) { "$label[$index] 必须是对象" }
    return raw
}

private fun requireUnique(values: List<String>, label: String) {
    require(values.size == values.toSet().size) { "$label 包含重复项" }
}

private fun requireGroupMonth(value: String) {
    require(Regex("^\\d{4}-(0[1-9]|1[0-2])$").matches(value)) { "groupMonth 必须是 YYYY-MM" }
}

private fun ratioSum(ratios: FinancialRatiosBps): Long =
    ratios.growth.toLong() + ratios.reserve.toLong() + ratios.essentials.toLong() + ratios.joy.toLong()

// ── Enums ────────────────────────────────────────────────────────────────────

enum class SpendingPurpose(val wire: String) {
    ESSENTIALS("essentials"),
    JOY("joy"),
    ;

    companion object {
        fun fromWire(value: String): SpendingPurpose =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知用途：$value")
    }
}

enum class FundingPurpose(val wire: String) {
    GROWTH("growth"),
    RESERVE("reserve"),
    ;

    companion object {
        fun fromWire(value: String): FundingPurpose =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知资金用途：$value")
    }
}

enum class FinancialCycleKind(val wire: String) {
    NATURAL_MONTH("natural-month"),
    START_DAY("start-day"),
    ;

    companion object {
        fun fromWire(value: String): FinancialCycleKind =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知周期类型：$value")
    }
}

enum class FinancialMappingPolicy(val wire: String) {
    PRESERVE("preserve"),
    CURRENT("current"),
    ;

    companion object {
        fun fromWire(value: String): FinancialMappingPolicy =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知映射策略：$value")
    }
}

enum class FinancialPeriodReason(val wire: String) {
    SALARY_CONFIRMATION("salary-confirmation"),
    INCOME_RECONCILIATION("income-reconciliation"),
    MAPPING_RESTATEMENT("mapping-restatement"),
    ;

    companion object {
        fun fromWire(value: String): FinancialPeriodReason =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知周期原因：$value")
    }
}

enum class FinancialSourceStatus(val wire: String) {
    VALID("valid"),
    CHANGED("changed"),
    DELETED("deleted"),
    PURGED("purged"),
    GROUP_CHANGED("group-changed"),
    ;

    companion object {
        fun fromWire(value: String): FinancialSourceStatus =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知收入源状态：$value")
    }
}

enum class FinancialPeriodSourceState(val wire: String) {
    VALID("valid"),
    RECONCILIATION_REQUIRED("reconciliation-required"),
    EMPTY("empty"),
    ;

    companion object {
        fun fromWire(value: String): FinancialPeriodSourceState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知周期收入源状态：$value")
    }
}

enum class PurposeProvenance(val wire: String) {
    BILL_OVERRIDE("bill-override"),
    CATEGORY_RULE("category-rule"),
    ANCESTOR_RULE("ancestor-rule"),
    UNRESOLVED("unresolved"),
    ;

    companion object {
        fun fromWire(value: String): PurposeProvenance =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知用途来源：$value")
    }
}

enum class PurposeResolutionReason(val wire: String) {
    NOT_MAPPED("not-mapped"),
    EXPLICIT_UNRESOLVED("explicit-unresolved"),
    CATEGORY_NOT_IN_SNAPSHOT("category-not-in-snapshot"),
    INVALID_TOPOLOGY("invalid-topology"),
    ;

    companion object {
        fun fromWire(value: String): PurposeResolutionReason =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知用途解析原因：$value")
    }
}

enum class FinancialRefundState(val wire: String) {
    UNCONFIRMED("unconfirmed"),
    CONFIRMED("confirmed"),
    REVIEW_REQUIRED("review-required"),
    DELETED("deleted"),
    PURGED("purged"),
    NOT_REFUND("not-refund"),
    ;

    companion object {
        fun fromWire(value: String): FinancialRefundState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知退款状态：$value")
    }
}

enum class FinancialRefundOriginalState(val wire: String) {
    LIVE("live"),
    DELETED("deleted"),
    PURGED("purged"),
    NOT_EXPENSE("not-expense"),
    ;

    companion object {
        fun fromWire(value: String): FinancialRefundOriginalState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知退款原单状态：$value")
    }
}

enum class FinancialExecutionCoverage(val wire: String) {
    EXACT("exact"),
    PROVISIONAL("provisional"),
    ;

    companion object {
        fun fromWire(value: String): FinancialExecutionCoverage =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知执行覆盖状态：$value")
    }
}

enum class FinancialSpendState(val wire: String) {
    EXACT("exact"),
    PROVISIONAL("provisional"),
    ;

    companion object {
        fun fromWire(value: String): FinancialSpendState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知消费执行状态：$value")
    }
}

enum class FinancialCurrentState(val wire: String) {
    READY("ready"),
    NO_PERIOD("no-period"),
    ;

    companion object {
        fun fromWire(value: String): FinancialCurrentState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知当前执行状态：$value")
    }
}

enum class FinancialExecutionFactKind(val wire: String) {
    EXPENSE("expense"),
    REFUND_SPLIT("refund-split"),
    PENDING_REFUND("pending-refund"),
    ;

    companion object {
        fun fromWire(value: String): FinancialExecutionFactKind =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知执行明细类型：$value")
    }
}

enum class FinancialExecutionFactStatus(val wire: String) {
    COUNTED("counted"),
    UNRESOLVED("unresolved"),
    EXCLUDED("excluded"),
    ;

    companion object {
        fun fromWire(value: String): FinancialExecutionFactStatus =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知执行明细状态：$value")
    }
}

enum class FinancialDetailPurpose(val wire: String) {
    ESSENTIALS("essentials"),
    JOY("joy"),
    UNRESOLVED("unresolved"),
    ;
}

enum class FinancialDetailKind(val wire: String) {
    ALL("all"),
    EXPENSE("expense"),
    REFUND("refund"),
    ;
}

// ── Meta / config / capabilities ─────────────────────────────────────────────

data class FinancialRules(
    val allocation: String,
    val cycle: String,
    val purpose: String,
    val refund: String,
    val execution: String,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRules {
            val rules = FinancialRules(
                allocation = json.requiredString("allocation"),
                cycle = json.requiredString("cycle"),
                purpose = json.requiredString("purpose"),
                refund = json.requiredString("refund"),
                execution = json.requiredString("execution"),
            )
            require(rules.allocation == FinancialExecutionContract.ALLOCATION_RULE) { "不支持的分配规则版本" }
            require(rules.cycle == FinancialExecutionContract.CYCLE_RULE) { "不支持的周期规则版本" }
            require(rules.purpose == FinancialExecutionContract.PURPOSE_RULE) { "不支持的用途规则版本" }
            require(rules.refund == FinancialExecutionContract.REFUND_RULE) { "不支持的退款规则版本" }
            require(rules.execution == FinancialExecutionContract.EXECUTION_RULE) { "不支持的执行规则版本" }
            return rules
        }
    }
}

data class FinancialMeta(
    val contractVersion: Long,
    val rules: FinancialRules,
    val calculatedAt: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialMeta = FinancialMeta(
            contractVersion = json.requiredSafeLong(
                "contractVersion",
                min = FinancialExecutionContract.CONTRACT_VERSION,
                max = FinancialExecutionContract.CONTRACT_VERSION,
            ),
            rules = FinancialRules.fromJson(json.requiredObject("rules")),
            calculatedAt = json.requiredSafeLong("calculatedAt"),
        )
    }
}

data class FinancialRatiosBps(
    val growth: Int,
    val reserve: Int,
    val essentials: Int,
    val joy: Int,
) {
    init {
        require(growth in 0..10000) { "growth 比例必须在 0..10000" }
        require(reserve in 0..10000) { "reserve 比例必须在 0..10000" }
        require(essentials in 0..10000) { "essentials 比例必须在 0..10000" }
        require(joy in 0..10000) { "joy 比例必须在 0..10000" }
        require(ratioSum(this) == 10000L) { "四项比例之和必须等于 10000" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("growth", growth)
        .put("reserve", reserve)
        .put("essentials", essentials)
        .put("joy", joy)

    companion object {
        val DEFAULT = FinancialRatiosBps(growth = 2500, reserve = 1500, essentials = 5000, joy = 1000)

        fun fromJson(json: JSONObject): FinancialRatiosBps = FinancialRatiosBps(
            growth = json.requiredInt("growth", 0, 10000),
            reserve = json.requiredInt("reserve", 0, 10000),
            essentials = json.requiredInt("essentials", 0, 10000),
            joy = json.requiredInt("joy", 0, 10000),
        )
    }
}

data class PurposeAmounts(
    val growth: Long,
    val reserve: Long,
    val essentials: Long,
    val joy: Long,
) {
    init {
        require(growth >= 0 && reserve >= 0 && essentials >= 0 && joy >= 0) { "用途金额不能为负数" }
    }

    companion object {
        fun fromJson(json: JSONObject): PurposeAmounts = PurposeAmounts(
            growth = json.requiredSafeLong("growth"),
            reserve = json.requiredSafeLong("reserve"),
            essentials = json.requiredSafeLong("essentials"),
            joy = json.requiredSafeLong("joy"),
        )
    }
}

data class FinancialCycle(
    val kind: FinancialCycleKind,
    val day: Int? = null,
) {
    init {
        when (kind) {
            FinancialCycleKind.NATURAL_MONTH -> require(day == null) { "natural-month 不能指定 day" }
            FinancialCycleKind.START_DAY -> require(day != null && day in 1..28) { "start-day 必须指定 1..28 的 day" }
        }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("kind", kind.wire)
        if (day != null) put("day", day)
    }

    companion object {
        fun naturalMonth(): FinancialCycle = FinancialCycle(FinancialCycleKind.NATURAL_MONTH)

        fun startDay(day: Int): FinancialCycle = FinancialCycle(FinancialCycleKind.START_DAY, day)

        fun fromJson(json: JSONObject): FinancialCycle {
            val kind = FinancialCycleKind.fromWire(json.requiredString("kind"))
            return when (kind) {
                FinancialCycleKind.NATURAL_MONTH -> {
                    require(!json.has("day") || json.isNull("day")) { "natural-month 不能携带 day" }
                    FinancialCycle(kind, null)
                }
                FinancialCycleKind.START_DAY -> FinancialCycle(
                    kind,
                    json.requiredInt("day", 1, 28),
                )
            }
        }
    }
}

data class FinancialLimits(
    val pageSize: Int,
    val selectedSources: Int,
    val refundSplits: Int,
    val categoryRules: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialLimits = FinancialLimits(
            pageSize = json.requiredInt("pageSize", 1, 100),
            selectedSources = json.requiredInt("selectedSources", 1, 1000),
            refundSplits = json.requiredInt("refundSplits", 1, 1000),
            categoryRules = json.requiredInt("categoryRules", 1, 100000),
        )
    }
}

data class FinancialCapabilitiesResponse(
    val meta: FinancialMeta,
    val phase: Int,
    val executionSupported: Boolean,
    val salaryIdempotency: Boolean,
    val billPurposeOverride: Boolean,
    val refundSplits: Boolean,
    val fundingExecution: Boolean,
    val review: Boolean,
    val aiExplanation: Boolean,
    val limits: FinancialLimits,
    val serverTimeZone: String,
    val legacyManualPlan: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialCapabilitiesResponse {
            val phase = json.requiredInt("phase", 1, 1)
            return FinancialCapabilitiesResponse(
                meta = FinancialMeta.fromJson(json),
                phase = phase,
                executionSupported = json.requiredBoolean("executionSupported"),
                salaryIdempotency = json.requiredBoolean("salaryIdempotency"),
                billPurposeOverride = json.requiredBoolean("billPurposeOverride"),
                refundSplits = json.requiredBoolean("refundSplits"),
                fundingExecution = json.requiredBoolean("fundingExecution"),
                review = json.requiredBoolean("review"),
                aiExplanation = json.requiredBoolean("aiExplanation"),
                limits = FinancialLimits.fromJson(json.requiredObject("limits")),
                serverTimeZone = json.requiredString("serverTimeZone"),
                legacyManualPlan = json.requiredBoolean("legacyManualPlan"),
            )
        }
    }
}

data class FinancialConfig(
    val revision: Long,
    val enabled: Boolean,
    val ratiosBps: FinancialRatiosBps,
    val essentialMonthlyCents: Long?,
    val targetMonths: Int,
    val cycle: FinancialCycle,
    val timeZone: String,
    val updatedAt: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialConfig = FinancialConfig(
            revision = json.requiredSafeLong("revision"),
            enabled = json.requiredBoolean("enabled"),
            ratiosBps = FinancialRatiosBps.fromJson(json.requiredObject("ratiosBps")),
            essentialMonthlyCents = json.nullableSafeLong("essentialMonthlyCents", min = 1L),
            targetMonths = json.requiredInt("targetMonths", 1, 120),
            cycle = FinancialCycle.fromJson(json.requiredObject("cycle")),
            timeZone = json.requiredString("timeZone"),
            updatedAt = json.nullableSafeLong("updatedAt"),
        )
    }
}

data class FinancialConfigResponse(
    val meta: FinancialMeta,
    val config: FinancialConfig,
    val mappingRevision: Long,
    val legacyCycle: FinancialCycle?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialConfigResponse {
            require(json.has("legacyCycle")) { "缺少字段：legacyCycle" }
            val legacyCycle = if (json.isNull("legacyCycle")) {
                null
            } else {
                FinancialCycle.fromJson(json.requiredObject("legacyCycle"))
            }
            return FinancialConfigResponse(
                meta = FinancialMeta.fromJson(json),
                config = FinancialConfig.fromJson(json.requiredObject("config")),
                mappingRevision = json.requiredSafeLong("mappingRevision"),
                legacyCycle = legacyCycle,
            )
        }
    }
}

data class FinancialConfigUpdateRequest(
    val operationId: String,
    val expectedRevision: Long,
    val enabled: Boolean,
    val ratiosBps: FinancialRatiosBps,
    val essentialMonthlyCents: Long?,
    val targetMonths: Int,
    val cycle: FinancialCycle,
    val timeZone: String,
) {
    init {
        require(operationId.isNotBlank() && operationId.length <= 128) { "operationId 无效" }
        require(expectedRevision >= 0 && expectedRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedRevision 超出范围"
        }
        require(essentialMonthlyCents == null || essentialMonthlyCents > 0) { "essentialMonthlyCents 必须为正数或 null" }
        require(essentialMonthlyCents == null || essentialMonthlyCents <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "essentialMonthlyCents 超出安全上限"
        }
        require(targetMonths in 1..120) { "targetMonths 必须在 1..120" }
        require(timeZone.isNotBlank()) { "timeZone 不能为空白" }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("operationId", operationId)
        put("expectedRevision", expectedRevision)
        put("enabled", enabled)
        put("ratiosBps", ratiosBps.toJson())
        put("essentialMonthlyCents", essentialMonthlyCents ?: JSONObject.NULL)
        put("targetMonths", targetMonths)
        put("cycle", cycle.toJson())
        put("timeZone", timeZone)
    }
}

data class FinancialConfigUpdateResponse(
    val meta: FinancialMeta,
    val config: FinancialConfig,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialConfigUpdateResponse = FinancialConfigUpdateResponse(
            meta = FinancialMeta.fromJson(json),
            config = FinancialConfig.fromJson(json.requiredObject("config")),
        )
    }
}

// ── Salary sources / periods ─────────────────────────────────────────────────

data class FinancialLegacyWindow(
    val start: Long,
    val end: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialLegacyWindow = FinancialLegacyWindow(
            start = json.requiredSafeLong("start"),
            end = json.nullableSafeLong("end"),
        )
    }
}

data class FinancialWindow(
    val cycleKey: String,
    val groupMonth: String,
    val start: Long,
    val end: Long,
    val timeZone: String,
    val cycle: FinancialCycle,
    val anchorSalaryId: String,
    val groupingRule: String,
    val legacyWindow: FinancialLegacyWindow?,
    val warnings: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialWindow {
            val groupMonth = json.requiredString("groupMonth")
            requireGroupMonth(groupMonth)
            val start = json.requiredSafeLong("start")
            val end = json.requiredSafeLong("end")
            require(end > start) { "周期结束必须晚于开始" }
            require(json.requiredString("groupingRule") == FinancialExecutionContract.GROUPING_RULE) {
                "不支持的周期分组规则版本"
            }
            require(json.has("legacyWindow")) { "缺少字段：legacyWindow" }
            return FinancialWindow(
                cycleKey = json.requiredString("cycleKey"),
                groupMonth = groupMonth,
                start = start,
                end = end,
                timeZone = json.requiredString("timeZone"),
                cycle = FinancialCycle.fromJson(json.requiredObject("cycle")),
                anchorSalaryId = json.requiredId("anchorSalaryId"),
                groupingRule = FinancialExecutionContract.GROUPING_RULE,
                legacyWindow = json.nullableObject("legacyWindow")?.let { FinancialLegacyWindow.fromJson(it) },
                warnings = json.requiredStringList("warnings"),
            )
        }
    }
}

data class FinancialSalarySource(
    val salaryId: String,
    val amountCents: Long,
    val date: Long,
    val accountId: String,
    val sourceToken: String,
    val updatedAt: Long,
    val includedPeriodId: String?,
    val includedRevision: Long?,
    val proposedGroupMonth: String,
    val proposedWindow: FinancialWindow?,
    val selectable: Boolean,
    val reason: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSalarySource {
            val groupMonth = json.requiredString("proposedGroupMonth")
            requireGroupMonth(groupMonth)
            require(json.has("includedPeriodId")) { "缺少字段：includedPeriodId" }
            require(json.has("proposedWindow")) { "缺少字段：proposedWindow" }
            return FinancialSalarySource(
                salaryId = json.requiredId("salaryId"),
                amountCents = json.requiredSafeLong("amountCents"),
                date = json.requiredSafeLong("date"),
                accountId = json.requiredId("accountId"),
                sourceToken = json.requiredString("sourceToken"),
                updatedAt = json.requiredSafeLong("updatedAt"),
                includedPeriodId = json.nullableString("includedPeriodId"),
                includedRevision = json.nullableSafeLong("includedRevision"),
                proposedGroupMonth = groupMonth,
                proposedWindow = json.nullableObject("proposedWindow")?.let { FinancialWindow.fromJson(it) },
                selectable = json.requiredBoolean("selectable"),
                reason = json.nullableString("reason"),
            )
        }
    }
}

data class FinancialSourceFacts(
    val amountCents: Long,
    val date: Long,
    val accountId: String,
    val sourceToken: String,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSourceFacts = FinancialSourceFacts(
            amountCents = json.requiredSafeLong("amountCents"),
            date = json.requiredSafeLong("date"),
            accountId = json.requiredId("accountId"),
            sourceToken = json.requiredString("sourceToken"),
        )
    }
}

data class FinancialSourceSnapshot(
    val salaryId: String,
    val amountCents: Long,
    val date: Long,
    val accountId: String,
    val sourceToken: String,
    val confirmedAt: Long,
    val status: FinancialSourceStatus,
    val current: FinancialSourceFacts?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSourceSnapshot {
            require(json.has("current")) { "缺少字段：current" }
            return FinancialSourceSnapshot(
                salaryId = json.requiredId("salaryId"),
                amountCents = json.requiredSafeLong("amountCents"),
                date = json.requiredSafeLong("date"),
                accountId = json.requiredId("accountId"),
                sourceToken = json.requiredString("sourceToken"),
                confirmedAt = json.requiredSafeLong("confirmedAt"),
                status = FinancialSourceStatus.fromWire(json.requiredString("status")),
                current = json.nullableObject("current")?.let { FinancialSourceFacts.fromJson(it) },
            )
        }
    }
}

data class FinancialSalarySourcesResponse(
    val meta: FinancialMeta,
    val items: List<FinancialSalarySource>,
    val total: Long,
    val limit: Int,
    val offset: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSalarySourcesResponse {
            val array = json.requiredArray("items")
            return FinancialSalarySourcesResponse(
                meta = FinancialMeta.fromJson(json),
                items = List(array.length()) { index ->
                    FinancialSalarySource.fromJson(array.requiredObjectAt(index, "items"))
                },
                total = json.requiredSafeLong("total"),
                limit = json.requiredInt("limit", 1, FinancialExecutionContract.MAX_PAGE_SIZE),
                offset = json.requiredInt("offset", 0, Int.MAX_VALUE),
            )
        }
    }
}

data class FinancialSalarySourceResponse(
    val meta: FinancialMeta,
    val source: FinancialSalarySource,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSalarySourceResponse = FinancialSalarySourceResponse(
            meta = FinancialMeta.fromJson(json),
            source = FinancialSalarySource.fromJson(json.requiredObject("source")),
        )
    }
}

data class FinancialSourceSelection(
    val salaryId: String,
    val expectedSourceToken: String,
) {
    init {
        require(salaryId.isNotBlank() && salaryId.length <= 128) { "salaryId 无效" }
        require(expectedSourceToken.isNotBlank()) { "expectedSourceToken 不能为空白" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("salaryId", salaryId)
        .put("expectedSourceToken", expectedSourceToken)
}

data class FinancialPeriodProposal(
    val periodId: String?,
    val expectedRevision: Long,
    val expectedConfigRevision: Long,
    val expectedMappingRevision: Long,
    val selectedSources: List<FinancialSourceSelection>,
    val mappingPolicy: FinancialMappingPolicy,
    val reason: FinancialPeriodReason,
) {
    init {
        require(periodId == null || (periodId.isNotBlank() && periodId.length <= 128)) { "periodId 无效" }
        require(expectedRevision >= 0 && expectedRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedRevision 超出范围"
        }
        require(expectedConfigRevision >= 0 && expectedConfigRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedConfigRevision 超出范围"
        }
        require(expectedMappingRevision >= 0 && expectedMappingRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedMappingRevision 超出范围"
        }
        require(selectedSources.size <= FinancialExecutionContract.MAX_SELECTED_SOURCES) {
            "selectedSources 不能超过 200"
        }
        requireUnique(selectedSources.map { it.salaryId }, "selectedSources")
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("periodId", periodId ?: JSONObject.NULL)
        put("expectedRevision", expectedRevision)
        put("expectedConfigRevision", expectedConfigRevision)
        put("expectedMappingRevision", expectedMappingRevision)
        put("selectedSources", JSONArray().apply {
            selectedSources.forEach { put(it.toJson()) }
        })
        put("mappingPolicy", mappingPolicy.wire)
        put("reason", reason.wire)
    }

    companion object {
        fun fromJson(json: JSONObject): FinancialPeriodProposal {
            require(json.has("periodId")) { "缺少字段：periodId" }
            val sourcesArray = json.requiredArray("selectedSources")
            val sources = List(sourcesArray.length()) { index ->
                val item = sourcesArray.requiredObjectAt(index, "selectedSources")
                FinancialSourceSelection(
                    salaryId = item.requiredId("salaryId"),
                    expectedSourceToken = item.requiredString("expectedSourceToken"),
                )
            }
            return FinancialPeriodProposal(
                periodId = json.nullableString("periodId"),
                expectedRevision = json.requiredSafeLong("expectedRevision"),
                expectedConfigRevision = json.requiredSafeLong("expectedConfigRevision"),
                expectedMappingRevision = json.requiredSafeLong("expectedMappingRevision"),
                selectedSources = sources,
                mappingPolicy = FinancialMappingPolicy.fromWire(json.requiredString("mappingPolicy")),
                reason = FinancialPeriodReason.fromWire(json.requiredString("reason")),
            )
        }
    }
}

data class FinancialAllocationDecision(
    val incomeCents: Long,
    val ratiosBps: FinancialRatiosBps,
    val targets: PurposeAmounts,
    val configRevision: Long,
    val mappingRevision: Long,
    val mappingSnapshotId: String?,
    val essentialMonthlyCents: Long?,
    val targetMonths: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialAllocationDecision = FinancialAllocationDecision(
            incomeCents = json.requiredSafeLong("incomeCents"),
            ratiosBps = FinancialRatiosBps.fromJson(json.requiredObject("ratiosBps")),
            targets = PurposeAmounts.fromJson(json.requiredObject("targets")),
            configRevision = json.requiredSafeLong("configRevision"),
            mappingRevision = json.requiredSafeLong("mappingRevision"),
            mappingSnapshotId = json.nullableString("mappingSnapshotId"),
            essentialMonthlyCents = json.nullableSafeLong("essentialMonthlyCents", min = 1L),
            targetMonths = json.requiredInt("targetMonths", 1, 120),
        )
    }
}

data class FinancialPreviewImpact(
    val addedSalaryIds: List<String>,
    val removedSalaryIds: List<String>,
    val changedSalaryIds: List<String>,
    val mappingChanged: Boolean,
    val reclassifiedExpenseCount: Long,
    val reclassifiedGrossCents: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPreviewImpact = FinancialPreviewImpact(
            addedSalaryIds = json.requiredStringList("addedSalaryIds"),
            removedSalaryIds = json.requiredStringList("removedSalaryIds"),
            changedSalaryIds = json.requiredStringList("changedSalaryIds"),
            mappingChanged = json.requiredBoolean("mappingChanged"),
            reclassifiedExpenseCount = json.requiredSafeLong("reclassifiedExpenseCount"),
            reclassifiedGrossCents = json.requiredSafeLong("reclassifiedGrossCents"),
        )
    }
}

data class FinancialPreview(
    val meta: FinancialMeta,
    val previewToken: String,
    val proposal: FinancialPeriodProposal,
    val window: FinancialWindow,
    val decision: FinancialAllocationDecision,
    val sources: List<FinancialSourceSnapshot>,
    val excludedSources: List<FinancialSalarySource>,
    val previousRevision: Long,
    val warnings: List<String>,
    val impact: FinancialPreviewImpact,
) {
    companion object {
        /**
         * Backend returns meta at the response root and the preview fields inside
         * `preview`; the contract form (meta inside the preview object) is also
         * accepted when [metaSource] is omitted.
         */
        fun fromJson(json: JSONObject, metaSource: JSONObject = json): FinancialPreview {
            val sourcesArray = json.requiredArray("sources")
            val excludedArray = json.requiredArray("excludedSources")
            return FinancialPreview(
                meta = FinancialMeta.fromJson(metaSource),
                previewToken = json.requiredString("previewToken"),
                proposal = FinancialPeriodProposal.fromJson(json.requiredObject("proposal")),
                window = FinancialWindow.fromJson(json.requiredObject("window")),
                decision = FinancialAllocationDecision.fromJson(json.requiredObject("decision")),
                sources = List(sourcesArray.length()) { index ->
                    FinancialSourceSnapshot.fromJson(sourcesArray.requiredObjectAt(index, "sources"))
                },
                excludedSources = List(excludedArray.length()) { index ->
                    FinancialSalarySource.fromJson(excludedArray.requiredObjectAt(index, "excludedSources"))
                },
                previousRevision = json.requiredSafeLong("previousRevision"),
                warnings = json.requiredStringList("warnings"),
                impact = FinancialPreviewImpact.fromJson(json.requiredObject("impact")),
            )
        }
    }
}

data class FinancialPeriod(
    val id: String,
    val revision: Long,
    val createdAt: Long,
    val confirmedAt: Long,
    val window: FinancialWindow,
    val decision: FinancialAllocationDecision,
    val sources: List<FinancialSourceSnapshot>,
    val sourceState: FinancialPeriodSourceState,
    val confirmedIncomeCents: Long,
    val verifiedIncomeCents: Long,
    val warnings: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPeriod {
            val sourcesArray = json.requiredArray("sources")
            return FinancialPeriod(
                id = json.requiredId("id"),
                revision = json.requiredSafeLong("revision"),
                createdAt = json.requiredSafeLong("createdAt"),
                confirmedAt = json.requiredSafeLong("confirmedAt"),
                window = FinancialWindow.fromJson(json.requiredObject("window")),
                decision = FinancialAllocationDecision.fromJson(json.requiredObject("decision")),
                sources = List(sourcesArray.length()) { index ->
                    FinancialSourceSnapshot.fromJson(sourcesArray.requiredObjectAt(index, "sources"))
                },
                sourceState = FinancialPeriodSourceState.fromWire(json.requiredString("sourceState")),
                confirmedIncomeCents = json.requiredSafeLong("confirmedIncomeCents"),
                verifiedIncomeCents = json.requiredSafeLong("verifiedIncomeCents"),
                warnings = json.requiredStringList("warnings"),
            )
        }
    }
}

data class FinancialPeriodResponse(
    val meta: FinancialMeta,
    val period: FinancialPeriod,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPeriodResponse = FinancialPeriodResponse(
            meta = FinancialMeta.fromJson(json),
            period = FinancialPeriod.fromJson(json.requiredObject("period")),
        )
    }
}

data class FinancialPeriodsResponse(
    val meta: FinancialMeta,
    val items: List<FinancialPeriod>,
    val total: Long,
    val limit: Int,
    val offset: Int,
    val currentPeriodId: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPeriodsResponse {
            require(json.has("currentPeriodId")) { "缺少字段：currentPeriodId" }
            val array = json.requiredArray("items")
            return FinancialPeriodsResponse(
                meta = FinancialMeta.fromJson(json),
                items = List(array.length()) { index ->
                    FinancialPeriod.fromJson(array.requiredObjectAt(index, "items"))
                },
                total = json.requiredSafeLong("total"),
                limit = json.requiredInt("limit", 1, FinancialExecutionContract.MAX_PAGE_SIZE),
                offset = json.requiredInt("offset", 0, Int.MAX_VALUE),
                currentPeriodId = json.nullableString("currentPeriodId"),
            )
        }
    }
}

data class FinancialPeriodRevisionsResponse(
    val meta: FinancialMeta,
    val items: List<FinancialPeriod>,
    val total: Long,
    val limit: Int,
    val offset: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPeriodRevisionsResponse {
            val array = json.requiredArray("items")
            return FinancialPeriodRevisionsResponse(
                meta = FinancialMeta.fromJson(json),
                items = List(array.length()) { index ->
                    FinancialPeriod.fromJson(array.requiredObjectAt(index, "items"))
                },
                total = json.requiredSafeLong("total"),
                limit = json.requiredInt("limit", 1, FinancialExecutionContract.MAX_PAGE_SIZE),
                offset = json.requiredInt("offset", 0, Int.MAX_VALUE),
            )
        }
    }
}

data class FinancialPeriodConfirmRequest(
    val operationId: String,
    val proposal: FinancialPeriodProposal,
    val previewToken: String,
) {
    init {
        require(operationId.isNotBlank() && operationId.length <= 128) { "operationId 无效" }
        require(previewToken.isNotBlank()) { "previewToken 不能为空白" }
    }

    /** Frozen body shape: `operationId + proposal fields + previewToken` (flattened). */
    fun toJson(): JSONObject = proposal.toJson().apply {
        put("operationId", operationId)
        put("previewToken", previewToken)
    }
}

data class FinancialPeriodConfirmResponse(
    val meta: FinancialMeta,
    val period: FinancialPeriod,
    val affectedPeriodIds: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialPeriodConfirmResponse = FinancialPeriodConfirmResponse(
            meta = FinancialMeta.fromJson(json),
            period = FinancialPeriod.fromJson(json.requiredObject("period")),
            affectedPeriodIds = json.requiredStringList("affectedPeriodIds"),
        )
    }
}

// ── Category mapping and bill purpose ────────────────────────────────────────

data class FinancialCategoryRule(
    val categoryId: String,
    val purpose: SpendingPurpose?,
) {
    init {
        require(categoryId.isNotBlank() && categoryId.length <= 128) { "categoryId 无效" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("categoryId", categoryId)
        .put("purpose", purpose?.wire ?: JSONObject.NULL)

    companion object {
        fun fromJson(json: JSONObject): FinancialCategoryRule {
            require(json.has("purpose")) { "缺少字段：purpose" }
            val purpose = if (json.isNull("purpose")) {
                null
            } else {
                SpendingPurpose.fromWire(json.requiredString("purpose"))
            }
            return FinancialCategoryRule(
                categoryId = json.requiredId("categoryId"),
                purpose = purpose,
            )
        }
    }
}

data class FinancialMappingCategory(
    val id: String,
    val parentId: String?,
    val deleted: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialMappingCategory {
            require(json.has("parentId")) { "缺少字段：parentId" }
            return FinancialMappingCategory(
                id = json.requiredId("id"),
                parentId = json.nullableString("parentId"),
                deleted = json.requiredBoolean("deleted"),
            )
        }
    }
}

data class FinancialMappingSnapshot(
    val revision: Long,
    val rules: List<FinancialCategoryRule>,
    val categories: List<FinancialMappingCategory>,
    val topologyToken: String,
    val updatedAt: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialMappingSnapshot {
            val rulesArray = json.requiredArray("rules")
            val categoriesArray = json.requiredArray("categories")
            val rules = List(rulesArray.length()) { index ->
                FinancialCategoryRule.fromJson(rulesArray.requiredObjectAt(index, "rules"))
            }
            require(rules.size <= FinancialExecutionContract.MAX_CATEGORY_RULES) { "分类规则超过 2000 条" }
            requireUnique(rules.map { it.categoryId }, "rules")
            val categories = List(categoriesArray.length()) { index ->
                FinancialMappingCategory.fromJson(categoriesArray.requiredObjectAt(index, "categories"))
            }
            requireUnique(categories.map { it.id }, "categories")
            return FinancialMappingSnapshot(
                revision = json.requiredSafeLong("revision"),
                rules = rules,
                categories = categories,
                topologyToken = json.requiredString("topologyToken"),
                updatedAt = json.nullableSafeLong("updatedAt"),
            )
        }
    }
}

data class FinancialCategoryRulesResponse(
    val meta: FinancialMeta,
    val mapping: FinancialMappingSnapshot,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialCategoryRulesResponse = FinancialCategoryRulesResponse(
            meta = FinancialMeta.fromJson(json),
            mapping = FinancialMappingSnapshot.fromJson(json.requiredObject("mapping")),
        )
    }
}

data class FinancialCategoryRulesUpdateRequest(
    val operationId: String,
    val expectedRevision: Long,
    val expectedTopologyToken: String,
    val rules: List<FinancialCategoryRule>,
) {
    init {
        require(operationId.isNotBlank() && operationId.length <= 128) { "operationId 无效" }
        require(expectedRevision >= 0 && expectedRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedRevision 超出范围"
        }
        require(expectedTopologyToken.isNotBlank()) { "expectedTopologyToken 不能为空白" }
        require(rules.size <= FinancialExecutionContract.MAX_CATEGORY_RULES) { "rules 不能超过 2000 条" }
        requireUnique(rules.map { it.categoryId }, "rules")
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("operationId", operationId)
        put("expectedRevision", expectedRevision)
        put("expectedTopologyToken", expectedTopologyToken)
        put("rules", JSONArray().apply { rules.forEach { put(it.toJson()) } })
    }
}

data class PurposeResolution(
    val purpose: SpendingPurpose?,
    val provenance: PurposeProvenance,
    val ruleCategoryId: String?,
    val mappingRevision: Long,
    val reason: PurposeResolutionReason?,
) {
    companion object {
        fun fromJson(json: JSONObject): PurposeResolution {
            require(json.has("purpose")) { "缺少字段：purpose" }
            require(json.has("ruleCategoryId")) { "缺少字段：ruleCategoryId" }
            require(json.has("reason")) { "缺少字段：reason" }
            val purpose = if (json.isNull("purpose")) null else SpendingPurpose.fromWire(json.requiredString("purpose"))
            val reason = if (json.isNull("reason")) {
                null
            } else {
                PurposeResolutionReason.fromWire(json.requiredString("reason"))
            }
            return PurposeResolution(
                purpose = purpose,
                provenance = PurposeProvenance.fromWire(json.requiredString("provenance")),
                ruleCategoryId = json.nullableString("ruleCategoryId"),
                mappingRevision = json.requiredSafeLong("mappingRevision"),
                reason = reason,
            )
        }
    }
}

data class FinancialBillPurpose(
    val transactionId: String,
    val transactionToken: String,
    val revision: Long,
    val financialPurpose: SpendingPurpose?,
    val resolution: PurposeResolution,
    val periodId: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialBillPurpose {
            require(json.has("financialPurpose")) { "缺少字段：financialPurpose" }
            require(json.has("periodId")) { "缺少字段：periodId" }
            val financialPurpose = if (json.isNull("financialPurpose")) {
                null
            } else {
                SpendingPurpose.fromWire(json.requiredString("financialPurpose"))
            }
            return FinancialBillPurpose(
                transactionId = json.requiredId("transactionId"),
                transactionToken = json.requiredString("transactionToken"),
                revision = json.requiredSafeLong("revision"),
                financialPurpose = financialPurpose,
                resolution = PurposeResolution.fromJson(json.requiredObject("resolution")),
                periodId = json.nullableString("periodId"),
            )
        }
    }
}

data class FinancialBillPurposeResponse(
    val meta: FinancialMeta,
    val billPurpose: FinancialBillPurpose,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialBillPurposeResponse = FinancialBillPurposeResponse(
            meta = FinancialMeta.fromJson(json),
            billPurpose = FinancialBillPurpose.fromJson(json.billPurposeBody()),
        )
    }
}

data class FinancialBillPurposeUpdateRequest(
    val operationId: String,
    val expectedRevision: Long,
    val expectedTransactionToken: String,
    val financialPurpose: SpendingPurpose?,
) {
    init {
        require(operationId.isNotBlank() && operationId.length <= 128) { "operationId 无效" }
        require(expectedRevision >= 0 && expectedRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedRevision 超出范围"
        }
        require(expectedTransactionToken.isNotBlank()) { "expectedTransactionToken 不能为空白" }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("operationId", operationId)
        put("expectedRevision", expectedRevision)
        put("expectedTransactionToken", expectedTransactionToken)
        put("financialPurpose", financialPurpose?.wire ?: JSONObject.NULL)
    }
}

data class FinancialBillPurposeUpdateResponse(
    val meta: FinancialMeta,
    val billPurpose: FinancialBillPurpose,
    val affectedPeriodIds: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialBillPurposeUpdateResponse = FinancialBillPurposeUpdateResponse(
            meta = FinancialMeta.fromJson(json),
            billPurpose = FinancialBillPurpose.fromJson(json.billPurposeBody()),
            affectedPeriodIds = json.requiredStringList("affectedPeriodIds"),
        )
    }
}

/** Backend wraps the bill-purpose view under `billPurpose`; flat contract form remains accepted. */
private fun JSONObject.billPurposeBody(): JSONObject =
    if (has("billPurpose")) requiredObject("billPurpose") else this

// ── Refund review / splits ───────────────────────────────────────────────────

data class FinancialRefundSplit(
    val originalTransactionId: String,
    val amountCents: Long,
) {
    init {
        require(originalTransactionId.isNotBlank() && originalTransactionId.length <= 128) {
            "originalTransactionId 无效"
        }
        require(amountCents in 1..FinancialExecutionContract.MAX_SAFE_INTEGER) { "拆分金额必须为正的安全整数" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("originalTransactionId", originalTransactionId)
        .put("amountCents", amountCents)

    companion object {
        fun fromJson(json: JSONObject): FinancialRefundSplit = FinancialRefundSplit(
            originalTransactionId = json.requiredId("originalTransactionId"),
            amountCents = json.requiredSafeLong("amountCents", min = 1L),
        )
    }
}

data class FinancialRefundOriginal(
    val transactionId: String,
    val transactionToken: String,
    val amountCents: Long,
    val date: Long,
    val periodId: String?,
    val resolution: PurposeResolution?,
    val otherConfirmedRefundCents: Long,
    val remainingRefundableCents: Long,
    val state: FinancialRefundOriginalState,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRefundOriginal {
            require(json.has("periodId")) { "缺少字段：periodId" }
            return FinancialRefundOriginal(
                transactionId = json.requiredId("transactionId"),
                transactionToken = json.requiredString("transactionToken"),
                amountCents = json.requiredSafeLong("amountCents"),
                date = json.requiredSafeLong("date"),
                periodId = json.nullableString("periodId"),
                resolution = json.nullableObject("resolution")?.let { PurposeResolution.fromJson(it) },
                otherConfirmedRefundCents = json.requiredSafeLong("otherConfirmedRefundCents"),
                remainingRefundableCents = json.requiredSafeLong("remainingRefundableCents"),
                state = FinancialRefundOriginalState.fromWire(json.requiredString("state")),
            )
        }
    }
}

data class FinancialRefundReview(
    val refundTransactionId: String,
    val refundToken: String,
    val amountCents: Long,
    val date: Long,
    val revision: Long,
    val state: FinancialRefundState,
    val splits: List<FinancialRefundSplit>,
    val validAttributedCents: Long,
    val unresolvedCents: Long,
    val reasons: List<String>,
    val originals: List<FinancialRefundOriginal>,
    val suggestedSplits: List<FinancialRefundSplit>?,
    val legacyOriginalIds: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRefundReview {
            require(json.has("suggestedSplits")) { "缺少字段：suggestedSplits" }
            val splitsArray = json.requiredArray("splits")
            val originalsArray = json.requiredArray("originals")
            val splits = List(splitsArray.length()) { index ->
                FinancialRefundSplit.fromJson(splitsArray.requiredObjectAt(index, "splits"))
            }
            require(splits.size <= FinancialExecutionContract.MAX_REFUND_SPLITS) { "splits 不能超过 100 条" }
            requireUnique(splits.map { it.originalTransactionId }, "splits")
            val suggested = json.nullableObjectArray("suggestedSplits")?.let { array ->
                require(array.length() <= FinancialExecutionContract.MAX_REFUND_SPLITS) {
                    "suggestedSplits 不能超过 100 条"
                }
                List(array.length()) { index ->
                    FinancialRefundSplit.fromJson(array.requiredObjectAt(index, "suggestedSplits"))
                }
            }
            return FinancialRefundReview(
                refundTransactionId = json.requiredId("refundTransactionId"),
                refundToken = json.requiredString("refundToken"),
                amountCents = json.requiredSafeLong("amountCents"),
                date = json.requiredSafeLong("date"),
                revision = json.requiredSafeLong("revision"),
                state = FinancialRefundState.fromWire(json.requiredString("state")),
                splits = splits,
                validAttributedCents = json.requiredSafeLong("validAttributedCents"),
                unresolvedCents = json.requiredSafeLong("unresolvedCents"),
                reasons = json.requiredStringList("reasons"),
                originals = List(originalsArray.length()) { index ->
                    FinancialRefundOriginal.fromJson(originalsArray.requiredObjectAt(index, "originals"))
                },
                suggestedSplits = suggested,
                legacyOriginalIds = json.requiredStringList("legacyOriginalIds"),
            )
        }
    }
}

private fun JSONObject.nullableObjectArray(key: String): JSONArray? {
    require(has(key)) { "缺少字段：$key" }
    if (isNull(key)) return null
    val raw = get(key)
    require(raw is JSONArray) { "字段必须是数组或 null：$key" }
    return raw
}

data class FinancialRefundReviewsResponse(
    val meta: FinancialMeta,
    val items: List<FinancialRefundReview>,
    val total: Long,
    val limit: Int,
    val offset: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRefundReviewsResponse {
            val array = json.requiredArray("items")
            return FinancialRefundReviewsResponse(
                meta = FinancialMeta.fromJson(json),
                items = List(array.length()) { index ->
                    FinancialRefundReview.fromJson(array.requiredObjectAt(index, "items"))
                },
                total = json.requiredSafeLong("total"),
                limit = json.requiredInt("limit", 1, FinancialExecutionContract.MAX_PAGE_SIZE),
                offset = json.requiredInt("offset", 0, Int.MAX_VALUE),
            )
        }
    }
}

data class FinancialRefundResponse(
    val meta: FinancialMeta,
    val refund: FinancialRefundReview,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRefundResponse = FinancialRefundResponse(
            meta = FinancialMeta.fromJson(json),
            refund = FinancialRefundReview.fromJson(json.requiredObject("refund")),
        )
    }
}

data class FinancialRefundOriginalRef(
    val transactionId: String,
    val expectedTransactionToken: String,
) {
    init {
        require(transactionId.isNotBlank() && transactionId.length <= 128) { "transactionId 无效" }
        require(expectedTransactionToken.isNotBlank()) { "expectedTransactionToken 不能为空白" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("transactionId", transactionId)
        .put("expectedTransactionToken", expectedTransactionToken)
}

data class FinancialRefundSplitsUpdateRequest(
    val operationId: String,
    val expectedRevision: Long,
    val expectedRefundToken: String,
    val originals: List<FinancialRefundOriginalRef>,
    val splits: List<FinancialRefundSplit>,
) {
    init {
        require(operationId.isNotBlank() && operationId.length <= 128) { "operationId 无效" }
        require(expectedRevision >= 0 && expectedRevision <= FinancialExecutionContract.MAX_SAFE_INTEGER) {
            "expectedRevision 超出范围"
        }
        require(expectedRefundToken.isNotBlank()) { "expectedRefundToken 不能为空白" }
        require(originals.size <= FinancialExecutionContract.MAX_REFUND_SPLITS) { "originals 不能超过 100 条" }
        require(splits.size <= FinancialExecutionContract.MAX_REFUND_SPLITS) { "splits 不能超过 100 条" }
        requireUnique(originals.map { it.transactionId }, "originals")
        requireUnique(splits.map { it.originalTransactionId }, "splits")
        require(originals.map { it.transactionId }.toSet() == splits.map { it.originalTransactionId }.toSet()) {
            "originals 必须与 splits 的原单集合完全一致"
        }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("operationId", operationId)
        put("expectedRevision", expectedRevision)
        put("expectedRefundToken", expectedRefundToken)
        put("originals", JSONArray().apply { originals.forEach { put(it.toJson()) } })
        put("splits", JSONArray().apply { splits.forEach { put(it.toJson()) } })
    }
}

data class FinancialRefundSplitsUpdateResponse(
    val meta: FinancialMeta,
    val refund: FinancialRefundReview,
    val affectedPeriodIds: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialRefundSplitsUpdateResponse = FinancialRefundSplitsUpdateResponse(
            meta = FinancialMeta.fromJson(json),
            refund = FinancialRefundReview.fromJson(json.requiredObject("refund")),
            affectedPeriodIds = json.requiredStringList("affectedPeriodIds"),
        )
    }
}

// ── Execution read models ────────────────────────────────────────────────────

data class FinancialMappedBudget(
    val essentials: Long,
    val joy: Long,
    val unresolved: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialMappedBudget = FinancialMappedBudget(
            essentials = json.requiredSafeLong("essentials"),
            joy = json.requiredSafeLong("joy"),
            unresolved = json.requiredSafeLong("unresolved"),
        )
    }
}

data class FinancialEnvelopeReference(
    val mode: String,
    val contract: String,
    val totalBudgetCents: Long,
    val mappedBudgetCents: FinancialMappedBudget,
    val purposeSpendingCeilingCents: Long,
    val differenceCents: Long,
    val legacyWindow: FinancialLegacyWindow?,
    val windowMatches: Boolean,
    val validatedNestedAllocation: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialEnvelopeReference {
            require(json.has("legacyWindow")) { "缺少字段：legacyWindow" }
            val mode = json.requiredString("mode")
            require(mode == "legacy-reference") { "未知的预算参考模式：$mode" }
            val contract = json.requiredString("contract")
            require(contract == "legacy-gross") { "未知的预算参考契约：$contract" }
            val validatedNestedAllocation = json.requiredBoolean("validatedNestedAllocation")
            require(!validatedNestedAllocation) { "Phase1 不接受已验证嵌套分配" }
            return FinancialEnvelopeReference(
                mode = mode,
                contract = contract,
                totalBudgetCents = json.requiredSafeLong("totalBudgetCents"),
                mappedBudgetCents = FinancialMappedBudget.fromJson(json.requiredObject("mappedBudgetCents")),
                purposeSpendingCeilingCents = json.requiredSafeLong("purposeSpendingCeilingCents"),
                differenceCents = json.requiredSafeLong(
                    "differenceCents",
                    min = -FinancialExecutionContract.MAX_SAFE_INTEGER,
                ),
                legacyWindow = json.nullableObject("legacyWindow")?.let { FinancialLegacyWindow.fromJson(it) },
                windowMatches = json.requiredBoolean("windowMatches"),
                validatedNestedAllocation = false,
            )
        }
    }
}

data class FinancialSpendExecution(
    val purpose: SpendingPurpose,
    val targetCents: Long,
    val grossCents: Long,
    val attributedRefundCents: Long,
    val netCents: Long,
    val remainingCents: Long,
    val overspendCents: Long,
    val state: FinancialSpendState,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialSpendExecution = FinancialSpendExecution(
            purpose = SpendingPurpose.fromWire(json.requiredString("purpose")),
            targetCents = json.requiredSafeLong("targetCents"),
            grossCents = json.requiredSafeLong("grossCents"),
            attributedRefundCents = json.requiredSafeLong("attributedRefundCents"),
            netCents = json.requiredSafeLong("netCents"),
            remainingCents = json.requiredSafeLong(
                "remainingCents",
                min = -FinancialExecutionContract.MAX_SAFE_INTEGER,
            ),
            overspendCents = json.requiredSafeLong("overspendCents"),
            state = FinancialSpendState.fromWire(json.requiredString("state")),
        )
    }
}

data class FinancialFundingUnavailable(
    val purpose: FundingPurpose,
    val targetCents: Long,
    val state: String,
    val executedCents: Long?,
    val remainingCents: Long?,
) {
    init {
        require(state == "not-connected") { "Phase1 资金用途状态必须为 not-connected" }
        require(executedCents == null) { "Phase1 未接入资金执行，executedCents 必须为 null" }
        require(remainingCents == null) { "Phase1 未接入资金执行，remainingCents 必须为 null" }
    }

    companion object {
        fun fromJson(json: JSONObject): FinancialFundingUnavailable {
            val state = json.requiredString("state")
            return FinancialFundingUnavailable(
                purpose = FundingPurpose.fromWire(json.requiredString("purpose")),
                targetCents = json.requiredSafeLong("targetCents"),
                state = state,
                executedCents = json.nullableSafeLong("executedCents"),
                remainingCents = json.nullableSafeLong("remainingCents"),
            )
        }
    }
}

data class FinancialUnresolvedExecution(
    val expenseCount: Long,
    val grossCents: Long,
    val attributedRefundCents: Long,
    val netCents: Long,
    val linkedRefundCount: Long,
    val linkedRefundUnresolvedCents: Long,
    val globalUnassignedRefundCount: Long,
    val globalUnassignedRefundCents: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialUnresolvedExecution = FinancialUnresolvedExecution(
            expenseCount = json.requiredSafeLong("expenseCount"),
            grossCents = json.requiredSafeLong("grossCents"),
            attributedRefundCents = json.requiredSafeLong("attributedRefundCents"),
            netCents = json.requiredSafeLong("netCents"),
            linkedRefundCount = json.requiredSafeLong("linkedRefundCount"),
            linkedRefundUnresolvedCents = json.requiredSafeLong("linkedRefundUnresolvedCents"),
            globalUnassignedRefundCount = json.requiredSafeLong("globalUnassignedRefundCount"),
            globalUnassignedRefundCents = json.requiredSafeLong("globalUnassignedRefundCents"),
        )
    }
}

data class FinancialExecution(
    val meta: FinancialMeta,
    val period: FinancialPeriod,
    val spending: List<FinancialSpendExecution>,
    val funding: List<FinancialFundingUnavailable>,
    val unresolved: FinancialUnresolvedExecution,
    val coverage: FinancialExecutionCoverage,
    val envelopeReference: FinancialEnvelopeReference,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialExecution {
            val spendingArray = json.requiredArray("spending")
            val fundingArray = json.requiredArray("funding")
            val spending = List(spendingArray.length()) { index ->
                FinancialSpendExecution.fromJson(spendingArray.requiredObjectAt(index, "spending"))
            }
            require(spending.size <= 2) { "spending 最多包含 essentials/joy 两项" }
            requireUnique(spending.map { it.purpose.wire }, "spending")
            val funding = List(fundingArray.length()) { index ->
                FinancialFundingUnavailable.fromJson(fundingArray.requiredObjectAt(index, "funding"))
            }
            require(funding.size <= 2) { "funding 最多包含 growth/reserve 两项" }
            requireUnique(funding.map { it.purpose.wire }, "funding")
            return FinancialExecution(
                meta = FinancialMeta.fromJson(json),
                period = FinancialPeriod.fromJson(json.requiredObject("period")),
                spending = spending,
                funding = funding,
                unresolved = FinancialUnresolvedExecution.fromJson(json.requiredObject("unresolved")),
                coverage = FinancialExecutionCoverage.fromWire(json.requiredString("coverage")),
                envelopeReference = FinancialEnvelopeReference.fromJson(json.requiredObject("envelopeReference")),
            )
        }
    }
}

data class FinancialCurrentExecutionResponse(
    val meta: FinancialMeta,
    val state: FinancialCurrentState,
    val execution: FinancialExecution?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialCurrentExecutionResponse {
            require(json.has("execution")) { "缺少字段：execution" }
            val state = FinancialCurrentState.fromWire(json.requiredString("state"))
            val execution = if (json.isNull("execution")) {
                null
            } else {
                FinancialExecution.fromJson(json.requiredObject("execution"))
            }
            when (state) {
                FinancialCurrentState.READY -> require(execution != null) { "ready 状态必须包含 execution" }
                FinancialCurrentState.NO_PERIOD -> require(execution == null) { "no-period 状态不能包含 execution" }
            }
            return FinancialCurrentExecutionResponse(
                meta = FinancialMeta.fromJson(json),
                state = state,
                execution = execution,
            )
        }
    }
}

data class FinancialExecutionFact(
    val kind: FinancialExecutionFactKind,
    val transactionId: String,
    val originalTransactionId: String?,
    val amountCents: Long,
    val date: Long,
    val categoryId: String?,
    val accountId: String?,
    val purpose: SpendingPurpose?,
    val periodId: String?,
    val resolution: PurposeResolution?,
    val status: FinancialExecutionFactStatus,
    val reason: String?,
    val sourceToken: String,
    val splitRevision: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialExecutionFact {
            require(json.has("originalTransactionId")) { "缺少字段：originalTransactionId" }
            require(json.has("categoryId")) { "缺少字段：categoryId" }
            require(json.has("accountId")) { "缺少字段：accountId" }
            require(json.has("purpose")) { "缺少字段：purpose" }
            require(json.has("periodId")) { "缺少字段：periodId" }
            require(json.has("resolution")) { "缺少字段：resolution" }
            require(json.has("reason")) { "缺少字段：reason" }
            require(json.has("splitRevision")) { "缺少字段：splitRevision" }
            val purpose = if (json.isNull("purpose")) null else SpendingPurpose.fromWire(json.requiredString("purpose"))
            return FinancialExecutionFact(
                kind = FinancialExecutionFactKind.fromWire(json.requiredString("kind")),
                transactionId = json.requiredId("transactionId"),
                originalTransactionId = json.nullableString("originalTransactionId"),
                amountCents = json.requiredSafeLong("amountCents"),
                date = json.requiredSafeLong("date"),
                categoryId = json.nullableString("categoryId"),
                accountId = json.nullableString("accountId"),
                purpose = purpose,
                periodId = json.nullableString("periodId"),
                resolution = json.nullableObject("resolution")?.let { PurposeResolution.fromJson(it) },
                status = FinancialExecutionFactStatus.fromWire(json.requiredString("status")),
                reason = json.nullableString("reason"),
                sourceToken = json.requiredString("sourceToken", allowBlank = true),
                splitRevision = json.nullableSafeLong("splitRevision"),
            )
        }
    }
}

data class FinancialExecutionDetailsResponse(
    val meta: FinancialMeta,
    val periodId: String,
    val revision: Long,
    val items: List<FinancialExecutionFact>,
    val total: Long,
    val limit: Int,
    val offset: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialExecutionDetailsResponse {
            val array = json.requiredArray("items")
            return FinancialExecutionDetailsResponse(
                meta = FinancialMeta.fromJson(json),
                periodId = json.requiredId("periodId"),
                revision = json.requiredSafeLong("revision"),
                items = List(array.length()) { index ->
                    FinancialExecutionFact.fromJson(array.requiredObjectAt(index, "items"))
                },
                total = json.requiredSafeLong("total"),
                limit = json.requiredInt("limit", 1, FinancialExecutionContract.MAX_PAGE_SIZE),
                offset = json.requiredInt("offset", 0, Int.MAX_VALUE),
            )
        }
    }
}

// ── Operation replay ─────────────────────────────────────────────────────────

data class FinancialOperationResult(
    val operationId: String,
    val method: String,
    val resource: String,
    val statusCode: Int,
    val response: JSONObject,
    val committedAt: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialOperationResult = FinancialOperationResult(
            operationId = json.requiredId("operationId"),
            method = json.requiredString("method"),
            resource = json.requiredString("resource"),
            statusCode = json.requiredInt("statusCode", 100, 599),
            response = json.requiredObject("response"),
            committedAt = json.requiredSafeLong("committedAt"),
        )
    }
}
