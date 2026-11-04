package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionAccountFilterTest {

    @Test
    fun allAccountsOmitsAccountIdAndPreservesOtherFilters() {
        val query = TransactionQuery(
            monthOffset = 2,
            typeFilter = 0,
            accountId = null,
            categoryId = "cat-food",
            tag = "dinner",
            search = "hotpot",
            searchAllHistory = false,
            page = 0,
            pageSize = 50,
        )
        val params = query.toServerParams(from = 1700000000000L, to = 1702592000000L)
        assertFalse(params.containsKey("accountId"))
        assertEquals("0", params["type"])
        assertEquals("cat-food", params["categoryId"])
        assertEquals("dinner", params["tag"])
        assertEquals("hotpot", params["search"])
        assertFalse(params.containsKey("q"))
        assertEquals("50", params["limit"])
        assertEquals("0", params["offset"])
        assertEquals("1700000000000", params["from"])
        assertEquals("1702592000000", params["to"])
    }

    @Test
    fun selectAccountSwitchesAccountPreservesFiltersAndResetsPage() {
        val initial = TransactionQuery(
            monthOffset = 1,
            typeFilter = 1,
            accountId = null,
            categoryId = "cat-salary",
            tag = "bonus",
            search = "annual",
            page = 3,
            pageSize = 50,
        )
        val updated = TransactionQueryHelper.selectAccount(initial, "acc-alipay")
        assertNotNull(updated)
        assertEquals("acc-alipay", updated!!.accountId)
        assertEquals(0, updated.page) // Page reset to 0
        assertEquals(1, updated.monthOffset)
        assertEquals(1, updated.typeFilter)
        assertEquals("cat-salary", updated.categoryId)
        assertEquals("bonus", updated.tag)
        assertEquals("annual", updated.search)

        val params = updated.toServerParams(from = 1000L, to = 2000L)
        assertEquals("acc-alipay", params["accountId"])
        assertEquals("0", params["offset"])
    }

    @Test
    fun sameAccountSelectionIsNoOp() {
        val queryWithAcc = TransactionQuery(accountId = "acc-cmb", page = 1)
        assertNull(TransactionQueryHelper.selectAccount(queryWithAcc, "acc-cmb"))

        val queryWithAll = TransactionQuery(accountId = null, page = 0)
        assertNull(TransactionQueryHelper.selectAccount(queryWithAll, null))
        assertNull(TransactionQueryHelper.selectAccount(queryWithAll, ""))
        assertNull(TransactionQueryHelper.selectAccount(queryWithAll, "   "))

        // Switching from account back to all accounts should succeed and reset page
        val backToAll = TransactionQueryHelper.selectAccount(queryWithAcc, "")
        assertNotNull(backToAll)
        assertNull(backToAll!!.accountId)
        assertEquals(0, backToAll.page)
    }

    @Test
    fun accountFallbackLabelsDoNotClaimDeleted() {
        val accounts = mapOf("acc-1" to "招商银行", "acc-2" to "微信钱包")

        assertEquals("全部账户", TransactionQueryHelper.accountDisplayLabel(null, accounts))
        assertEquals("全部账户", TransactionQueryHelper.accountDisplayLabel("", accounts))
        assertEquals("招商银行", TransactionQueryHelper.accountDisplayLabel("acc-1", accounts))

        // Unknown account ID fallback should state information is unavailable, not claim deleted
        val unknownLabel = TransactionQueryHelper.accountDisplayLabel("acc-unknown-999", accounts)
        assertEquals("账户信息暂不可用", unknownLabel)
        assertFalse(unknownLabel.contains("已删除"))

        val choices = TransactionQueryHelper.buildAccountChoices(accounts, "acc-unknown-999")
        assertEquals("" to "全部账户", choices[0])
        assertEquals("acc-unknown-999" to "账户信息暂不可用（保留当前条件）", choices[1])
        assertFalse(choices[1].second.contains("已删除"))
        val remainingChoices = choices.drop(2).toMap()
        assertEquals("招商银行", remainingChoices["acc-1"])
        assertEquals("微信钱包", remainingChoices["acc-2"])
    }

    @Test
    fun scopeChangeImmediatelyIsolatesOldRowsAndTotal() {
        val coordinator = TransactionLoadCoordinator()
        val queryA = TransactionQuery(accountId = "acc-A", page = 0)
        val genA = coordinator.startLoad(queryA)

        val item1 = JSONObject().put("id", "tx-1").put("amountCents", 1000L)
        val outcomeA = coordinator.onLoadSuccess(genA, queryA, listOf(item1), total = 10)
        assertTrue(outcomeA is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertEquals(1, coordinator.state.items.size)
        assertEquals(10, coordinator.state.total)
        assertFalse(coordinator.state.loading)

        // Switch to account B
        val queryB = TransactionQuery(accountId = "acc-B", page = 0)
        coordinator.startLoad(queryB)

        // In that very moment, old items and total must be immediately isolated
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)
        assertFalse(coordinator.state.totalKnown)
        assertTrue(coordinator.state.loading)
        assertNull(coordinator.state.error)
        assertEquals("acc-B", coordinator.state.currentQuery.accountId)
    }

    @Test
    fun crossPageChangeClearsItemsAndTotalImmediately() {
        val coordinator = TransactionLoadCoordinator()
        val queryP0 = TransactionQuery(accountId = "acc-A", page = 0)
        val genP0 = coordinator.startLoad(queryP0)

        val item1 = JSONObject().put("id", "tx-1").put("amountCents", 1000L)
        coordinator.onLoadSuccess(genP0, queryP0, listOf(item1), total = 75)
        assertEquals(1, coordinator.state.items.size)
        assertEquals(75, coordinator.state.total)

        // User navigates to page 1
        val queryP1 = TransactionQuery(accountId = "acc-A", page = 1)
        coordinator.startLoad(queryP1)

        // Both items and total must be cleared immediately when flipping pages!
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)
        assertFalse(coordinator.state.totalKnown)
        assertTrue(coordinator.state.loading)
    }

    @Test
    fun sameScopeRefreshRetainsPreviousResultsDuringLoad() {
        val coordinator = TransactionLoadCoordinator()
        val query = TransactionQuery(accountId = "acc-A", page = 0)
        val gen1 = coordinator.startLoad(query)

        val item1 = JSONObject().put("id", "tx-1").put("amountCents", 1000L)
        coordinator.onLoadSuccess(gen1, query, listOf(item1), total = 1)
        assertEquals(1, coordinator.state.items.size)
        assertEquals(1, coordinator.state.total)

        // Same exact query refresh
        val gen2 = coordinator.startLoad(query)
        // Previous results retained during loading
        assertEquals(1, coordinator.state.items.size)
        assertEquals(1, coordinator.state.total)
        assertTrue(coordinator.state.loading)

        // If refresh fails with error
        val errorApplied = coordinator.onLoadError(gen2, query, "网络连接超时")
        assertTrue(errorApplied)
        // Items and total are still retained so user can see last known good data
        assertEquals(1, coordinator.state.items.size)
        assertEquals(1, coordinator.state.total)
        assertFalse(coordinator.state.loading)
        assertEquals("网络连接超时", coordinator.state.error)
    }

    @Test
    fun raceCondition_ABA_OldSuccessAndErrorAndFinallyRejected() {
        val coordinator = TransactionLoadCoordinator()
        val queryA = TransactionQuery(accountId = "acc-A", page = 0)
        val queryB = TransactionQuery(accountId = "acc-B", page = 0)

        val gen1 = coordinator.startLoad(queryA)
        val gen2 = coordinator.startLoad(queryB)
        val gen3 = coordinator.startLoad(queryA)

        assertEquals(3L, coordinator.currentGeneration())

        // 1. Stale gen1 success should be rejected
        val itemA1 = JSONObject().put("id", "tx-a1")
        val outcome1 = coordinator.onLoadSuccess(gen1, queryA, listOf(itemA1), total = 5)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale, outcome1)
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)

        // 2. Stale gen2 error should be rejected
        val error2Applied = coordinator.onLoadError(gen2, queryB, "Server error on B")
        assertFalse(error2Applied)
        assertNull(coordinator.state.error)

        // 3. Stale gen2 finally should not drop loading state
        coordinator.onLoadFinally(gen2, queryB)
        assertTrue(coordinator.state.loading)

        // 4. Active gen3 success should be applied
        val itemA3 = JSONObject().put("id", "tx-a3")
        val outcome3 = coordinator.onLoadSuccess(gen3, queryA, listOf(itemA3), total = 20)
        assertTrue(outcome3 is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertEquals(1, coordinator.state.items.size)
        assertEquals("tx-a3", coordinator.state.items[0].optString("id"))
        assertEquals(20, coordinator.state.total)
        assertFalse(coordinator.state.loading)
        assertNull(coordinator.state.error)
    }

    @Test
    fun queryMismatchRejectsEvenIfGenMatches() {
        val coordinator = TransactionLoadCoordinator()
        val queryA = TransactionQuery(accountId = "acc-A", page = 0)
        val gen = coordinator.startLoad(queryA)

        // Fabricate a mismatched query with same gen
        val mismatchedQuery = TransactionQuery(accountId = "acc-B", page = 0)
        val outcome = coordinator.onLoadSuccess(gen, mismatchedQuery, listOf(JSONObject()), 1)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale, outcome)
        assertTrue(coordinator.state.items.isEmpty())

        val errorApplied = coordinator.onLoadError(gen, mismatchedQuery, "Error")
        assertFalse(errorApplied)
        assertNull(coordinator.state.error)

        coordinator.onLoadFinally(gen, mismatchedQuery)
        assertTrue(coordinator.state.loading)
    }

    @Test
    fun mixedPageAndRefreshOrdering() {
        val coordinator = TransactionLoadCoordinator()
        val page1 = TransactionQuery(accountId = "acc-1", page = 1)
        val page2 = TransactionQuery(accountId = "acc-1", page = 2)

        val genP1 = coordinator.startLoad(page1)
        val genP2 = coordinator.startLoad(page2)

        // Late response from page 1 must be rejected
        val p1Items = listOf(JSONObject().put("id", "tx-p1"))
        val outcomeP1 = coordinator.onLoadSuccess(genP1, page1, p1Items, total = 120)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale, outcomeP1)

        // Response from page 2 accepted
        val p2Items = listOf(JSONObject().put("id", "tx-p2"))
        val outcomeP2 = coordinator.onLoadSuccess(genP2, page2, p2Items, total = 120)
        assertTrue(outcomeP2 is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertEquals(2, coordinator.state.loadedQuery?.page)
        assertEquals(1, coordinator.state.items.size)
        assertEquals("tx-p2", coordinator.state.items[0].optString("id"))
    }

    @Test
    fun interleavedPageRefreshAndAccountSwitchWithRetry() {
        // Interleaving: A page 2 (gen 1) -> A refresh (gen 2) -> B page 0 (gen 3) -> B retry (gen 4)
        val coordinator = TransactionLoadCoordinator()
        val queryAPage2 = TransactionQuery(accountId = "acc-A", page = 2)
        val queryBPage0 = TransactionQuery(accountId = "acc-B", page = 0)

        val gen1 = coordinator.startLoad(queryAPage2)
        val gen2 = coordinator.startLoad(queryAPage2) // same query refresh
        val gen3 = coordinator.startLoad(queryBPage0) // switch to B page 0
        val gen4 = coordinator.startLoad(queryBPage0) // retry B page 0

        assertEquals(4L, coordinator.currentGeneration())
        assertTrue(coordinator.state.loading)
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)

        // Gen 1 (A page 2) late success rejected
        val itemA2 = listOf(JSONObject().put("id", "tx-a-p2"))
        val outcome1 = coordinator.onLoadSuccess(gen1, queryAPage2, itemA2, 120)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale, outcome1)

        // Gen 2 (A refresh) error rejected
        val error2Applied = coordinator.onLoadError(gen2, queryAPage2, "Network timeout on A")
        assertFalse(error2Applied)
        coordinator.onLoadFinally(gen2, queryAPage2)
        assertTrue(coordinator.state.loading)
        assertNull(coordinator.state.error)

        // Gen 3 (B page 0) late success rejected
        val itemB3 = listOf(JSONObject().put("id", "tx-b-stale"))
        val outcome3 = coordinator.onLoadSuccess(gen3, queryBPage0, itemB3, 50)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale, outcome3)
        coordinator.onLoadFinally(gen3, queryBPage0)
        assertTrue(coordinator.state.loading)

        // Gen 4 (B retry) success applied!
        val itemB4 = listOf(JSONObject().put("id", "tx-b-p0"))
        val outcome4 = coordinator.onLoadSuccess(gen4, queryBPage0, itemB4, 50)
        assertTrue(outcome4 is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertEquals(1, coordinator.state.items.size)
        assertEquals("tx-b-p0", coordinator.state.items[0].optString("id"))
        assertEquals(50, coordinator.state.total)
        assertFalse(coordinator.state.loading)
        assertNull(coordinator.state.error)
        assertEquals("acc-B", coordinator.state.loadedQuery?.accountId)
        assertEquals(0, coordinator.state.loadedQuery?.page)
    }

    @Test
    fun trailingPageCorrection_CalculatesCorrectTargetPage() {
        // Page 2 has offset 100 with pageSize 50.
        // Total has shrunk to 60 (valid pages are 0 and 1).
        // Page 2 returns 0 items.
        val corrected = TransactionQueryHelper.calculatePageCorrection(
            page = 2,
            pageSize = 50,
            total = 60,
            itemCount = 0,
        )
        assertEquals(1, corrected)

        // Page 1 with 10 items is valid -> no correction
        assertNull(TransactionQueryHelper.calculatePageCorrection(page = 1, pageSize = 50, total = 60, itemCount = 10))

        // Page 0 with 0 items and 0 total -> no correction
        assertNull(TransactionQueryHelper.calculatePageCorrection(page = 0, pageSize = 50, total = 0, itemCount = 0))

        // In coordinator:
        val coordinator = TransactionLoadCoordinator()
        val query = TransactionQuery(page = 2, pageSize = 50)
        val gen = coordinator.startLoad(query)
        val outcome = coordinator.onLoadSuccess(gen, query, emptyList(), total = 60)
        assertTrue(outcome is TransactionLoadCoordinator.LoadResultOutcome.PageCorrectionRequired)
        val correctedPage = (outcome as TransactionLoadCoordinator.LoadResultOutcome.PageCorrectionRequired).correctedPage
        assertEquals(1, correctedPage)
        assertNull(coordinator.state.loadedQuery) // Not committed as loaded query yet

        // Page correction initiates new generation for corrected page
        val correctedQuery = query.copy(page = correctedPage)
        val newGen = coordinator.startLoad(correctedQuery)
        assertTrue(coordinator.state.loading)

        // Previous try-finally for the old generation MUST NOT stop loading on the new generation
        val oldFinallyResult = coordinator.onLoadFinally(gen, query)
        assertFalse(oldFinallyResult)
        assertTrue(coordinator.state.loading)

        // New generation finishes successfully
        val page1Items = listOf(JSONObject().put("id", "tx-p1"))
        val successOutcome = coordinator.onLoadSuccess(newGen, correctedQuery, page1Items, 60)
        assertTrue(successOutcome is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertFalse(coordinator.state.loading)
        coordinator.onLoadFinally(newGen, correctedQuery)
        assertFalse(coordinator.state.loading)
    }

    @Test
    fun metadataIndependence_AccountsLoadedEvenWhenOtherMetadataFails() {
        val metaCoord = TransactionMetadataCoordinator()

        // Accounts start loading
        val accGen = metaCoord.startAccountsLoad()
        // Other metadata (categories/tags) start loading
        val otherGen = metaCoord.startOtherMetadataLoad()

        // Categories/tags fail with 500 error
        val otherFailed = metaCoord.onOtherMetadataError(otherGen, "Categories 500 error")
        assertTrue(otherFailed)
        assertEquals("Categories 500 error", metaCoord.state.metadataError)
        assertFalse(metaCoord.state.metadataLoading)

        // Accounts succeed!
        val accSucceeded = metaCoord.onAccountsSuccess(accGen, mapOf("acc-wx" to "微信支付"))
        assertTrue(accSucceeded)
        assertEquals("微信支付", metaCoord.state.accountNames["acc-wx"])
        assertNull(metaCoord.state.accountsError)
        assertFalse(metaCoord.state.accountsLoading)

        // Next, if accounts refresh fails:
        val accGen2 = metaCoord.startAccountsLoad()
        metaCoord.onAccountsError(accGen2, "Accounts 503")
        assertEquals("Accounts 503", metaCoord.state.accountsError)
        // Existing accounts MUST be retained!
        assertEquals("微信支付", metaCoord.state.accountNames["acc-wx"])
    }
}
