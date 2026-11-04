package com.yansuu1.jizhang.ui

import org.json.JSONObject

/**
 * Initial draft for "record a refund of this expense".
 *
 * The refund itself is a brand-new `type=1 / isRefund=true` income that links
 * the original expense; the original transaction is never modified. The amount
 * is deliberately empty: the original total is not the refundable remainder,
 * and nothing here guesses how much was already refunded.
 */
data class TransactionRefundSeed(
    val originalTransactionId: String,
    val amountText: String,
    val dateText: String,
    val categoryId: String,
    val accountId: String,
    /** True when the original receiving account is no longer active, so the user must choose one. */
    val originalAccountUnavailable: Boolean,
    val refundLinks: String,
) {
    fun toDraft(): TransactionEditorDraft = TransactionEditorDraft(
        type = TransactionEditorHelper.INCOME_TYPE,
        amountText = amountText,
        categoryId = categoryId,
        accountId = accountId,
        dateText = dateText,
        note = "",
        tagsText = "",
        refundLinks = refundLinks,
        isRefund = true,
    )
}

/** Production helpers for the refund seed shown when a user refunds an expense. */
object TransactionRefundSeedHelper {
    const val NOT_REFUNDABLE_EXPENSE_ERROR = "原账单不是可退款的支出，无法记录退款"

    /**
     * A refund target must be a live expense. The detail/edit path already
     * resolves only non-deleted transactions, so a missing record fails earlier;
     * this guard rejects the wrong kind of record instead of seeding an
     * unrelated income.
     */
    fun isRefundableExpense(original: JSONObject): Boolean =
        original.optString("id").isNotBlank() &&
            original.optInt("type", -1) == TransactionEditorHelper.EXPENSE_TYPE &&
            !original.optBoolean("isRefund", false)

    /**
     * Builds the seed applied *before* the discard baseline is taken.
     *
     * @param incomeCategories visible income categories (parents included; they
     *   are filtered out by [incomeParentIds] because the server rejects them).
     * @param activeAccountIds accounts the form can actually select.
     * @param todayText device-local `YYYY-MM-DD` for "today".
     */
    fun buildRefundSeed(
        original: JSONObject,
        incomeCategories: List<JSONObject>,
        incomeParentIds: Set<String>,
        activeAccountIds: Set<String>,
        todayText: String,
    ): TransactionRefundSeed {
        require(isRefundableExpense(original)) { NOT_REFUNDABLE_EXPENSE_ERROR }
        val originalId = original.optString("id")
        val originalAccountId = original.optString("accountId")
        val accountActive = originalAccountId.isNotBlank() && originalAccountId in activeAccountIds
        return TransactionRefundSeed(
            originalTransactionId = originalId,
            amountText = "",
            dateText = todayText,
            categoryId = TransactionEditorHelper.firstLeafCategoryId(incomeCategories, incomeParentIds),
            accountId = if (accountActive) originalAccountId else "",
            originalAccountUnavailable = !accountActive,
            refundLinks = originalId,
        )
    }
}
