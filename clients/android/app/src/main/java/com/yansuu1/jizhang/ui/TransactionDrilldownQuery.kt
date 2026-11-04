package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.net.JsonNumberReaders
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject

/** Exact server-resolved statistics scope; category IDs never imply descendants. */
data class TransactionDrilldownQuery(
    val from: Long,
    val to: Long,
    val categoryId: String,
    val categoryName: String,
    val accountId: String? = null,
    val rangeLabel: String,
    val expectedTotalCents: Long,
) {
    init {
        require(from >= 0 && from < to && to <= JsonNumberReaders.MAX_SAFE_INTEGER) { "分类明细区间无效" }
        require(categoryId.isNotBlank()) { "分类明细必须指定精确分类" }
        require(accountId == null || accountId.isNotBlank()) { "账户条件不可为空白" }
        require(expectedTotalCents in 0..JsonNumberReaders.MAX_SAFE_INTEGER) { "来源统计金额无效" }
    }

    fun transactionQuery(
        expectedExpenseCents: Long? = null,
        expectedExpenseCount: Int? = null,
    ): TransactionQuery = TransactionQuery(
        typeFilter = 0,
        categoryId = categoryId,
        accountId = accountId,
        expectedExpenseCents = expectedExpenseCents,
        expectedExpenseCount = expectedExpenseCount,
    )
}

/** Money/count are the scoped server summary, never an Android sum of list rows. */
internal data class TransactionDrilldownResult(
    val items: List<JSONObject>,
    val expenseCount: Int,
    val totalCents: Long,
    val statisticsChanged: Boolean,
)

/**
 * All-or-nothing read of a category's authoritative total/count and full list.
 *
 * The existing bounded loader owns pagination/duplicate-ID checks. Here we additionally
 * validate exact query predicates and the summary count, without doing money arithmetic.
 * Authenticated scope is checked after either success or failure, so another user's data
 * or error cannot be mistaken for the scope captured before the request.
 */
internal suspend fun loadTransactionDrilldown(
    query: TransactionDrilldownQuery,
    resolveScope: suspend () -> FinancialScope,
    fetchSummary: suspend (TransactionDrilldownQuery) -> JSONObject,
    fetchTransactions: suspend (Map<String, String>) -> JSONObject,
): TransactionDrilldownResult {
    val before = resolveScope()
    val candidate: Result<TransactionDrilldownResult> = try {
        val summary = decodeDrilldownSummary(query, fetchSummary(query))
        currentCoroutineContext().ensureActive()
        val month = loadTransactionMonth(
            query.transactionQuery(
                expectedExpenseCents = summary.totalCents,
                expectedExpenseCount = summary.expenseCount,
            ),
            query.from,
            query.to,
            fetchTransactions,
        )
        require(month.total == summary.expenseCount && month.items.size == summary.expenseCount) {
            "统计笔数与完整账单列表不一致，数据可能已变化，请重试。未显示不完整明细。"
        }
        validateDrilldownRows(query, month.items)
        Result.success(TransactionDrilldownResult(
            items = month.items,
            expenseCount = summary.expenseCount,
            totalCents = summary.totalCents,
            statisticsChanged = summary.totalCents != query.expectedTotalCents,
        ))
    } catch (error: CancellationException) {
        throw error
    } catch (error: AuthExpiredException) {
        throw error
    } catch (error: Exception) {
        Result.failure(error)
    }
    currentCoroutineContext().ensureActive()
    val after = resolveScope()
    currentCoroutineContext().ensureActive()
    check(before == after) { "认证范围已变化，已丢弃原范围的明细结果，请重试。" }
    return candidate.getOrThrow()
}

private data class DrilldownSummary(val totalCents: Long, val expenseCount: Int)

private fun decodeDrilldownSummary(query: TransactionDrilldownQuery, response: JSONObject): DrilldownSummary {
    require(statsRequiredLong(response, "from") == query.from && statsRequiredLong(response, "to") == query.to) {
        "分类统计与明细区间不一致，未显示明细。"
    }
    require(response.has("accountId") && response.has("categoryId")) {
        "服务端未确认分类与账户条件，请升级服务端后重试。"
    }
    require(response.opt("categoryId") == query.categoryId) { "服务端分类条件不一致，未显示明细。" }
    val accountId = if (response.isNull("accountId")) null else statsRequiredText(response, "accountId")
    require(accountId == query.accountId) { "服务端账户条件不一致，未显示明细。" }
    val totalCents = statsRequiredLong(response, "totalCents")
    val count = statsRequiredLong(response, "expenseCount")
    require(count <= TRANSACTION_MONTH_MAX_ROWS) {
        "该分类在此范围有 $count 笔支出，超过完整加载上限 $TRANSACTION_MONTH_MAX_ROWS 笔。请缩小统计范围，未显示不完整明细。"
    }
    val items = response.optJSONArray("items")
        ?: throw IllegalArgumentException("分类统计缺少 items，未显示明细。")
    if (count == 0L) {
        require(totalCents == 0L && items.length() == 0) { "空分类统计的金额或分类行不一致。" }
    } else {
        require(items.length() == 1) { "服务端未返回精确分类统计，请升级服务端后重试。" }
        val item = items.optJSONObject(0) ?: throw IllegalArgumentException("分类统计行必须是对象")
        require(statsRequiredText(item, "categoryId") == query.categoryId) { "服务端分类条件不一致，未显示明细。" }
        require(statsRequiredLong(item, "amountCents") == totalCents) { "分类统计金额与服务端合计不一致。" }
    }
    return DrilldownSummary(totalCents, count.toInt())
}

private fun validateDrilldownRows(query: TransactionDrilldownQuery, items: List<JSONObject>) {
    items.forEach { item ->
        require(JsonNumberReaders.requireExactInt(item.opt("type"), "type") == 0) {
            "分类明细包含非支出账单，未显示明细。"
        }
        require(statsRequiredText(item, "categoryId") == query.categoryId) {
            "分类明细包含其他分类账单，未显示明细。"
        }
        val accountId = statsRequiredText(item, "accountId")
        require(query.accountId == null || accountId == query.accountId) {
            "分类明细包含其他账户账单，未显示明细。"
        }
        val date = statsRequiredLong(item, "date")
        require(date >= query.from && date < query.to) { "分类明细包含区间外账单，未显示明细。" }
        // Validate a renderable exact amount only; do not add it to any client total.
        statsRequiredLong(item, "amountCents")
    }
}
