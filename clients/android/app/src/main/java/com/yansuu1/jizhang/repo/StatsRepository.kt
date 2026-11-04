package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Statistics domain (B02, C3). Every figure is server-computed: this class forwards
 * query parameters and returns the payload unchanged, so the UI can never invent a
 * total or a range from device state.
 *
 * Range contract:
 * - [window] is the additive `GET /api/v1/stats/window` route. Older servers answer
 *   404; callers show an upgrade/unavailable state, never guessed device boundaries.
 * - [categoryShare] keeps its historical `from`/`to` shape. `netExpenseCents` /
 *   `amountCents` remain the wire names while the values are gross expense.
 * - [monthlyTrend] gained the additive `endMonth` (`YYYY-MM`) anchor used to view a
 *   historical series; omitting it keeps the server's current-month behaviour.
 */
class StatsRepository(private val api: ApiClient) {
    suspend fun range(): JSONObject = withContext(Dispatchers.IO) { api.get("/api/v1/stats/range") }

    suspend fun monthWindow(monthStart: Long): JSONObject = withContext(Dispatchers.IO) {
        api.get("/api/v1/stats/month-window", mapOf("monthStart" to monthStart.toString()))
    }

    /**
     * Additive server statistics window.
     *
     * [kind] is `month` or `last30`; [month] is `YYYY-MM` and only meaningful for
     * `month` (the server rejects it for `last30`, so it is omitted there).
     */
    suspend fun window(kind: String, month: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            api.get("/api/v1/stats/window", queryOf("kind" to kind, "month" to month))
        }

    /**
     * Per-category gross expense over `[from, to)`.
     *
     * [accountId]/[categoryId] are exact ID filters shared with the drilldown.
     * Omit null IDs for all accounts/categories. A filtered caller validates the
     * echoed scope so an old server cannot silently ignore the predicate.
     */
    suspend fun categoryShare(from: Long, to: Long, accountId: String? = null, categoryId: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            api.get(
                "/api/v1/stats/category-share",
                queryOf(
                    "from" to from,
                    "to" to to,
                    "accountId" to accountId,
                    "categoryId" to categoryId,
                ),
            )
        }

    suspend fun monthlyTrend(months: Int = 6, endMonth: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            api.get(
                "/api/v1/stats/monthly-trend",
                queryOf("months" to months, "endMonth" to endMonth),
            )
        }

    suspend fun poolTrend(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/stats/pool-trend") }
}
