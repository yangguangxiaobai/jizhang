package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.JsonNumberReaders
import org.json.JSONArray
import org.json.JSONObject

/**
 * C2 monthly-plan read model — `GET /api/v1/monthly-plan`.
 *
 * Contract rules enforced while decoding (parent design §3, child design §Interfaces):
 * - `state` is one of `ready` / `no-period` / `disabled`; an unknown state fails closed.
 * - Every amount/time/revision is an exact safe integer (|v| <= 2^53-1). A missing or
 *   malformed value throws; it is NEVER decoded as zero.
 * - `ready` must carry periodId, revision, window, confirmedIncomeCents, the four
 *   target amounts, summary and calculatedAt. `no-period`/`disabled` explicitly return
 *   null period/amount fields and empty facts, but still require calculatedAt.
 * - `summary.status == review-required` must not publish a precise remaining amount.
 *   A server value that violates this is dropped (kept in [MonthlyPlanSummary.discardedRemainingCents])
 *   so the UI can say so instead of showing a number that must not be trusted.
 * - Category rows are displayed verbatim. Android never re-aggregates them into totals
 *   and never derives per-purpose spending from them.
 * - The legacy envelope reference is display-only and is never added to the
 *   consumption budget (C2-07).
 */

object MonthlyPlanContract {
    const val MAX_SAFE_INTEGER = 9007199254740991L // 2^53 - 1
    const val PATH = "/api/v1/monthly-plan"
    const val MAX_CATEGORY_ROWS = 2000
    const val MAX_UNRESOLVED_REASONS = 100
}

// ── Strict JSON primitives (file-local; the FP models keep their own) ─────────

private fun missingField(keys: Array<out String>): Nothing =
    throw IllegalArgumentException("缺少字段：${keys.joinToString("/")}")

private fun JSONObject.presentAny(keys: Array<out String>): Pair<String, Any>? {
    for (key in keys) {
        if (has(key) && !isNull(key)) return key to get(key)
    }
    return null
}

private fun JSONObject.requiredAny(vararg keys: String): Any =
    presentAny(keys)?.second ?: missingField(keys)

private fun JSONObject.requiredText(vararg keys: String): String {
    val raw = requiredAny(*keys)
    require(raw is String) { "字段必须是字符串：${keys.first()}" }
    require(raw.isNotBlank()) { "字段不能为空白：${keys.first()}" }
    return raw
}

private fun JSONObject.nullableText(vararg keys: String): String? {
    require(keys.any { has(it) }) { "缺少字段：${keys.first()}" }
    val raw = presentAny(keys)?.second ?: return null
    require(raw is String) { "字段必须是字符串或 null：${keys.first()}" }
    require(raw.isNotBlank()) { "字段不能为空白：${keys.first()}" }
    return raw
}

private fun exactLong(raw: Any, key: String): Long = try {
    JsonNumberReaders.requireExactLong(raw, key)
} catch (e: IllegalArgumentException) {
    throw IllegalArgumentException("字段非精确整型或越界：$key", e)
}

private fun JSONObject.requiredLong(
    vararg keys: String,
    min: Long = 0L,
    max: Long = MonthlyPlanContract.MAX_SAFE_INTEGER,
): Long {
    val raw = requiredAny(*keys)
    val value = exactLong(raw, keys.first())
    require(value >= min) { "字段值低于下限：${keys.first()}" }
    require(value <= max) { "字段值超出上限：${keys.first()}" }
    return value
}

private fun JSONObject.nullableLong(
    vararg keys: String,
    min: Long = 0L,
    max: Long = MonthlyPlanContract.MAX_SAFE_INTEGER,
): Long? {
    require(keys.any { has(it) }) { "缺少字段：${keys.first()}" }
    val raw = presentAny(keys)?.second ?: return null
    val value = exactLong(raw, keys.first())
    require(value >= min) { "字段值低于下限：${keys.first()}" }
    require(value <= max) { "字段值超出上限：${keys.first()}" }
    return value
}

private fun JSONObject.requiredObject(vararg keys: String): JSONObject {
    val raw = requiredAny(*keys)
    require(raw is JSONObject) { "字段必须是对象：${keys.first()}" }
    return raw
}

private fun JSONObject.nullableObject(vararg keys: String): JSONObject? {
    require(keys.any { has(it) }) { "缺少字段：${keys.first()}" }
    val raw = presentAny(keys)?.second ?: return null
    require(raw is JSONObject) { "字段必须是对象或 null：${keys.first()}" }
    return raw
}

private fun JSONObject.optionalObject(vararg keys: String): JSONObject? {
    val raw = presentAny(keys)?.second ?: return null
    require(raw is JSONObject) { "字段必须是对象：${keys.first()}" }
    return raw
}

private fun JSONObject.optionalArray(vararg keys: String): JSONArray? {
    val raw = presentAny(keys)?.second ?: return null
    require(raw is JSONArray) { "字段必须是数组：${keys.first()}" }
    return raw
}

private fun JSONArray.requiredObjectAt(index: Int, label: String): JSONObject {
    val raw = get(index)
    require(raw is JSONObject) { "$label[$index] 必须是对象" }
    return raw
}

// ── Enums ────────────────────────────────────────────────────────────────────

enum class MonthlyPlanState(val wire: String) {
    READY("ready"),
    NO_PERIOD("no-period"),
    DISABLED("disabled"),
    ;

    companion object {
        fun fromWire(value: String): MonthlyPlanState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知月计划状态：$value")
    }
}

enum class MonthlyPlanSummaryStatus(val wire: String) {
    EXACT("exact"),
    REVIEW_REQUIRED("review-required"),
    ;

    companion object {
        fun fromWire(value: String): MonthlyPlanSummaryStatus =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知月计划汇总状态：$value")
    }
}

enum class MonthlyPlanCategoryPurpose(val wire: String) {
    ESSENTIALS("essentials"),
    JOY("joy"),
    UNRESOLVED("unresolved"),
    ;

    companion object {
        fun fromWire(value: String): MonthlyPlanCategoryPurpose =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("未知分类用途：$value")
    }
}

// ── Read model ───────────────────────────────────────────────────────────────

/** Frozen server window. `label` is the server's own range caption and is displayed verbatim. */
data class MonthlyPlanWindow(
    val from: Long,
    val to: Long,
    val timeZone: String,
    val label: String,
) {
    init {
        require(to > from) { "月计划区间结束必须晚于开始" }
        require(timeZone.isNotBlank()) { "月计划区间时区不能为空白" }
        require(label.isNotBlank()) { "月计划区间标签不能为空白" }
    }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanWindow = MonthlyPlanWindow(
            from = json.requiredLong("from"),
            to = json.requiredLong("to"),
            timeZone = json.requiredText("timeZone"),
            label = json.requiredText("label"),
        )
    }
}

/** The four frozen allocation targets. Growth/reserve stay references, never transfers. */
data class MonthlyPlanTargets(
    val growth: Long,
    val reserve: Long,
    val essentials: Long,
    val joy: Long,
) {
    init {
        require(growth >= 0 && reserve >= 0 && essentials >= 0 && joy >= 0) { "用途目标金额不能为负数" }
    }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanTargets = MonthlyPlanTargets(
            growth = json.requiredLong("growth"),
            reserve = json.requiredLong("reserve"),
            essentials = json.requiredLong("essentials"),
            joy = json.requiredLong("joy"),
        )
    }
}

/**
 * Server-computed summary. Android never recomputes these numbers.
 *
 * [discardedRemainingCents] is only set when the server sent a precise remaining while
 * the status said `review-required`; the value is hidden from the UI and reported.
 */
data class MonthlyPlanSummary(
    val consumptionBudgetCents: Long,
    val confirmedNetSpentCents: Long,
    val remainingCents: Long?,
    val status: MonthlyPlanSummaryStatus,
    val discardedRemainingCents: Long? = null,
) {
    init {
        require(consumptionBudgetCents >= 0) { "消费预算不能为负数" }
        require(confirmedNetSpentCents >= 0) { "已确认消费不能为负数" }
        require(remainingCents == null || remainingCents >= -MonthlyPlanContract.MAX_SAFE_INTEGER) {
            "预算剩余超出安全整数范围"
        }
        when (status) {
            MonthlyPlanSummaryStatus.EXACT -> require(remainingCents != null) {
                "exact 状态必须包含预算剩余"
            }
            MonthlyPlanSummaryStatus.REVIEW_REQUIRED -> require(remainingCents == null) {
                "review-required 状态不得发布精确预算剩余"
            }
        }
    }

    val isExact: Boolean get() = status == MonthlyPlanSummaryStatus.EXACT

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanSummary {
            val status = MonthlyPlanSummaryStatus.fromWire(json.requiredText("status"))
            val rawRemaining = json.nullableLong(
                "remainingCents",
                min = -MonthlyPlanContract.MAX_SAFE_INTEGER,
            )
            val usableRemaining = if (status == MonthlyPlanSummaryStatus.EXACT) rawRemaining else null
            return MonthlyPlanSummary(
                consumptionBudgetCents = json.requiredLong("consumptionBudgetCents"),
                confirmedNetSpentCents = json.requiredLong("confirmedNetSpentCents"),
                remainingCents = usableRemaining,
                status = status,
                discardedRemainingCents = if (status == MonthlyPlanSummaryStatus.EXACT) null else rawRemaining,
            )
        }
    }
}

/** Server-computed purpose totals; Android renders them and never sums category rows. */
data class MonthlyPlanPurposeRow(
    val purpose: SpendingPurpose,
    val budgetCents: Long,
    val grossCents: Long,
    val refundCents: Long,
    val netCents: Long,
    val remainingCents: Long?,
    val overspendCents: Long?,
) {
    init {
        require(budgetCents >= 0 && grossCents >= 0 && refundCents >= 0 && netCents >= 0) {
            "用途汇总金额不能为负数"
        }
        require(netCents == grossCents - refundCents) { "用途净额必须等于毛额减退款" }
    }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanPurposeRow {
            val remaining = json.nullableLong("remainingCents", min = -MonthlyPlanContract.MAX_SAFE_INTEGER)
            val overspend = json.nullableLong("overspendCents")
            return MonthlyPlanPurposeRow(
                purpose = SpendingPurpose.fromWire(json.requiredText("purpose")),
                budgetCents = json.requiredLong("budgetCents"),
                grossCents = json.requiredLong("grossCents"),
                refundCents = json.requiredLong("refundCents"),
                netCents = json.requiredLong("netCents"),
                remainingCents = remaining,
                overspendCents = overspend,
            )
        }
    }
}

/**
 * One category row. Refunds keep the original expense category/purpose, so a
 * 100 expense with a 30 attributed refund arrives as gross=10000/refund=3000/net=7000.
 * Unresolved facts may have no category id/name; preserve that explicitly.
 */
data class MonthlyPlanCategoryRow(
    val categoryId: String?,
    val categoryName: String?,
    val purpose: MonthlyPlanCategoryPurpose,
    val grossCents: Long,
    val refundCents: Long,
    val netCents: Long,
) {
    init {
        require(categoryId == null || (categoryId.isNotBlank() && categoryId.length <= 128)) { "categoryId 无效" }
        require(categoryName == null || categoryName.isNotBlank()) { "分类名称不能为空白" }
        require(grossCents >= 0) { "分类毛额不能为负数" }
        require(refundCents >= 0) { "分类退款不能为负数" }
        require(netCents == grossCents - refundCents) { "分类净额必须等于毛额减退款（服务端金额不一致）" }
    }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanCategoryRow {
            val gross = json.requiredLong("grossCents")
            val refund = json.requiredLong("refundCents")
            return MonthlyPlanCategoryRow(
                categoryId = json.nullableText("categoryId"),
                categoryName = json.nullableText("categoryName"),
                purpose = MonthlyPlanCategoryPurpose.fromWire(json.requiredText("purpose")),
                grossCents = gross,
                refundCents = refund,
                netCents = json.requiredLong(
                    "netCents",
                    min = -MonthlyPlanContract.MAX_SAFE_INTEGER,
                ),
            )
        }
    }
}

/** Server's direct unresolved counters; absent/malformed values never become zeros. */
data class MonthlyPlanUnresolved(
    val reasons: List<String>,
    val count: Long,
    val expenseCount: Long,
    val grossCents: Long,
    val attributedRefundCents: Long,
    val netCents: Long,
    val linkedRefundCount: Long,
    val linkedRefundUnresolvedCents: Long,
    val globalUnassignedRefundCount: Long,
    val globalUnassignedRefundCents: Long,
) {
    val isEmpty: Boolean
        get() = reasons.isEmpty() && count == 0L && expenseCount == 0L && grossCents == 0L &&
            attributedRefundCents == 0L && netCents == 0L && linkedRefundCount == 0L &&
            linkedRefundUnresolvedCents == 0L && globalUnassignedRefundCount == 0L &&
            globalUnassignedRefundCents == 0L

    fun countOf(vararg keys: String): Long? = keys.firstNotNullOfOrNull { key ->
        when (key) {
            "count" -> count
            "expenseCount" -> expenseCount
            "grossCents" -> grossCents
            "attributedRefundCents", "refundCents" -> attributedRefundCents
            "netCents" -> netCents
            "linkedRefundCount" -> linkedRefundCount
            "linkedRefundUnresolvedCents" -> linkedRefundUnresolvedCents
            "globalUnassignedRefundCount" -> globalUnassignedRefundCount
            "globalUnassignedRefundCents" -> globalUnassignedRefundCents
            else -> null
        }
    }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanUnresolved {
            val reasonsArray = json.optionalArray("reasons") ?: missingField(arrayOf("reasons"))
            require(reasonsArray.length() <= MonthlyPlanContract.MAX_UNRESOLVED_REASONS) {
                "待核对原因不能超过 ${MonthlyPlanContract.MAX_UNRESOLVED_REASONS} 条"
            }
            val reasons = List(reasonsArray.length()) { index ->
                val raw = reasonsArray.get(index)
                require(raw is String) { "reasons[$index] 必须是字符串" }
                require(raw.isNotBlank()) { "reasons[$index] 不能为空白" }
                raw
            }
            return MonthlyPlanUnresolved(
                reasons = reasons,
                count = json.requiredLong("count"),
                expenseCount = json.requiredLong("expenseCount"),
                grossCents = json.requiredLong("grossCents"),
                attributedRefundCents = json.requiredLong("attributedRefundCents"),
                netCents = json.requiredLong("netCents", min = -MonthlyPlanContract.MAX_SAFE_INTEGER),
                linkedRefundCount = json.requiredLong("linkedRefundCount"),
                linkedRefundUnresolvedCents = json.requiredLong("linkedRefundUnresolvedCents"),
                globalUnassignedRefundCount = json.requiredLong("globalUnassignedRefundCount"),
                globalUnassignedRefundCents = json.requiredLong("globalUnassignedRefundCents"),
            )
        }
    }
}

/** Legacy gross-envelope breakdown, shown only as an explicit comparison reference. */
data class MonthlyPlanMappedBudget(
    val essentials: Long,
    val joy: Long,
    val unresolved: Long,
)

data class MonthlyPlanLegacyWindow(val start: Long, val end: Long?) {
    init { require(end == null || end > start) { "旧信封时间区间上界必须晚于起点" } }

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanLegacyWindow = MonthlyPlanLegacyWindow(
            start = json.requiredLong("start"),
            end = json.nullableLong("end"),
        )
    }
}

/**
 * The server's legacy envelope reference. It is display-only and never added to the
 * consumption budget; the complete mapped/period comparison remains available.
 */
data class MonthlyPlanLegacyEnvelope(
    val mode: String,
    val contract: String,
    val totalBudgetCents: Long,
    val mappedBudgetCents: MonthlyPlanMappedBudget,
    val purposeSpendingCeilingCents: Long,
    val differenceCents: Long,
    val legacyWindow: MonthlyPlanLegacyWindow?,
    val windowMatches: Boolean,
    val validatedNestedAllocation: Boolean,
) {
    init {
        require(mode == "legacy-reference") { "旧信封参考 mode 无效" }
        require(contract == "legacy-gross") { "旧信封参考 contract 无效" }
        require(!validatedNestedAllocation) { "旧信封嵌套分配不能标记为已验证" }
    }

    val hasAnyAmount: Boolean get() = true

    companion object {
        fun fromJson(json: JSONObject): MonthlyPlanLegacyEnvelope {
            val validated = json.requiredAny("validatedNestedAllocation")
            require(validated is Boolean) { "validatedNestedAllocation 必须是布尔值" }
            val window = json.nullableObject("legacyWindow")?.let(MonthlyPlanLegacyWindow::fromJson)
            val mapped = json.requiredObject("mappedBudgetCents")
            return MonthlyPlanLegacyEnvelope(
                mode = json.requiredText("mode"),
                contract = json.requiredText("contract"),
                totalBudgetCents = json.requiredLong("totalBudgetCents"),
                mappedBudgetCents = MonthlyPlanMappedBudget(
                    essentials = mapped.requiredLong("essentials"),
                    joy = mapped.requiredLong("joy"),
                    unresolved = mapped.requiredLong("unresolved"),
                ),
                purposeSpendingCeilingCents = json.requiredLong("purposeSpendingCeilingCents"),
                differenceCents = json.requiredLong("differenceCents", min = -MonthlyPlanContract.MAX_SAFE_INTEGER),
                legacyWindow = window,
                windowMatches = json.requiredAny("windowMatches") as? Boolean
                    ?: throw IllegalArgumentException("windowMatches 必须是布尔值"),
                validatedNestedAllocation = validated,
            )
        }
    }
}

/**
 * The whole monthly-plan view. Amount fields are null unless [state] is [MonthlyPlanState.READY],
 * which is exactly how "no current period" avoids being rendered as a zero plan.
 */
data class MonthlyPlanView(
    val state: MonthlyPlanState,
    val periodId: String?,
    val revision: Long?,
    val window: MonthlyPlanWindow?,
    val confirmedIncomeCents: Long?,
    val targets: MonthlyPlanTargets?,
    val summary: MonthlyPlanSummary?,
    val purposes: List<MonthlyPlanPurposeRow>,
    val categories: List<MonthlyPlanCategoryRow>,
    val unresolved: MonthlyPlanUnresolved,
    val calculatedAt: Long?,
    val legacyEnvelope: MonthlyPlanLegacyEnvelope?,
) {
    init {
        require(calculatedAt != null) { "月计划必须包含读取时间" }
        when (state) {
            MonthlyPlanState.READY -> {
                require(periodId != null) { "ready 状态必须包含 periodId" }
                require(revision != null) { "ready 状态必须包含 revision" }
                require(window != null) { "ready 状态必须包含冻结区间" }
                require(confirmedIncomeCents != null) { "ready 状态必须包含确认收入" }
                require(targets != null) { "ready 状态必须包含四项用途目标" }
                require(summary != null) { "ready 状态必须包含汇总" }
                require(purposes.map { it.purpose } == listOf(SpendingPurpose.ESSENTIALS, SpendingPurpose.JOY)) {
                    "ready 状态必须包含按序排列的必要/随心服务端汇总"
                }
                val exact = requireNotNull(summary)
                if (exact.status == MonthlyPlanSummaryStatus.EXACT) {
                    require(purposes.all { it.remainingCents != null && it.overspendCents != null }) {
                        "exact 状态的用途行必须包含剩余与超支"
                    }
                } else {
                    require(purposes.all { it.remainingCents == null && it.overspendCents == null }) {
                        "review-required 状态的用途行不能发布精确剩余"
                    }
                }
                require(legacyEnvelope != null) { "ready 状态必须包含旧信封参考对象" }
            }
            MonthlyPlanState.NO_PERIOD, MonthlyPlanState.DISABLED -> {
                require(periodId == null && revision == null && window == null) {
                    "非 ready 状态不能携带周期、版本或区间"
                }
                require(confirmedIncomeCents == null && targets == null && summary == null) {
                    "非 ready 状态不能携带金额，避免被当成 0 计划"
                }
                require(purposes.isEmpty() && categories.isEmpty()) {
                    "非 ready 状态不能携带用途或分类事实"
                }
            }
        }
    }

    val isReady: Boolean get() = state == MonthlyPlanState.READY

    companion object {
        /** Decodes the exact endpoint body; alternate wrappers/field aliases are not its contract. */
        fun fromJson(body: JSONObject): MonthlyPlanView {
            val state = MonthlyPlanState.fromWire(body.requiredText("state"))
            val calculatedAt = body.requiredLong("calculatedAt")

            val categoriesArray = body.optionalArray("categories") ?: missingField(arrayOf("categories"))
            require(categoriesArray.length() <= MonthlyPlanContract.MAX_CATEGORY_ROWS) {
                "分类消费行不能超过 ${MonthlyPlanContract.MAX_CATEGORY_ROWS} 条"
            }
            val categories = List(categoriesArray.length()) { index ->
                MonthlyPlanCategoryRow.fromJson(categoriesArray.requiredObjectAt(index, "categories"))
            }

            val purposesArray = body.optionalArray("purposes") ?: missingField(arrayOf("purposes"))
            require(purposesArray.length() <= 2) { "月计划 purposes 不得超过必要/随心两项" }
            val purposes = List(purposesArray.length()) { index ->
                MonthlyPlanPurposeRow.fromJson(purposesArray.requiredObjectAt(index, "purposes"))
            }

            val unresolvedObject = body.optionalObject("unresolved") ?: missingField(arrayOf("unresolved"))
            val unresolved = MonthlyPlanUnresolved.fromJson(unresolvedObject)

            val legacyEnvelopeObject = body.nullableObject("legacyEnvelopeReference")
            val legacyEnvelope = legacyEnvelopeObject?.let(MonthlyPlanLegacyEnvelope::fromJson)

            if (state != MonthlyPlanState.READY) {
                for (key in listOf("periodId", "revision", "window", "confirmedIncomeCents", "targetsCents", "summary")) {
                    require(body.has(key) && body.get(key) === JSONObject.NULL) {
                        "非 ready 状态必须明确返回 null：$key"
                    }
                }
                require(purposes.isEmpty() && categories.isEmpty() && unresolved.isEmpty && legacyEnvelope == null) {
                    "非 ready 状态不能携带用途、分类、待核对事实或旧信封金额"
                }
                return MonthlyPlanView(
                    state = state,
                    periodId = null,
                    revision = null,
                    window = null,
                    confirmedIncomeCents = null,
                    targets = null,
                    summary = null,
                    purposes = emptyList(),
                    categories = emptyList(),
                    unresolved = unresolved,
                    calculatedAt = calculatedAt,
                    legacyEnvelope = legacyEnvelope,
                )
            }

            return MonthlyPlanView(
                state = state,
                periodId = body.requiredText("periodId"),
                revision = body.requiredLong("revision"),
                window = MonthlyPlanWindow.fromJson(body.requiredObject("window")),
                confirmedIncomeCents = body.requiredLong("confirmedIncomeCents"),
                targets = MonthlyPlanTargets.fromJson(body.requiredObject("targetsCents")),
                summary = MonthlyPlanSummary.fromJson(body.requiredObject("summary")),
                purposes = purposes,
                categories = categories,
                unresolved = unresolved,
                calculatedAt = calculatedAt,
                legacyEnvelope = legacyEnvelope,
            )
        }

    }
}
