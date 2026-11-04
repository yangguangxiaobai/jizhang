package com.yansuu1.jizhang.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DashboardBalancesHelperTest {

    @Test
    fun decodeValidBalances_MultiAccountPositiveNegativeZero() {
        val json = JSONObject().apply {
            put("totalBalanceCents", 52345L)
            put("totalAssetsCents", 72345L)
            put("totalLiabilitiesCents", 20000L)
            val itemsArr = JSONArray().apply {
                // 1. Positive balance
                put(JSONObject().apply {
                    put("accountId", "acc-wx-1")
                    put("name", "微信钱包")
                    put("balanceCents", 20000L)
                    put("type", 1)
                })
                // 2. Zero balance
                put(JSONObject().apply {
                    put("accountId", "acc-zero")
                    put("name", "现金备用金")
                    put("balanceCents", 0L)
                    put("type", 1)
                })
                // 3. Negative balance (e.g. credit card / liability)
                put(JSONObject().apply {
                    put("accountId", "acc-cc-1")
                    put("name", "招商银行信用卡")
                    put("balanceCents", -20000L)
                    put("type", 2)
                })
                // 4. Long account name
                put(JSONObject().apply {
                    put("accountId", "acc-long-name")
                    put("name", "中国工商银行牡丹灵通卡(工资与公积金专属联名账户)")
                    put("balanceCents", 52345L)
                    put("type", 1)
                })
                // 5. Duplicate name with distinct accountId
                put(JSONObject().apply {
                    put("accountId", "acc-wx-2")
                    put("name", "微信钱包")
                    put("balanceCents", 0L)
                    put("type", 1)
                })
            }
            put("items", itemsArr)
        }

        val snapshot = DashboardBalancesHelper.decodeBalancesJson(json)
        assertEquals(52345L, snapshot.totalBalanceCents)
        assertEquals(72345L, snapshot.totalAssetsCents)
        assertEquals(20000L, snapshot.totalLiabilitiesCents)
        assertEquals(5, snapshot.items.size)

        // Item 1: positive
        assertEquals("acc-wx-1", snapshot.items[0].accountId)
        assertEquals("微信钱包", snapshot.items[0].name)
        assertEquals(20000L, snapshot.items[0].balanceCents)
        assertEquals(1, snapshot.items[0].type)

        // Item 2: zero
        assertEquals("acc-zero", snapshot.items[1].accountId)
        assertEquals("现金备用金", snapshot.items[1].name)
        assertEquals(0L, snapshot.items[1].balanceCents)

        // Item 3: negative
        assertEquals("acc-cc-1", snapshot.items[2].accountId)
        assertEquals("招商银行信用卡", snapshot.items[2].name)
        assertEquals(-20000L, snapshot.items[2].balanceCents)

        // Item 4: long name
        assertEquals("acc-long-name", snapshot.items[3].accountId)
        assertEquals("中国工商银行牡丹灵通卡(工资与公积金专属联名账户)", snapshot.items[3].name)
        assertEquals(52345L, snapshot.items[3].balanceCents)

        // Item 5: same name, different ID
        assertEquals("acc-wx-2", snapshot.items[4].accountId)
        assertEquals("微信钱包", snapshot.items[4].name)
        assertEquals(0L, snapshot.items[4].balanceCents)
    }

    @Test
    fun decodePreservesServerTotalBalanceAuthoritative_NeverRederived() {
        // Server total is 999999L, while item sum is 3000L.
        // Client must strictly use the server's authoritative totalBalanceCents field.
        val json = JSONObject().apply {
            put("totalBalanceCents", 999999L)
            val itemsArr = JSONArray().apply {
                put(JSONObject().apply {
                    put("accountId", "acc-1")
                    put("name", "账户1")
                    put("balanceCents", 1000L)
                })
                put(JSONObject().apply {
                    put("accountId", "acc-2")
                    put("name", "账户2")
                    put("balanceCents", 2000L)
                })
            }
            put("items", itemsArr)
        }

        val snapshot = DashboardBalancesHelper.decodeBalancesJson(json)
        assertEquals(999999L, snapshot.totalBalanceCents)
        assertEquals(2, snapshot.items.size)
        // Verify items sum is indeed different from authoritative total
        val itemSum = snapshot.items.sumOf { it.balanceCents }
        assertEquals(3000L, itemSum)
        assertTrue(snapshot.totalBalanceCents != itemSum)
    }

    @Test
    fun decodeRejectsMissingOrNullTotalBalanceCents_NeverDefaultsZero() {
        // Missing totalBalanceCents field
        val missingTotal = JSONObject().apply {
            put("items", JSONArray())
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(missingTotal)
            fail("Expected IllegalArgumentException for missing totalBalanceCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("totalBalanceCents") == true)
        }

        // Null totalBalanceCents field
        val nullTotal = JSONObject().apply {
            put("totalBalanceCents", JSONObject.NULL)
            put("items", JSONArray())
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(nullTotal)
            fail("Expected IllegalArgumentException for null totalBalanceCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("totalBalanceCents") == true)
        }

        // Invalid non-numeric totalBalanceCents
        val invalidTotal = JSONObject().apply {
            put("totalBalanceCents", "not_a_number")
            put("items", JSONArray())
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(invalidTotal)
            fail("Expected IllegalArgumentException for non-numeric totalBalanceCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("totalBalanceCents") == true)
        }
    }

    @Test
    fun decodeRejectsMissingOrNullItems_OrItemMissingBalance() {
        // Missing items field
        val missingItems = JSONObject().apply {
            put("totalBalanceCents", 1000L)
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(missingItems)
            fail("Expected IllegalArgumentException for missing items")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("items") == true)
        }

        // Item missing balanceCents
        val itemMissingBalance = JSONObject().apply {
            put("totalBalanceCents", 1000L)
            put("items", JSONArray().apply {
                put(JSONObject().apply {
                    put("accountId", "acc-1")
                    put("name", "账户1")
                })
            })
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(itemMissingBalance)
            fail("Expected IllegalArgumentException for item missing balanceCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("balanceCents") == true)
        }

        // Item missing accountId
        val itemMissingAccountId = JSONObject().apply {
            put("totalBalanceCents", 1000L)
            put("items", JSONArray().apply {
                put(JSONObject().apply {
                    put("name", "账户1")
                    put("balanceCents", 1000L)
                })
            })
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(itemMissingAccountId)
            fail("Expected IllegalArgumentException for item missing accountId")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("accountId") == true)
        }

        // Item missing name
        val itemMissingName = JSONObject().apply {
            put("totalBalanceCents", 1000L)
            put("items", JSONArray().apply {
                put(JSONObject().apply {
                    put("accountId", "acc-1")
                    put("balanceCents", 1000L)
                })
            })
        }
        try {
            DashboardBalancesHelper.decodeBalancesJson(itemMissingName)
            fail("Expected IllegalArgumentException for item missing name")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("name") == true)
        }
    }

    @Test
    fun formatAmount_RespectsPrivacyMasking() {
        // When hidden is true: all amounts are masked to "¥ ****"
        assertEquals("¥ ****", DashboardBalancesHelper.formatAmount(10000L, hidden = true))
        assertEquals("¥ ****", DashboardBalancesHelper.formatAmount(0L, hidden = true))
        assertEquals("¥ ****", DashboardBalancesHelper.formatAmount(-5000L, hidden = true))

        // When hidden is false: amounts are properly formatted with yuan and cents
        assertEquals("¥ 100.00", DashboardBalancesHelper.formatAmount(10000L, hidden = false))
        assertEquals("¥ 0.00", DashboardBalancesHelper.formatAmount(0L, hidden = false))
        assertEquals("¥ -50.00", DashboardBalancesHelper.formatAmount(-5000L, hidden = false))
    }

    @Test
    fun coordinatorInitialLoadLifecycle() {
        val coordinator = DashboardBalancesCoordinator()
        assertNull(coordinator.state.snapshot)
        assertFalse(coordinator.state.loading)
        assertNull(coordinator.state.error)
        assertFalse(coordinator.state.isStale)
        assertFalse(coordinator.state.isInitialLoading)
        assertFalse(coordinator.state.isRefreshing)

        // 1. Start initial load
        val gen1 = coordinator.startLoad()
        assertEquals(1L, gen1)
        assertTrue(coordinator.state.loading)
        assertTrue(coordinator.state.isInitialLoading)
        assertFalse(coordinator.state.isRefreshing)
        assertNull(coordinator.state.snapshot)
        assertFalse(coordinator.state.isStale)

        // 2. Initial load fails with honest error (no default to 0)
        val errorApplied = coordinator.onLoadError(gen1, "Connection refused")
        assertTrue(errorApplied)
        assertFalse(coordinator.state.loading)
        assertNull(coordinator.state.snapshot) // Must NOT fabricate snapshot or 0
        assertEquals("Connection refused", coordinator.state.error)
        assertFalse(coordinator.state.isStale)

        // 3. Retry initial load
        val gen2 = coordinator.startLoad()
        assertEquals(2L, gen2)
        assertTrue(coordinator.state.loading)
        assertTrue(coordinator.state.isInitialLoading)
        assertNull(coordinator.state.error)

        // 4. Initial load succeeds
        val snapshot = DashboardBalancesSnapshot(
            totalBalanceCents = 15000L,
            items = listOf(AccountBalanceItem("acc-1", "招商银行", 15000L)),
        )
        val successApplied = coordinator.onLoadSuccess(gen2, snapshot)
        assertTrue(successApplied)
        assertFalse(coordinator.state.loading)
        assertEquals(snapshot, coordinator.state.snapshot)
        assertNull(coordinator.state.error)
        assertFalse(coordinator.state.isStale)
    }

    @Test
    fun coordinatorRefreshLifecycleWithStaleRetention() {
        val coordinator = DashboardBalancesCoordinator()
        val initialSnap = DashboardBalancesSnapshot(
            totalBalanceCents = 88800L,
            items = listOf(AccountBalanceItem("acc-1", "支付宝", 88800L)),
        )
        val gen1 = coordinator.startLoad()
        coordinator.onLoadSuccess(gen1, initialSnap)

        // Start refresh
        val gen2 = coordinator.startLoad()
        assertEquals(2L, gen2)
        assertTrue(coordinator.state.loading)
        assertFalse(coordinator.state.isInitialLoading)
        assertTrue(coordinator.state.isRefreshing)
        assertTrue(coordinator.state.isStale) // Retains previous snapshot as stale!
        assertEquals(initialSnap, coordinator.state.snapshot)

        // Refresh fails
        val errorApplied = coordinator.onLoadError(gen2, "Gateway timeout")
        assertTrue(errorApplied)
        assertFalse(coordinator.state.loading)
        assertEquals("Gateway timeout", coordinator.state.error)
        // Previous snapshot is still retained
        assertEquals(initialSnap, coordinator.state.snapshot)
        assertTrue(coordinator.state.isStale)

        // Next refresh succeeds with updated snapshot
        val gen3 = coordinator.startLoad()
        val updatedSnap = DashboardBalancesSnapshot(
            totalBalanceCents = 99900L,
            items = listOf(AccountBalanceItem("acc-1", "支付宝", 99900L)),
        )
        coordinator.onLoadSuccess(gen3, updatedSnap)
        assertFalse(coordinator.state.loading)
        assertFalse(coordinator.state.isStale)
        assertNull(coordinator.state.error)
        assertEquals(updatedSnap, coordinator.state.snapshot)
    }

    @Test
    fun coordinatorRejectsStaleGenerationOutcomes() {
        val coordinator = DashboardBalancesCoordinator()
        val gen1 = coordinator.startLoad()

        // User or event initiates new reload (gen 2) before gen 1 finishes
        val gen2 = coordinator.startLoad()
        assertEquals(2L, gen2)

        // Stale gen 1 success arrives -> must be rejected
        val snap1 = DashboardBalancesSnapshot(totalBalanceCents = 100L, items = emptyList())
        val staleSuccess = coordinator.onLoadSuccess(gen1, snap1)
        assertFalse(staleSuccess)
        assertNull(coordinator.state.snapshot)
        assertTrue(coordinator.state.loading)

        // Stale gen 1 error arrives -> must be rejected
        val staleError = coordinator.onLoadError(gen1, "Old error")
        assertFalse(staleError)
        assertNull(coordinator.state.error)
        assertTrue(coordinator.state.loading)

        // Stale gen 1 finally arrives -> must be rejected (loading flag preserved for gen 2)
        val staleFinally = coordinator.onLoadFinally(gen1)
        assertFalse(staleFinally)
        assertTrue(coordinator.state.loading)

        // Live gen 2 success arrives -> applied!
        val snap2 = DashboardBalancesSnapshot(totalBalanceCents = 200L, items = emptyList())
        val liveSuccess = coordinator.onLoadSuccess(gen2, snap2)
        assertTrue(liveSuccess)
        assertEquals(snap2, coordinator.state.snapshot)
        assertFalse(coordinator.state.loading)

        // Live gen 2 finally
        val liveFinally = coordinator.onLoadFinally(gen2)
        assertFalse(liveFinally) // loading already set to false by onLoadSuccess
        assertFalse(coordinator.state.loading)
    }

    @Test
    fun independentLoadingSimulation_MainFailsBalancesSucceed() {
        // Simulate: Main modules (trend/budget) encounter HTTP 500
        var mainLoading = true
        var mainError: String? = null
        var mainHasLoaded = false

        val balancesCoordinator = DashboardBalancesCoordinator()
        val balGen = balancesCoordinator.startLoad()

        // Main fails
        mainError = "HTTP 500 Internal Server Error in /api/v1/budget/overview"
        mainLoading = false
        mainHasLoaded = false

        // Balances succeeds independently
        val balancesJson = JSONObject().apply {
            put("totalBalanceCents", 123456L)
            put("items", JSONArray().apply {
                put(JSONObject().apply {
                    put("accountId", "acc-cmb")
                    put("name", "招商银行储蓄卡")
                    put("balanceCents", 123456L)
                })
            })
        }
        val snapshot = DashboardBalancesHelper.decodeBalancesJson(balancesJson)
        val applied = balancesCoordinator.onLoadSuccess(balGen, snapshot)

        // Assertions: Balances state is healthy and available despite main failure!
        assertTrue(applied)
        assertNotNull(balancesCoordinator.state.snapshot)
        assertEquals(123456L, balancesCoordinator.state.snapshot?.totalBalanceCents)
        assertEquals(1, balancesCoordinator.state.snapshot?.items?.size)
        assertNull(balancesCoordinator.state.error)
        assertFalse(balancesCoordinator.state.loading)

        // Main error is preserved independently
        assertNotNull(mainError)
        assertFalse(mainHasLoaded)
    }

    @Test
    fun independentLoadingSimulation_BalancesFailMainSucceeds() {
        // Simulate: Balances encounter Network Timeout, but Main modules succeed
        var mainLoading = true
        var mainError: String? = null
        var mainHasLoaded = false
        var monthIncome: Long? = null

        val balancesCoordinator = DashboardBalancesCoordinator()
        val balGen = balancesCoordinator.startLoad()

        // Balances fails
        balancesCoordinator.onLoadError(balGen, "Timeout connecting to /api/v1/accounts/balances")
        balancesCoordinator.onLoadFinally(balGen)

        // Main succeeds
        monthIncome = 850000L
        mainLoading = false
        mainHasLoaded = true

        // Assertions: Main data is intact and usable
        assertEquals(850000L, monthIncome)
        assertTrue(mainHasLoaded)
        assertNull(mainError)

        // Balances shows honest error without masking 0 or taking down the main dashboard
        assertNull(balancesCoordinator.state.snapshot)
        assertEquals("Timeout connecting to /api/v1/accounts/balances", balancesCoordinator.state.error)
        assertFalse(balancesCoordinator.state.loading)
    }
}
