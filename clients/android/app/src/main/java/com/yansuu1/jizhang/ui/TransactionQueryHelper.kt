package com.yansuu1.jizhang.ui

import org.json.JSONObject

/**
 * Immutable parameters representing a complete transaction query scope and pagination.
 */
data class TransactionQuery(
    val monthOffset: Int = 0,
    val typeFilter: Int? = null,
    val accountId: String? = null,
    val categoryId: String = "",
    val tag: String = "",
    val search: String = "",
    val searchAllHistory: Boolean = true,
    val page: Int = 0,
    val pageSize: Int = TransactionQueryHelper.DEFAULT_PAGE_SIZE,
    /** Drilldown-only server guard against summary/list gross total drift. */
    val expectedExpenseCents: Long? = null,
    val expectedExpenseCount: Int? = null,
) {
    /**
     * Constructs query parameters for the server API.
     * When accountId is null or blank (all accounts), accountId is omitted.
     */
    val isAllHistorySearch: Boolean get() = search.isNotBlank() && searchAllHistory
    val requiresSearchSummary: Boolean get() = search.isNotBlank() && !searchAllHistory

    fun toServerParams(from: Long, to: Long): Map<String, String> {
        val q = mutableMapOf(
            "limit" to pageSize.toString(),
            "offset" to (page * pageSize).toString(),
        )
        if (!isAllHistorySearch) {
            q["from"] = from.toString()
            q["to"] = to.toString()
        }
        if (typeFilter != null) q["type"] = typeFilter.toString()
        if (!accountId.isNullOrBlank()) q["accountId"] = accountId
        if (search.isNotBlank()) q["search"] = search
        if (tag.isNotBlank()) q["tag"] = tag
        if (categoryId.isNotBlank()) q["categoryId"] = categoryId
        if (expectedExpenseCents != null) q["expectedExpenseCents"] = expectedExpenseCents.toString()
        if (expectedExpenseCount != null) q["expectedExpenseCount"] = expectedExpenseCount.toString()
        return q
    }
}

/**
 * UI view state for transactions tab.
 */
data class TransactionViewState(
    val currentQuery: TransactionQuery = TransactionQuery(),
    val loadedQuery: TransactionQuery? = null,
    val items: List<JSONObject> = emptyList(),
    val total: Int? = null,
    val loading: Boolean = false,
    val error: String? = null,
) {
    val totalKnown: Boolean get() = total != null
}

/**
 * Independent metadata state (accounts separated from categories and tags).
 */
data class TransactionMetadataState(
    val accountNames: Map<String, String> = emptyMap(),
    val categoryNames: Map<String, String> = emptyMap(),
    val categoryIcons: Map<String, String> = emptyMap(),
    val categoryColors: Map<String, Long> = emptyMap(),
    val tags: List<String> = emptyList(),
    val accountsLoading: Boolean = false,
    val accountsError: String? = null,
    val metadataLoading: Boolean = false,
    val metadataError: String? = null,
)

object TransactionQueryHelper {
    const val DEFAULT_PAGE_SIZE = 50
    const val ACCOUNT_UNKNOWN_LABEL = "账户信息暂不可用"
    const val ACCOUNT_UNKNOWN_FALLBACK_CHOICE = "账户信息暂不可用（保留当前条件）"
    const val ALL_ACCOUNTS_LABEL = "全部账户"

    fun selectAccount(current: TransactionQuery, newAccountId: String?): TransactionQuery? {
        val normalized = newAccountId.takeIf { !it.isNullOrBlank() }
        if (current.accountId == normalized) return null
        return current.copy(accountId = normalized, page = 0)
    }

    fun selectType(current: TransactionQuery, newType: Int?): TransactionQuery? {
        if (current.typeFilter == newType) return null
        return current.copy(typeFilter = newType, page = 0)
    }

    fun changeMonth(current: TransactionQuery, offsetDelta: Int): TransactionQuery {
        if (offsetDelta == 0) return current
        return current.copy(monthOffset = current.monthOffset + offsetDelta, page = 0)
    }

    fun changePage(current: TransactionQuery, targetPage: Int): TransactionQuery? {
        if (targetPage < 0 || targetPage == current.page) return null
        return current.copy(page = targetPage)
    }

    fun clearFilters(current: TransactionQuery): TransactionQuery {
        return current.copy(
            accountId = null,
            categoryId = "",
            tag = "",
            search = "",
            searchAllHistory = true,
            page = 0,
        )
    }

    fun accountDisplayLabel(accountId: String?, accountNames: Map<String, String>): String {
        if (accountId.isNullOrBlank()) return ALL_ACCOUNTS_LABEL
        return accountNames[accountId] ?: ACCOUNT_UNKNOWN_LABEL
    }

    fun buildAccountChoices(
        accountNames: Map<String, String>,
        selectedAccountId: String?,
    ): List<Pair<String, String>> {
        val choices = mutableListOf<Pair<String, String>>()
        choices.add("" to ALL_ACCOUNTS_LABEL)
        if (!selectedAccountId.isNullOrBlank() && !accountNames.containsKey(selectedAccountId)) {
            choices.add(selectedAccountId to ACCOUNT_UNKNOWN_FALLBACK_CHOICE)
        }
        val sortedAccounts = accountNames.entries
            .sortedBy { it.value }
            .map { it.key to it.value }
        choices.addAll(sortedAccounts)
        return choices
    }

    fun calculatePageCorrection(
        page: Int,
        pageSize: Int,
        total: Int,
        itemCount: Int,
    ): Int? {
        if (itemCount == 0 && page > 0 && total <= page * pageSize) {
            return ((total - 1).coerceAtLeast(0)) / pageSize
        }
        return null
    }
}

/**
 * Coordinates transaction loading generations, latest response ownership,
 * and complete query result isolation.
 */
class TransactionLoadCoordinator(
    initialQuery: TransactionQuery = TransactionQuery(),
) {
    private var _state = TransactionViewState(currentQuery = initialQuery)
    val state: TransactionViewState get() = _state

    private var activeGeneration: Long = 0L

    fun currentGeneration(): Long = activeGeneration

    /**
     * Prepares for a load with targetQuery.
     * Only retains previous items and total if this is the exact same query (refreshing current page).
     * If flipping pages or changing any filter, old items and total are immediately cleared.
     * Returns the generation token for this request.
     */
    fun startLoad(query: TransactionQuery): Long {
        activeGeneration++
        val gen = activeGeneration
        val isExactSameQuery = query == _state.loadedQuery && !query.requiresSearchSummary
        _state = _state.copy(
            currentQuery = query,
            items = if (isExactSameQuery) _state.items else emptyList(),
            total = if (isExactSameQuery) _state.total else null,
            loading = true,
            error = null,
        )
        return gen
    }

    sealed class LoadResultOutcome {
        data class Applied(val newTotal: Int, val itemCount: Int) : LoadResultOutcome()
        data class PageCorrectionRequired(val correctedPage: Int) : LoadResultOutcome()
        object RejectedStale : LoadResultOutcome()
    }

    fun onLoadSuccess(
        gen: Long,
        query: TransactionQuery,
        items: List<JSONObject>,
        total: Int,
    ): LoadResultOutcome {
        if (gen != activeGeneration || query != _state.currentQuery) {
            return LoadResultOutcome.RejectedStale
        }
        val correctedPage = TransactionQueryHelper.calculatePageCorrection(
            page = query.page,
            pageSize = query.pageSize,
            total = total,
            itemCount = items.size,
        )
        if (correctedPage != null) {
            return LoadResultOutcome.PageCorrectionRequired(correctedPage)
        }
        _state = _state.copy(
            loadedQuery = query,
            items = items,
            total = total,
            loading = false,
            error = null,
        )
        return LoadResultOutcome.Applied(newTotal = total, itemCount = items.size)
    }

    fun onLoadError(gen: Long, query: TransactionQuery, errorMessage: String): Boolean {
        if (gen != activeGeneration || query != _state.currentQuery) {
            return false
        }
        _state = _state.copy(
            loading = false,
            error = errorMessage,
        )
        return true
    }

    /** Discard published rows when the server proves their snapshot has changed. */
    fun invalidateLoaded(gen: Long, query: TransactionQuery, errorMessage: String): Boolean {
        if (gen != activeGeneration || query != _state.currentQuery) return false
        _state = _state.copy(
            loadedQuery = null,
            items = emptyList(),
            total = null,
            loading = false,
            error = errorMessage,
        )
        return true
    }

    fun onLoadFinally(gen: Long, query: TransactionQuery): Boolean {
        if (gen == activeGeneration && query == _state.currentQuery && _state.loading) {
            _state = _state.copy(loading = false)
            return true
        }
        return false
    }
}

/**
 * Coordinates metadata loading independently:
 * Accounts are isolated from categories and tags, so account selection
 * can succeed even if category/tag endpoints fail.
 */
class TransactionMetadataCoordinator {
    private var _state = TransactionMetadataState()
    val state: TransactionMetadataState get() = _state

    private var activeAccountsGen: Long = 0L
    private var activeOtherGen: Long = 0L

    fun currentAccountsGeneration(): Long = activeAccountsGen
    fun currentOtherGeneration(): Long = activeOtherGen

    fun startAccountsLoad(): Long {
        activeAccountsGen++
        _state = _state.copy(accountsLoading = true, accountsError = null)
        return activeAccountsGen
    }

    fun onAccountsSuccess(gen: Long, accountNames: Map<String, String>): Boolean {
        if (gen != activeAccountsGen) return false
        _state = _state.copy(
            accountNames = accountNames,
            accountsLoading = false,
            accountsError = null,
        )
        return true
    }

    fun onAccountsError(gen: Long, errorMessage: String): Boolean {
        if (gen != activeAccountsGen) return false
        _state = _state.copy(
            accountsLoading = false,
            accountsError = errorMessage,
        )
        return true
    }

    fun startOtherMetadataLoad(): Long {
        activeOtherGen++
        _state = _state.copy(metadataLoading = true, metadataError = null)
        return activeOtherGen
    }

    fun onOtherMetadataSuccess(
        gen: Long,
        categoryNames: Map<String, String>,
        categoryIcons: Map<String, String>,
        categoryColors: Map<String, Long>,
        tags: List<String>,
    ): Boolean {
        if (gen != activeOtherGen) return false
        _state = _state.copy(
            categoryNames = categoryNames,
            categoryIcons = categoryIcons,
            categoryColors = categoryColors,
            tags = tags,
            metadataLoading = false,
            metadataError = null,
        )
        return true
    }

    fun onOtherMetadataError(gen: Long, errorMessage: String): Boolean {
        if (gen != activeOtherGen) return false
        _state = _state.copy(
            metadataLoading = false,
            metadataError = errorMessage,
        )
        return true
    }
}
