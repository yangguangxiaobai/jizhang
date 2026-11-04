package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialPlanAnalysis
import com.yansuu1.jizhang.repo.FinancialPlanInputs
import com.yansuu1.jizhang.repo.FinancialPlanSaveRequest
import com.yansuu1.jizhang.repo.SavedFinancialPlan
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Strict BigDecimal money parser and draft/state models for the Four-Purpose Financial Plan.
 * Conforms to contract.md rules:
 * - Strict decimal with at most 2 places.
 * - Positive income and essential costs, nonnegative emergency reserve balance.
 * - Exact cents <= JS safe integer max.
 * - No native financial calculation: analysis renders server-computed results.
 */
object FinancialPlanMoneyParser {
    private val DECIMAL_REGEX = Regex("^[0-9]+(\\.[0-9]{1,2})?$")
    const val MAX_SAFE_INTEGER_CENTS = 9007199254740991L

    fun parseYuanToCents(text: String, allowZero: Boolean, fieldName: String): Long {
        val trimmed = text.trim()
        require(trimmed.isNotEmpty()) { "请填写${fieldName}" }
        require(DECIMAL_REGEX.matches(trimmed)) {
            "${fieldName}格式不正确，最多支持两位小数的正数"
        }
        val bd = try {
            BigDecimal(trimmed)
        } catch (_: Exception) {
            throw IllegalArgumentException("${fieldName}格式不正确")
        }
        val cents = try {
            bd.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact()
        } catch (_: Exception) {
            throw IllegalArgumentException("${fieldName}数值超出范围")
        }
        if (allowZero) {
            require(cents >= 0L) { "${fieldName}不能为负数" }
        } else {
            require(cents > 0L) { "${fieldName}必须大于0" }
        }
        require(cents <= MAX_SAFE_INTEGER_CENTS) { "${fieldName}数值超出安全上限" }
        return cents
    }

    fun formatCentsToYuan(cents: Long): String {
        val sign = if (cents < 0) "-" else ""
        val abs = kotlin.math.abs(cents)
        return "$sign${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
    }
}

data class FinancialPlanDraft(
    val monthlyIncomeText: String = "",
    val essentialMonthlyText: String = "",
    val reserveBalanceText: String = "",
) {
    fun isBlank(): Boolean =
        monthlyIncomeText.isBlank() && essentialMonthlyText.isBlank() && reserveBalanceText.isBlank()

    fun validate(): Result<FinancialPlanInputs> = runCatching {
        val income = FinancialPlanMoneyParser.parseYuanToCents(monthlyIncomeText, allowZero = false, "税后月收入")
        val essential = FinancialPlanMoneyParser.parseYuanToCents(essentialMonthlyText, allowZero = false, "每月必要开支")
        val reserve = FinancialPlanMoneyParser.parseYuanToCents(reserveBalanceText, allowZero = true, "现有应急储备金")
        FinancialPlanInputs(
            monthlyIncomeCents = income,
            essentialMonthlyCents = essential,
            reserveBalanceCents = reserve,
        )
    }

    fun matchesInputs(inputs: FinancialPlanInputs): Boolean {
        val parsed = validate().getOrNull() ?: return false
        return parsed == inputs
    }

    companion object {
        fun fromInputs(inputs: FinancialPlanInputs): FinancialPlanDraft = FinancialPlanDraft(
            monthlyIncomeText = FinancialPlanMoneyParser.formatCentsToYuan(inputs.monthlyIncomeCents),
            essentialMonthlyText = FinancialPlanMoneyParser.formatCentsToYuan(inputs.essentialMonthlyCents),
            reserveBalanceText = FinancialPlanMoneyParser.formatCentsToYuan(inputs.reserveBalanceCents),
        )
    }
}

/**
 * Educational contextual prompt definition for deterministic in-page guidance.
 */
data class EducationalPrompt(
    val id: String,
    val title: String,
    val body: String,
)

object FinancialPlanPrompts {
    val ALL: List<EducationalPrompt> = listOf(
        EducationalPrompt(
            id = "cushion",
            title = "1个月缓冲垫优先级",
            body = "在积累完整5个月储备前，建议起步阶段优先确保至少有1个月必要支出的现金防线，以防范突发短期账单。",
        ),
        EducationalPrompt(
            id = "debt",
            title = "高息负债与现金需求评估",
            body = "可优先评估高息负债与现金需求，勿把不确定收益当还债来源。若存在高息借款，优先梳理利息成本与现金流压力。",
        ),
        EducationalPrompt(
            id = "liquidity",
            title = "24小时流动性与本金安全",
            body = "优先了解存款保障与24小时可取性。非保本类现金管理工具可能存在赎回延迟或净值波动风险，切勿将应急防线投入有锁定期或亏损可能性的产品。",
        ),
        EducationalPrompt(
            id = "variable_income",
            title = "收入波动与缓冲考量",
            body = "若收入不固定（自由职业、绩效或提成波动），建议在5个月基础上适度提高应急储备月数，以平滑淡季现金流。",
        ),
        EducationalPrompt(
            id = "cooling",
            title = "7天冷静期原则",
            body = "面对非生活必需的大额愿望享受消费，建议设定7天冷静期待定，避免因冲动消费挤占应急防线与长期投资资金。",
        ),
        EducationalPrompt(
            id = "refill",
            title = "储备动用后优先回补",
            body = "若因紧急情况动用了备用金，应暂时缓和愿望消费与增值扩张，优先将储备金回补至5个月必要开销的安全目标线。",
        ),
        EducationalPrompt(
            id = "goal_met",
            title = "目标达成后未来资金建议",
            body = "达到5个月储备防线后，已积累的储备资金请继续专款隔离；未来每月15%资金可由您自由决定是否转向稳健投资或其他目标（本系统保持固定比例，不执行任何自动调整）。",
        ),
    )
}
