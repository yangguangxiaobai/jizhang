package com.yansuu1.jizhang.ui.feature.imports

import com.yansuu1.jizhang.net.ApiRequestIdentity
import com.yansuu1.jizhang.ui.FinancialScope
import com.yansuu1.jizhang.ui.SelectedDocument
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatformImportStateTest {

    private val baseScope = FinancialScope("https://example.com", "alice")
    private val baseIdentity = ApiRequestIdentity("https://example.com", 1L)
    private val baseOwner = PlatformImportOwnerKey(
        scope = baseScope,
        identity = baseIdentity,
        source = PlatformImportSource.DATA,
        entryConversationId = "conv-entry-1",
    )

    @Test
    fun workspaceRef_isCurrentFor_onlyMatchesExactOwner() {
        val ref = PlatformImportWorkspaceRef(
            owner = baseOwner,
            conversationId = "conv-protocol-1",
            batchId = "batch-1",
        )

        // 1. 完全一致的所有者
        assertTrue("同 scope、identity、source 和 entryConversationId 时所有者应匹配", ref.isCurrentFor(baseOwner))

        // 2. 财务作用域不匹配（服务器地址不同）
        val diffServer = baseOwner.copy(scope = FinancialScope("https://other.com", "alice"))
        assertFalse("服务端地址不同时所有权不匹配", ref.isCurrentFor(diffServer))

        // 3. 财务作用域不匹配（用户名不同）
        val diffUser = baseOwner.copy(scope = FinancialScope("https://example.com", "bob"))
        assertFalse("用户不同时所有权不匹配", ref.isCurrentFor(diffUser))

        // 4. 网络请求代次不同（用户退出/重新登录等）
        val diffGeneration = baseOwner.copy(identity = ApiRequestIdentity("https://example.com", 2L))
        assertFalse("网络请求代次变化时所有权不匹配", ref.isCurrentFor(diffGeneration))

        // 5. 网络请求基础 URL 不同
        val diffIdentityBase = baseOwner.copy(identity = ApiRequestIdentity("https://other.com", 1L))
        assertFalse("网络请求 BaseUrl 变化时所有权不匹配", ref.isCurrentFor(diffIdentityBase))

        // 6. 入口来源不同（DATA vs ASSISTANT）
        val diffSource = baseOwner.copy(source = PlatformImportSource.ASSISTANT)
        assertFalse("入口来源不同时所有权不匹配", ref.isCurrentFor(diffSource))

        // 7. 入口会话 ID 不同
        val diffEntryConv = baseOwner.copy(entryConversationId = "conv-entry-2")
        assertFalse("入口会话 ID 不同时所有权不匹配", ref.isCurrentFor(diffEntryConv))

        val nullEntryConv = baseOwner.copy(entryConversationId = null)
        assertFalse("入口会话 ID 缺失与存在时所有权不匹配", ref.isCurrentFor(nullEntryConv))
    }

    @Test
    fun pendingStart_matches_strictlyChecksExactOwnerIncludingAtoBtoA() {
        val files = listOf(SelectedDocument("bill.csv", byteArrayOf(1, 2, 3)))
        val pending = PendingPlatformImportStart(
            owner = baseOwner,
            conversationId = "conv-protocol-1",
            clientRequestId = "req-1",
            files = files,
        )

        // 1. 同一代次与同所有者
        assertTrue(pending.matches(baseOwner))

        // 2. 用户切换至账号 B（generation 2）
        val scopeB = FinancialScope("https://example.com", "bob")
        val identityB = ApiRequestIdentity("https://example.com", 2L)
        val ownerB = PlatformImportOwnerKey(
            scope = scopeB,
            identity = identityB,
            source = PlatformImportSource.DATA,
            entryConversationId = "conv-entry-1",
        )
        assertFalse("切到账号 B 时原 pending 不应匹配", pending.matches(ownerB))

        // 3. 用户切回账号 A（A -> B -> A），此时生成了新的代次 3L
        val identityA3 = ApiRequestIdentity("https://example.com", 3L)
        val ownerA3 = PlatformImportOwnerKey(
            scope = baseScope,
            identity = identityA3,
            source = PlatformImportSource.DATA,
            entryConversationId = "conv-entry-1",
        )
        assertFalse("A -> B -> A 代次更新后，不能因文本用户名/会话一致而接受旧未决", pending.matches(ownerA3))
    }

    @Test
    fun canTriggerOptionalAiAnalysis_permitsOnlyIdleOrFailedOnMutableBatchWithFilesAndProvider() {
        // 允许触发：可变批次、内存原件在、provider 可用、处于 idle 或 failed
        assertTrue(canTriggerOptionalAiAnalysis(analysisState = "idle", batchState = "open", hasMemoryFiles = true, providerEnabled = true))
        assertTrue(canTriggerOptionalAiAnalysis(analysisState = "failed", batchState = "open", hasMemoryFiles = true, providerEnabled = true))
        assertTrue(canTriggerOptionalAiAnalysis(analysisState = "idle", batchState = "reviewing", hasMemoryFiles = true, providerEnabled = true))
        assertTrue(canTriggerOptionalAiAnalysis(analysisState = "failed", batchState = null, hasMemoryFiles = true, providerEnabled = true))

        // 拒绝：正在运行或已完成分析
        assertFalse("已处于 running 状态不能重复触发", canTriggerOptionalAiAnalysis("running", "open", hasMemoryFiles = true, providerEnabled = true))
        assertFalse("已处于 complete 状态不能重复触发", canTriggerOptionalAiAnalysis("complete", "open", hasMemoryFiles = true, providerEnabled = true))
        assertFalse("analysisState 为 null 时不能触发", canTriggerOptionalAiAnalysis(null, "open", hasMemoryFiles = true, providerEnabled = true))
        assertFalse("未知 analysisState 不能触发", canTriggerOptionalAiAnalysis("unknown", "open", hasMemoryFiles = true, providerEnabled = true))

        // 拒绝：批次已确认或已关闭（不可变）
        assertFalse("批次已 confirmed 时不能触发分析", canTriggerOptionalAiAnalysis("idle", "confirmed", hasMemoryFiles = true, providerEnabled = true))
        assertFalse("批次已 closed 时不能触发分析", canTriggerOptionalAiAnalysis("failed", "closed", hasMemoryFiles = true, providerEnabled = true))

        // 拒绝：内存中缺少原件文件
        assertFalse("内存原件不存在时不能调用 AI", canTriggerOptionalAiAnalysis("idle", "open", hasMemoryFiles = false, providerEnabled = true))
        assertFalse("内存原件不存在时即使 failed 也不能调用 AI", canTriggerOptionalAiAnalysis("failed", "open", hasMemoryFiles = false, providerEnabled = true))

        // 拒绝：AI Provider 未启用或不可用
        assertFalse("Provider 未启用时不能触发 AI", canTriggerOptionalAiAnalysis("idle", "open", hasMemoryFiles = true, providerEnabled = false))
        assertFalse("Provider 未启用时即使 failed 也不能触发 AI", canTriggerOptionalAiAnalysis("failed", "open", hasMemoryFiles = true, providerEnabled = false))
    }

    @Test
    fun pendingStart_reusesRequestIdOnlyForExactOrderedFileBytes() {
        val files = listOf(
            SelectedDocument("first.csv", byteArrayOf(1, 2, 3)),
            SelectedDocument("second.xlsx", byteArrayOf(4, 5, 6)),
        )
        val pending = PendingPlatformImportStart(baseOwner, null, "req-stable", files)

        assertTrue(pending.matchesSameRequest(baseOwner, listOf(
            SelectedDocument("first.csv", byteArrayOf(1, 2, 3)),
            SelectedDocument("second.xlsx", byteArrayOf(4, 5, 6)),
        )))
        assertFalse("同 key 不可替换原件 bytes", pending.matchesSameRequest(baseOwner, listOf(
            SelectedDocument("first.csv", byteArrayOf(1, 2, 9)),
            SelectedDocument("second.xlsx", byteArrayOf(4, 5, 6)),
        )))
        assertFalse("同 key 不可改文件顺序", pending.matchesSameRequest(baseOwner, files.reversed()))
        assertFalse("同 key 不可改文件名", pending.matchesSameRequest(baseOwner, listOf(
            SelectedDocument("renamed.csv", byteArrayOf(1, 2, 3)),
            files[1],
        )))
    }

    @Test
    fun requestGateRejectsChangedConversationOwnerAndInvalidatedTickets() {
        val gate = PlatformImportRequestGate()
        val ticket = gate.begin("batch-start", baseOwner, "conv-protocol-1")
        assertTrue(gate.accepts(ticket, baseOwner, "conv-protocol-1"))
        assertFalse(gate.accepts(ticket, baseOwner, "conv-protocol-2"))
        assertFalse(gate.accepts(ticket, baseOwner.copy(identity = ApiRequestIdentity("https://example.com", 2L)), "conv-protocol-1"))

        val newer = gate.begin("batch-start", baseOwner, "conv-protocol-1")
        assertFalse("同 lane 的旧 ticket 不能被 A→B→A 后接受", gate.accepts(ticket, baseOwner, "conv-protocol-1"))
        assertTrue(gate.accepts(newer, baseOwner, "conv-protocol-1"))
        gate.invalidate()
        assertFalse("dispose/session invalidation 后 ticket 不再有效", gate.accepts(newer, baseOwner, "conv-protocol-1"))
    }
}
