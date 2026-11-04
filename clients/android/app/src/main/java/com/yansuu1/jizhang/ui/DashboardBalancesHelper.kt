package com.yansuu1.jizhang.ui

import org.json.JSONArray
import org.json.JSONObject

/**
 * Authoritative account balance item decoded from `/api/v1/accounts/balances` items array.
 * Each item maps to a server account with its authoritative balanceCents.
 */
data class AccountBalanceItem(
    val accountId: String,
    val name: String,
    val balanceCents: Long,
    val type: Int? = null,
)

/**
 * Authoritative balance snapshot decoded from server `/api/v1/accounts/balances`.
 * [totalBalanceCents] MUST come from the server's authoritative `totalBalanceCents` field
 * and MUST NEVER be computed by summing [items].
 */
data class DashboardBalancesSnapshot(
    val totalBalanceCents: Long,
    val items: List<AccountBalanceItem>,
    val totalAssetsCents: Long? = null,
    val totalLiabilitiesCents: Long? = null,
)

/**
 * View state for the dashboard balance card.
 */
data class DashboardBalancesViewState(
    val snapshot: DashboardBalancesSnapshot? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val isStale: Boolean = false,
) {
    val isInitialLoading: Boolean get() = loading && snapshot == null
    val isRefreshing: Boolean get() = loading && snapshot != null
}

/**
 * Production decoder and validation helper for dashboard balances.
 */
object DashboardBalancesHelper {

    /**
     * Formats monetary amount respecting privacy toggle.
     * When [hidden] is true, returns "¥ ****".
     * When [hidden] is false, returns "¥ " followed by [formatYuan].
     */
    fun formatAmount(cents: Long, hidden: Boolean): String =
        if (hidden) "¥ ****" else "¥ ${formatYuan(cents)}"

    /**
     * Decodes the raw JSONObject response of `/api/v1/accounts/balances`.
     * Validates that required fields are present and correctly typed.
     * Throws [IllegalArgumentException] on missing or invalid required fields;
     * never silently defaults missing amounts to 0L.
     */
    fun decodeBalancesJson(json: JSONObject): DashboardBalancesSnapshot {
        if (!json.has("totalBalanceCents") || json.isNull("totalBalanceCents")) {
            throw IllegalArgumentException("Missing required field: totalBalanceCents")
        }
        val rawTotal = json.opt("totalBalanceCents")
        val totalBalanceCents = when (rawTotal) {
            is Number -> rawTotal.toLong()
            is String -> rawTotal.toLongOrNull()
                ?: throw IllegalArgumentException("Invalid totalBalanceCents number format: $rawTotal")
            else -> throw IllegalArgumentException("Invalid totalBalanceCents type: ${rawTotal?.javaClass?.simpleName}")
        }

        if (!json.has("items") || json.isNull("items")) {
            throw IllegalArgumentException("Missing required field: items")
        }
        val itemsArray = json.optJSONArray("items")
            ?: throw IllegalArgumentException("Field 'items' must be a JSON array")

        val items = ArrayList<AccountBalanceItem>(itemsArray.length())
        for (i in 0 until itemsArray.length()) {
            val itemObj = itemsArray.optJSONObject(i)
                ?: throw IllegalArgumentException("Item at index $i is not a JSON object")

            if (!itemObj.has("accountId") || itemObj.isNull("accountId")) {
                throw IllegalArgumentException("Item at index $i missing required field: accountId")
            }
            val accountId = itemObj.optString("accountId")
            if (accountId.isBlank()) {
                throw IllegalArgumentException("Item at index $i has blank accountId")
            }

            if (!itemObj.has("name") || itemObj.isNull("name")) {
                throw IllegalArgumentException("Item at index $i missing required field: name")
            }
            val name = itemObj.optString("name")

            if (!itemObj.has("balanceCents") || itemObj.isNull("balanceCents")) {
                throw IllegalArgumentException("Item at index $i missing required field: balanceCents")
            }
            val rawBalance = itemObj.opt("balanceCents")
            val balanceCents = when (rawBalance) {
                is Number -> rawBalance.toLong()
                is String -> rawBalance.toLongOrNull()
                    ?: throw IllegalArgumentException("Item at index $i invalid balanceCents format: $rawBalance")
                else -> throw IllegalArgumentException("Item at index $i invalid balanceCents type: ${rawBalance?.javaClass?.simpleName}")
            }

            val type = if (itemObj.has("type") && !itemObj.isNull("type")) itemObj.optInt("type") else null

            items.add(
                AccountBalanceItem(
                    accountId = accountId,
                    name = name,
                    balanceCents = balanceCents,
                    type = type,
                )
            )
        }

        val totalAssetsCents = if (json.has("totalAssetsCents") && !json.isNull("totalAssetsCents")) {
            (json.opt("totalAssetsCents") as? Number)?.toLong()
                ?: (json.opt("totalAssetsCents") as? String)?.toLongOrNull()
        } else null

        val totalLiabilitiesCents = if (json.has("totalLiabilitiesCents") && !json.isNull("totalLiabilitiesCents")) {
            (json.opt("totalLiabilitiesCents") as? Number)?.toLong()
                ?: (json.opt("totalLiabilitiesCents") as? String)?.toLongOrNull()
        } else null

        return DashboardBalancesSnapshot(
            totalBalanceCents = totalBalanceCents,
            items = items,
            totalAssetsCents = totalAssetsCents,
            totalLiabilitiesCents = totalLiabilitiesCents,
        )
    }
}

/**
 * Manages request generations and state ownership for balance loading.
 * Ensures:
 * - A stale or cancelled generation's success/error/finally cannot overwrite live state.
 * - Refresh preserves previous snapshot and marks it as stale.
 * - Initial failure leaves snapshot null with honest error message.
 */
class DashboardBalancesCoordinator {
    private var _state = DashboardBalancesViewState()
    val state: DashboardBalancesViewState get() = _state

    private var activeGeneration: Long = 0L

    fun currentGeneration(): Long = activeGeneration

    /**
     * Initiates a new load operation.
     * Increments the generation counter and sets loading = true.
     * If a snapshot exists, retains it and marks it as stale.
     * Returns the generation token for this load operation.
     */
    fun startLoad(): Long {
        activeGeneration++
        _state = _state.copy(
            loading = true,
            error = null,
            isStale = _state.snapshot != null,
        )
        return activeGeneration
    }

    /**
     * Applies successful balance snapshot for [gen].
     * Returns true if applied, false if rejected due to stale generation.
     */
    fun onLoadSuccess(gen: Long, snapshot: DashboardBalancesSnapshot): Boolean {
        if (gen != activeGeneration) {
            return false
        }
        _state = _state.copy(
            snapshot = snapshot,
            loading = false,
            error = null,
            isStale = false,
        )
        return true
    }

    /**
     * Records load error for [gen].
     * If previous snapshot exists, retains it with isStale = true.
     * Returns true if applied, false if rejected due to stale generation.
     */
    fun onLoadError(gen: Long, errorMessage: String): Boolean {
        if (gen != activeGeneration) {
            return false
        }
        _state = _state.copy(
            loading = false,
            error = errorMessage,
        )
        return true
    }

    /**
     * Finalizes load operation for [gen].
     * Resets loading flag only if [gen] is still the active generation.
     * Returns true if applied, false if rejected.
     */
    fun onLoadFinally(gen: Long): Boolean {
        if (gen == activeGeneration && _state.loading) {
            _state = _state.copy(loading = false)
            return true
        }
        return false
    }
}
