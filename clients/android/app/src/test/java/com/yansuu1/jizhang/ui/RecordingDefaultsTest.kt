package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 账户默认值解析的 JVM 回归测试（C1-05 / C1-06）。
 * 只覆盖纯函数与偏好键隔离；真实表单交互仍需设备验收。
 */
class RecordingDefaultsTest {

    private val active = listOf("acc-a", "acc-b")

    @Test
    fun rememberedActiveAccountIsReused() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-b",
            activeAccountIds = active,
            refundAccountId = null,
        )
        assertEquals("acc-b", result.accountId)
        assertNull(result.error)
    }

    @Test
    fun rememberedDeletedAccountFallsBackToFirstActive() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-deleted",
            activeAccountIds = active,
            refundAccountId = null,
        )
        assertEquals("acc-a", result.accountId)
        assertNull(result.error)
    }

    @Test
    fun noRememberedAccountUsesFirstActive() {
        val result = resolveRecordingAccount(
            lastAccountId = null,
            activeAccountIds = active,
            refundAccountId = null,
        )
        assertEquals("acc-a", result.accountId)
        assertNull(result.error)
    }

    @Test
    fun blankRememberedAccountUsesFirstActive() {
        val result = resolveRecordingAccount(
            lastAccountId = "  ",
            activeAccountIds = active,
            refundAccountId = null,
        )
        assertEquals("acc-a", result.accountId)
        assertNull(result.error)
    }

    @Test
    fun emptyActiveListBlocksWithCreateAccountError() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-a",
            activeAccountIds = emptyList(),
            refundAccountId = null,
        )
        assertNull(result.accountId)
        assertEquals(NO_ACTIVE_RECORDING_ACCOUNT_ERROR, result.error)
        assertEquals("请先创建或选择一个账户", result.error)
    }

    @Test
    fun refundAccountStillActiveIsKept() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-a",
            activeAccountIds = active,
            refundAccountId = "acc-b",
        )
        assertEquals("acc-b", result.accountId)
        assertNull(result.error)
    }

    @Test
    fun refundAccountDeletedIsBlockedInsteadOfSwitchingAccounts() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-a",
            activeAccountIds = active,
            refundAccountId = "acc-deleted",
        )
        assertNull(result.accountId)
        assertEquals(TransactionEditorHelper.REFUND_ACCOUNT_UNAVAILABLE_ERROR, result.error)
    }

    @Test
    fun blankRefundAccountIsBlockedInsteadOfUsingRememberedAccount() {
        val result = resolveRecordingAccount(
            lastAccountId = "acc-a",
            activeAccountIds = active,
            refundAccountId = "",
        )
        assertNull(result.accountId)
        assertEquals(TransactionEditorHelper.REFUND_ACCOUNT_UNAVAILABLE_ERROR, result.error)
    }

    @Test
    fun refundWithoutActiveAccountsStillReportsRefundAccountError() {
        val result = resolveRecordingAccount(
            lastAccountId = null,
            activeAccountIds = emptyList(),
            refundAccountId = "acc-deleted",
        )
        assertNull(result.accountId)
        assertEquals(TransactionEditorHelper.REFUND_ACCOUNT_UNAVAILABLE_ERROR, result.error)
    }

    @Test
    fun preferenceKeyIsScopedByServerAndUsername() {
        val base = RecordingAccountPrefs.keyFor("https://jz.example.com", "UserA")
        val otherUser = RecordingAccountPrefs.keyFor("https://jz.example.com", "UserB")
        val otherServer = RecordingAccountPrefs.keyFor("https://other.example.com", "UserA")
        val normalized = RecordingAccountPrefs.keyFor("https://JZ.example.com/", "UserA")
        val lowerUser = RecordingAccountPrefs.keyFor("https://jz.example.com", "usera")

        assertNotEquals("换用户不能沿用同一默认账户", base, otherUser)
        assertNotEquals("换服务器不能沿用同一默认账户", base, otherServer)
        assertNotEquals("用户名区分大小写", base, lowerUser)
        assertEquals("同一服务器地址的写法差异应归一化", base, normalized)
        assertTrue(base.startsWith("recording_account_"))
        assertNotEquals(FinancialPrefs.prefKeyForUser("https://jz.example.com", "UserA"), base)
    }
}
