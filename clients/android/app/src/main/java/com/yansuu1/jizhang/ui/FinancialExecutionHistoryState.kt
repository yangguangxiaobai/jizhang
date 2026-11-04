package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodSourceState
import com.yansuu1.jizhang.repo.FinancialSourceStatus
import com.yansuu1.jizhang.repo.FinancialWindow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 历史方案查看界面的显示模式
 */
enum class HistoryViewMode {
    PERIODS_LIST,
    REVISIONS_LIST,
    PERIOD_DETAIL,
}

/**
 * 纯状态分页辅助类
 */
data class HistoryPaginationState(
    val limit: Int = 20,
    val offset: Int = 0,
    val total: Long = 0L,
) {
    init {
        require(limit > 0) { "limit 必须大于 0" }
        require(offset >= 0) { "offset 不能为负数" }
        require(total >= 0) { "total 不能为负数" }
    }

    val currentPage: Int get() = if (limit > 0) (offset / limit) + 1 else 1
    val totalPages: Int get() = if (limit > 0 && total > 0) ((total + limit - 1) / limit).toInt() else 1
    val hasPrev: Boolean get() = offset > 0
    val hasNext: Boolean get() = (offset + limit) < total

    fun nextPage(): HistoryPaginationState = if (hasNext) copy(offset = offset + limit) else this
    fun prevPage(): HistoryPaginationState = if (hasPrev) copy(offset = maxOf(0, offset - limit)) else this

    fun summaryText(): String = "第 $currentPage / $totalPages 页 (共 $total 条记录)"
}

/**
 * 历史请求代次追踪器，防止迟到或切页后的响应污染 UI
 */
class HistoryWorkTracker {
    private var currentTicket: Long = 0L

    @Synchronized
    fun nextTicket(): Long {
        currentTicket++
        return currentTicket
    }

    @Synchronized
    fun isCurrent(ticket: Long): Boolean = ticket == currentTicket

    @Synchronized
    fun current(): Long = currentTicket

    @Synchronized
    fun cancel() {
        currentTicket++
    }
}

/**
 * 纯状态持有器：周期列表（支持重试保持既有条目、过滤陈旧响应）
 */
data class HistoryPeriodsState(
    val loading: Boolean = false,
    val error: String? = null,
    val requestedOffset: Int = 0,
    val items: List<FinancialPeriod> = emptyList(),
    val currentPeriodId: String? = null,
    val pagination: HistoryPaginationState = HistoryPaginationState(),
) {
    fun onStartLoading(offset: Int): HistoryPeriodsState = copy(
        loading = true,
        error = null,
        requestedOffset = offset,
    )

    fun onApplySuccess(
        requestTicket: Long,
        activeTicket: Long,
        newItems: List<FinancialPeriod>,
        newCurrentPeriodId: String?,
        newPagination: HistoryPaginationState,
    ): Pair<HistoryPeriodsState, Boolean> {
        if (requestTicket != activeTicket) return Pair(this, false)
        return Pair(
            copy(
                loading = false,
                error = null,
                items = newItems,
                currentPeriodId = newCurrentPeriodId,
                pagination = newPagination,
            ),
            true,
        )
    }

    fun onApplyError(
        requestTicket: Long,
        activeTicket: Long,
        errorMessage: String,
    ): Pair<HistoryPeriodsState, Boolean> {
        if (requestTicket != activeTicket) return Pair(this, false)
        return Pair(
            copy(
                loading = false,
                error = errorMessage,
            ),
            true,
        )
    }
}

/**
 * 纯状态持有器：版本修订列表
 */
data class HistoryRevisionsState(
    val periodId: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val requestedOffset: Int = 0,
    val items: List<FinancialPeriod> = emptyList(),
    val pagination: HistoryPaginationState = HistoryPaginationState(),
) {
    fun onStartLoading(targetPeriodId: String, offset: Int): HistoryRevisionsState = copy(
        periodId = targetPeriodId,
        loading = true,
        error = null,
        requestedOffset = offset,
        items = if (periodId == targetPeriodId) items else emptyList(),
    )

    fun onApplySuccess(
        requestTicket: Long,
        activeTicket: Long,
        newItems: List<FinancialPeriod>,
        newPagination: HistoryPaginationState,
    ): Pair<HistoryRevisionsState, Boolean> {
        if (requestTicket != activeTicket) return Pair(this, false)
        return Pair(
            copy(
                loading = false,
                error = null,
                items = newItems,
                pagination = newPagination,
            ),
            true,
        )
    }

    fun onApplyError(
        requestTicket: Long,
        activeTicket: Long,
        errorMessage: String,
    ): Pair<HistoryRevisionsState, Boolean> {
        if (requestTicket != activeTicket) return Pair(this, false)
        return Pair(
            copy(
                loading = false,
                error = errorMessage,
            ),
            true,
        )
    }
}

/**
 * 历史方案提示与文案格式化辅助
 */
object FinancialHistoryLabels {
    const val LEGACY_SCENARIO_NOTE = "说明：此处展示发薪入账后正式确认的四用途执行周期版本（不可篡改的历史快照）。若您此前在「测算预估」保存过方案，该方案仅保存单份最新手动试算输入（请前往「测算预估」标签页查看），未在此处生成已确认执行周期。"

    fun sourceStateDescription(state: FinancialPeriodSourceState): String = when (state) {
        FinancialPeriodSourceState.VALID -> "发薪源当前有效（与确认时事实一致）"
        FinancialPeriodSourceState.RECONCILIATION_REQUIRED -> "发薪源发生变动（当前事实已变更，历史快照保持冻结）"
        FinancialPeriodSourceState.EMPTY -> "无有效发薪源"
    }

    fun sourceStatusDescription(status: FinancialSourceStatus): String = when (status) {
        FinancialSourceStatus.VALID -> "有效"
        FinancialSourceStatus.CHANGED -> "已修改"
        FinancialSourceStatus.DELETED -> "已删除"
        FinancialSourceStatus.PURGED -> "已清除"
        FinancialSourceStatus.GROUP_CHANGED -> "归属周期变动"
    }

    fun formatBpsPercent(bps: Int): String {
        require(bps in 0..10000) { "bps 必须在 0 到 10000 之间" }
        val whole = bps / 100
        val fraction = bps % 100
        return when {
            fraction == 0 -> "$whole%"
            fraction % 10 == 0 -> "$whole.${fraction / 10}%"
            else -> "$whole.${fraction.toString().padStart(2, '0')}%"
        }
    }

    fun formatDateInZone(epochMs: Long, timeZoneId: String): String {
        if (epochMs <= 0) return "-"
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).apply {
            timeZone = TimeZone.getTimeZone(timeZoneId)
        }
        return sdf.format(Date(epochMs))
    }

    fun formatDateTimeInZone(epochMs: Long, timeZoneId: String): String {
        if (epochMs <= 0) return "-"
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).apply {
            timeZone = TimeZone.getTimeZone(timeZoneId)
        }
        return sdf.format(Date(epochMs))
    }

    fun formatWindowRange(window: FinancialWindow): String {
        val startStr = formatDateInZone(window.start, window.timeZone)
        val endStr = formatDateInZone(window.end, window.timeZone)
        return "$startStr 至 $endStr (含起不含止 · ${window.timeZone})"
    }
}
