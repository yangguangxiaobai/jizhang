package com.yansuu1.jizhang.ui

import java.math.BigDecimal

internal const val MAX_MANUAL_GOAL_SAFE_CENTS = 9_007_199_254_740_991L // 2^53 - 1

private val DECIMAL_REGEX = Regex("""\d+(?:\.\d{1,2})?""")

/**
 * 生产唯一解析手动目标金额（元转分）。
 *
 * 规则：
 * - 输入经 trim 后必须为普通非负十进制数值，最多两位小数。
 * - 负号、指数、非数字、NaN、Infinity、超两位精度（如 1.230、1.234）一律抛出 [IllegalArgumentException]，不静默舍入。
 * - 使用 [BigDecimal] 精确乘 100 并校验 JS 安全整数范围（<= 9007199254740991L）。
 * - [allowZero] 为 false 时（新增/编辑存取），金额必须大于 0，0 抛出 [IllegalArgumentException]。
 * - [allowZero] 为 true 时（起始值确认），允许为 0。
 */
internal fun parseManualGoalYuanCents(text: String, allowZero: Boolean): Long {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) {
        throw IllegalArgumentException("金额不能为空")
    }
    if (!trimmed.matches(DECIMAL_REGEX)) {
        throw IllegalArgumentException("金额格式无效：只支持最多两位小数的非负数值")
    }
    val cents = try {
        BigDecimal(trimmed).movePointRight(2).longValueExact()
    } catch (_: ArithmeticException) {
        throw IllegalArgumentException("金额超出安全整数上限")
    }
    if (cents > MAX_MANUAL_GOAL_SAFE_CENTS) {
        throw IllegalArgumentException("金额超出安全整数上限")
    }
    if (cents < 0L) {
        throw IllegalArgumentException("金额不能为负数")
    }
    if (!allowZero && cents == 0L) {
        throw IllegalArgumentException("金额必须大于 0")
    }
    return cents
}
