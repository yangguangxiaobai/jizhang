package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.FinancialGoalWindowView

/**
 * 手动目标进度关联的冻结周期或统计窗口上下文。
 * 用于公开 Composable 参数，故类型声明为 public。
 */
data class ManualGoalWindowContext(
    val from: Long,
    val to: Long,
    val label: String,
    val timeZone: String,
) {
    init {
        require(from >= 0L) { "from 必须为非负时间戳" }
        require(to > from) { "to 必须大于 from" }
        require(label.isNotBlank()) { "label 不能为空" }
        require(timeZone.isNotBlank()) { "timeZone 不能为空" }
    }
}

/**
 * 严格校验服务端回显的窗口范围与数据来源契约。
 * 杜绝将不同 query 或历史旧数据冒充为当前所查窗口的统计数据。
 */
internal fun requireManualGoalWindow(
    view: FinancialGoalView,
    expected: ManualGoalWindowContext,
): FinancialGoalWindowView {
    require(view.source == "manual-confirmed") {
        "数据来源无效，预期 manual-confirmed，实际为: ${view.source}"
    }
    val window = view.window ?: throw IllegalStateException("服务端未返回期间目标统计数据")
    require(window.from == expected.from && window.to == expected.to) {
        "服务端回显统计区间 [${window.from}, ${window.to}) 与预期 [${expected.from}, ${expected.to}) 不匹配"
    }
    return window
}
