package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialGoalEntryDto
import com.yansuu1.jizhang.repo.FinancialGoalEntryPageView
import com.yansuu1.jizhang.repo.ManualGoal

/**
 * 查询范围规格：包含目标类型过滤（null 为全部）、窗口范围（null 为全部历史）以及是否包含软删除记录。
 */
data class ManualGoalEntryQuery(
    val goal: ManualGoal? = null,
    val window: ManualGoalWindowContext? = null,
    val includeDeleted: Boolean = false,
)

/**
 * 手动存钱与投资明细的分页有界状态。
 *
 * 核心契约：
 * 1. 严格跟踪服务端给出的 total、revision 与 hasMore / nextCursor。
 * 2. 只有同一 revision 的后续页才能拼接入 items；若 revision 发生改变，置 restartRequired = true 要求重读首屏。
 * 3. 分页加载错误必须保留当前已加载项，并以 error 明确数据处于不完整状态，支持原地重试。
 */
data class ManualGoalEntryListState(
    val query: ManualGoalEntryQuery,
    val items: List<FinancialGoalEntryDto> = emptyList(),
    val total: Int? = null,
    val revision: Long? = null,
    val hasMore: Boolean = false,
    val nextCursor: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val restartRequired: Boolean = false,
)

/**
 * 将服务端返回的 [page] 拼接到当前的 [state] 中。
 *
 * 校验规则：
 * 1. 空页不能带有 hasMore=true。
 * 2. 若当前已持有条目，必须校验 page.revision 与 state.revision 一致；不一致时置 restartRequired 并拒绝拼接。
 * 3. 游标必须有效前进，不可在 hasMore 为 true 时回显与当前相同的 nextCursor。
 * 4. 新页中的条目 ID 不能与当前已有列表出现任何重复。
 */
internal fun appendManualGoalEntryPage(
    state: ManualGoalEntryListState,
    page: FinancialGoalEntryPageView,
): ManualGoalEntryListState {
    if (page.items.isEmpty() && page.hasMore) {
        throw IllegalArgumentException("Empty page cannot have hasMore=true")
    }

    if (page.hasMore && page.nextCursor.isNullOrBlank()) {
        throw IllegalArgumentException("hasMore=true requires a valid non-null nextCursor")
    }

    if (!page.hasMore && page.nextCursor != null) {
        throw IllegalArgumentException("hasMore=false must not carry a nextCursor")
    }

    if (state.items.isEmpty()) {
        val seen = HashSet<String>()
        for (item in page.items) {
            if (!seen.add(item.id)) {
                throw IllegalArgumentException("Duplicate entry id encountered: ${item.id}")
            }
        }
        return state.copy(
            items = page.items,
            total = page.total,
            revision = page.revision,
            hasMore = page.hasMore,
            nextCursor = page.nextCursor,
            loading = false,
            error = null,
            restartRequired = false,
        )
    }

    // 多页拼接：校验 revision 一致性
    if (state.revision != null && page.revision != state.revision) {
        return state.copy(
            loading = false,
            error = "数据版本已变更，请刷新重试",
            restartRequired = true,
        )
    }

    // 校验 cursor 是否停滞
    if (page.hasMore && page.nextCursor == state.nextCursor) {
        throw IllegalArgumentException("Cursor did not advance")
    }

    // 校验 duplicate ID
    val existingIds = state.items.mapTo(HashSet()) { it.id }
    for (item in page.items) {
        if (!existingIds.add(item.id)) {
            throw IllegalArgumentException("Duplicate entry id encountered: ${item.id}")
        }
    }

    return state.copy(
        items = state.items + page.items,
        total = page.total,
        revision = page.revision,
        hasMore = page.hasMore,
        nextCursor = page.nextCursor,
        loading = false,
        error = null,
        restartRequired = false,
    )
}

internal fun markManualGoalEntryPageLoading(state: ManualGoalEntryListState): ManualGoalEntryListState =
    state.copy(
        loading = true,
        error = null,
    )

internal fun markManualGoalEntryPageError(
    state: ManualGoalEntryListState,
    errorMessage: String,
): ManualGoalEntryListState =
    state.copy(
        loading = false,
        error = errorMessage,
    )
