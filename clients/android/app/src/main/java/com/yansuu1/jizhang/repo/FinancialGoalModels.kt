package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.JsonNumberReaders
import org.json.JSONArray
import org.json.JSONObject

/**
 * C4: 手动存钱与投资进度 (F08/F09) 严格数据模型。
 *
 * 核心契约：
 * 1. source 恒为 "manual-confirmed"，明确标识为用户手动确认记录，绝非银行自动核验。
 * 2. 金额严格为整数分 (|v| <= 2^53 - 1)，时间严格为 epoch 毫秒，绝不在客户端使用浮点数或将缺失值静默回退为 0。
 * 3. 投资目标仅跟踪本金 (targetState: not-applicable)，无虚构收益或假设增长率。
 * 4. 历史区间在起始日前时 targetState 为 not-started，balanceCents 为 null。
 */

enum class ManualGoal(val wireValue: String) {
    RESERVE("reserve"),
    INVESTMENT("investment");

    companion object {
        fun fromWire(value: String): ManualGoal =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("未知目标类型: $value")
    }
}

enum class ManualGoalEntryKind(val wireValue: String) {
    DEPOSIT("deposit"),
    WITHDRAWAL("withdrawal");

    companion object {
        fun fromWire(value: String): ManualGoalEntryKind =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("未知记录方向: $value")
    }
}

enum class ManualGoalTargetState(val wireValue: String) {
    READY("ready"),
    NO_BASELINE("no-baseline"),
    NOT_APPLICABLE("not-applicable"),
    NOT_STARTED("not-started");

    companion object {
        fun fromWire(value: String): ManualGoalTargetState =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("未知目标计算状态: $value")
    }
}

data class FinancialGoalOpeningView(
    val goal: ManualGoal,
    val openingCents: Long,
    val openingAt: Long,
    val revision: Long,
    val updatedAt: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalOpeningView = FinancialGoalOpeningView(
            goal = ManualGoal.fromWire(json.getString("goal")),
            openingCents = JsonNumberReaders.requireExactLong(json.opt("openingCents"), "openingCents"),
            openingAt = JsonNumberReaders.requireExactLong(json.opt("openingAt"), "openingAt"),
            revision = JsonNumberReaders.requireExactLong(json.opt("revision"), "revision"),
            updatedAt = JsonNumberReaders.requireExactLong(json.opt("updatedAt"), "updatedAt"),
        )
    }
}

data class FinancialGoalProgressView(
    val source: String,
    val openingCents: Long,
    val openingAt: Long,
    val depositCents: Long,
    val withdrawalCents: Long,
    val balanceCents: Long?,
    val targetState: ManualGoalTargetState,
    val targetCents: Long?,
    val progressBasisPoints: Int?,
    val progressPercent: Int?,
    val gapCents: Long?,
    val surplusCents: Long?,
    val conditionalContributionCount: Int?,
    val essentialMonthlyCents: Long?,
    val targetMonths: Int?,
    val monthlyReferenceCents: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalProgressView {
            val source = json.getString("source")
            require(source == "manual-confirmed") { "source 必须为 manual-confirmed" }
            val targetState = ManualGoalTargetState.fromWire(json.getString("targetState"))
            val balanceCents = if (json.isNull("balanceCents")) null else JsonNumberReaders.requireExactLong(json.opt("balanceCents"), "balanceCents")

            return FinancialGoalProgressView(
                source = source,
                openingCents = JsonNumberReaders.requireExactLong(json.opt("openingCents"), "openingCents"),
                openingAt = JsonNumberReaders.requireExactLong(json.opt("openingAt"), "openingAt"),
                depositCents = JsonNumberReaders.requireExactLong(json.opt("depositCents"), "depositCents"),
                withdrawalCents = JsonNumberReaders.requireExactLong(json.opt("withdrawalCents"), "withdrawalCents"),
                balanceCents = balanceCents,
                targetState = targetState,
                targetCents = if (json.isNull("targetCents")) null else JsonNumberReaders.requireExactLong(json.opt("targetCents"), "targetCents"),
                progressBasisPoints = if (json.isNull("progressBasisPoints")) null else JsonNumberReaders.requireExactInt(json.opt("progressBasisPoints"), "progressBasisPoints"),
                progressPercent = if (json.isNull("progressPercent")) null else JsonNumberReaders.requireExactInt(json.opt("progressPercent"), "progressPercent"),
                gapCents = if (json.isNull("gapCents")) null else JsonNumberReaders.requireExactLong(json.opt("gapCents"), "gapCents"),
                surplusCents = if (json.isNull("surplusCents")) null else JsonNumberReaders.requireExactLong(json.opt("surplusCents"), "surplusCents"),
                conditionalContributionCount = if (json.isNull("conditionalContributionCount")) null else JsonNumberReaders.requireExactInt(json.opt("conditionalContributionCount"), "conditionalContributionCount"),
                essentialMonthlyCents = if (json.isNull("essentialMonthlyCents")) null else JsonNumberReaders.requireExactLong(json.opt("essentialMonthlyCents"), "essentialMonthlyCents"),
                targetMonths = if (json.isNull("targetMonths")) null else JsonNumberReaders.requireExactInt(json.opt("targetMonths"), "targetMonths"),
                monthlyReferenceCents = if (json.isNull("monthlyReferenceCents")) null else JsonNumberReaders.requireExactLong(json.opt("monthlyReferenceCents"), "monthlyReferenceCents"),
            )
        }
    }
}

data class FinancialGoalWindowSlice(
    val depositCents: Long,
    val withdrawalCents: Long,
    val netAdditionsCents: Long,
    val entryCount: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalWindowSlice = FinancialGoalWindowSlice(
            depositCents = JsonNumberReaders.requireExactLong(json.opt("depositCents"), "depositCents"),
            withdrawalCents = JsonNumberReaders.requireExactLong(json.opt("withdrawalCents"), "withdrawalCents"),
            netAdditionsCents = JsonNumberReaders.requireExactLong(json.opt("netAdditionsCents"), "netAdditionsCents"),
            entryCount = JsonNumberReaders.requireExactInt(json.opt("entryCount"), "entryCount"),
        )
    }
}

data class FinancialGoalWindowView(
    val from: Long,
    val to: Long,
    val entryCount: Int,
    val reserve: FinancialGoalWindowSlice,
    val investment: FinancialGoalWindowSlice,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalWindowView = FinancialGoalWindowView(
            from = JsonNumberReaders.requireExactLong(json.opt("from"), "from"),
            to = JsonNumberReaders.requireExactLong(json.opt("to"), "to"),
            entryCount = JsonNumberReaders.requireExactInt(json.opt("entryCount"), "entryCount"),
            reserve = FinancialGoalWindowSlice.fromJson(json.getJSONObject("reserve")),
            investment = FinancialGoalWindowSlice.fromJson(json.getJSONObject("investment")),
        )
    }
}

data class FinancialGoalEntryDto(
    val id: String,
    val goal: ManualGoal,
    val kind: ManualGoalEntryKind,
    val amountCents: Long,
    val date: Long,
    val note: String,
    val revision: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalEntryDto = FinancialGoalEntryDto(
            id = json.getString("id"),
            goal = ManualGoal.fromWire(json.getString("goal")),
            kind = ManualGoalEntryKind.fromWire(json.getString("kind")),
            amountCents = JsonNumberReaders.requireExactLong(json.opt("amountCents"), "amountCents"),
            date = JsonNumberReaders.requireExactLong(json.opt("date"), "date"),
            note = json.optString("note", ""),
            revision = JsonNumberReaders.requireExactLong(json.opt("revision"), "revision"),
            createdAt = JsonNumberReaders.requireExactLong(json.opt("createdAt"), "createdAt"),
            updatedAt = JsonNumberReaders.requireExactLong(json.opt("updatedAt"), "updatedAt"),
            deletedAt = if (json.isNull("deletedAt")) null else JsonNumberReaders.requireExactLong(json.opt("deletedAt"), "deletedAt"),
        )
    }
}

data class FinancialGoalView(
    val contractVersion: Int,
    val calculatedAt: Long,
    val source: String,
    val revision: Long,
    val state: String,
    val reserveOpening: FinancialGoalOpeningView?,
    val investmentOpening: FinancialGoalOpeningView?,
    val asOf: Long,
    val reserveProgress: FinancialGoalProgressView?,
    val investmentProgress: FinancialGoalProgressView?,
    val window: FinancialGoalWindowView?,
    val entry: FinancialGoalEntryDto? = null,
) {
    val isConfigured: Boolean get() = state == "ready"

    companion object {
        fun fromJson(json: JSONObject): FinancialGoalView {
            val contractVersion = JsonNumberReaders.requireExactInt(json.opt("contractVersion"), "contractVersion")
            require(contractVersion == 1) { "不支持的契约版本: $contractVersion" }
            val source = json.getString("source")
            require(source == "manual-confirmed") { "source 必须为 manual-confirmed" }

            val openingObj = json.optJSONObject("opening")
            val reserveOpening = openingObj?.optJSONObject("reserve")?.let { FinancialGoalOpeningView.fromJson(it) }
            val investmentOpening = openingObj?.optJSONObject("investment")?.let { FinancialGoalOpeningView.fromJson(it) }

            val progressObj = json.getJSONObject("progress")
            val asOf = JsonNumberReaders.requireExactLong(progressObj.opt("asOf"), "asOf")
            val reserveProgress = progressObj.optJSONObject("reserve")?.let { FinancialGoalProgressView.fromJson(it) }
            val investmentProgress = progressObj.optJSONObject("investment")?.let { FinancialGoalProgressView.fromJson(it) }

            val window = json.optJSONObject("window")?.let { FinancialGoalWindowView.fromJson(it) }
            val entry = json.optJSONObject("entry")?.let { FinancialGoalEntryDto.fromJson(it) }

            return FinancialGoalView(
                contractVersion = contractVersion,
                calculatedAt = JsonNumberReaders.requireExactLong(json.opt("calculatedAt"), "calculatedAt"),
                source = source,
                revision = JsonNumberReaders.requireExactLong(json.opt("revision"), "revision"),
                state = json.getString("state"),
                reserveOpening = reserveOpening,
                investmentOpening = investmentOpening,
                asOf = asOf,
                reserveProgress = reserveProgress,
                investmentProgress = investmentProgress,
                window = window,
                entry = entry,
            )
        }
    }
}

data class FinancialGoalEntryPageView(
    val contractVersion: Int,
    val calculatedAt: Long,
    val source: String,
    val revision: Long,
    val items: List<FinancialGoalEntryDto>,
    val total: Int,
    val limit: Int,
    val hasMore: Boolean,
    val nextCursor: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): FinancialGoalEntryPageView {
            val itemsArray = json.getJSONArray("items")
            val items = (0 until itemsArray.length()).map {
                FinancialGoalEntryDto.fromJson(itemsArray.getJSONObject(it))
            }
            return FinancialGoalEntryPageView(
                contractVersion = JsonNumberReaders.requireExactInt(json.opt("contractVersion"), "contractVersion"),
                calculatedAt = JsonNumberReaders.requireExactLong(json.opt("calculatedAt"), "calculatedAt"),
                source = json.getString("source"),
                revision = JsonNumberReaders.requireExactLong(json.opt("revision"), "revision"),
                items = items,
                total = JsonNumberReaders.requireExactInt(json.opt("total"), "total"),
                limit = JsonNumberReaders.requireExactInt(json.opt("limit"), "limit"),
                hasMore = json.getBoolean("hasMore"),
                nextCursor = if (json.isNull("nextCursor")) null else json.getString("nextCursor"),
            )
        }
    }
}
