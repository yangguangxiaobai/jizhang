package com.yansuu1.jizhang.ui.feature.imports

import com.yansuu1.jizhang.net.ApiRequestIdentity
import com.yansuu1.jizhang.ui.FinancialScope
import com.yansuu1.jizhang.ui.SelectedDocument

/**
 * 导入所有权键：绑定用户财务作用域、网络请求代次、进入来源与入口会话 ID。
 */
internal data class PlatformImportOwnerKey(
    val scope: FinancialScope,
    val identity: ApiRequestIdentity,
    val source: PlatformImportSource,
    val entryConversationId: String?,
)

/**
 * 工作区持久引用：将活跃导入批次严格绑定至创建它的所有者与协议会话 ID。
 */
internal data class PlatformImportWorkspaceRef(
    val owner: PlatformImportOwnerKey,
    val conversationId: String,
    val batchId: String,
)

/**
 * 未决批次启动快照：锁定同一次启动请求的 owner、会话、幂等键与文件原件。
 */
internal data class PendingPlatformImportStart(
    val owner: PlatformImportOwnerKey,
    val conversationId: String?,
    val clientRequestId: String,
    val files: List<SelectedDocument>,
) {
    fun matches(otherOwner: PlatformImportOwnerKey): Boolean =
        owner == otherOwner

    fun matchesSameRequest(otherOwner: PlatformImportOwnerKey, requestedFiles: List<SelectedDocument>): Boolean =
        matches(otherOwner) && files.haveSameContentAs(requestedFiles)
}

/** A ticket is bound to one owner and protocol conversation, not just a repeated ID. */
internal data class PlatformImportRequestTicket(
    val lane: String,
    val owner: PlatformImportOwnerKey,
    val conversationId: String?,
    val generation: Long,
)

/** Volatile operation gate; invalidation rejects stale same-owner and A→B→A completions. */
internal class PlatformImportRequestGate {
    private var nextGeneration = 0L
    private val active = mutableMapOf<String, PlatformImportRequestTicket>()

    fun begin(lane: String, owner: PlatformImportOwnerKey, conversationId: String?): PlatformImportRequestTicket =
        PlatformImportRequestTicket(lane, owner, conversationId, ++nextGeneration).also { active[lane] = it }

    fun accepts(
        ticket: PlatformImportRequestTicket,
        currentOwner: PlatformImportOwnerKey,
        currentConversationId: String?,
    ): Boolean =
        ticket.owner == currentOwner &&
            ticket.conversationId == currentConversationId &&
            active[ticket.lane] == ticket

    fun invalidate() {
        active.clear()
        nextGeneration++
    }
}

internal fun List<SelectedDocument>.haveSameContentAs(other: List<SelectedDocument>): Boolean =
    size == other.size && indices.all { index ->
        val left = this[index]
        val right = other[index]
        left.name == right.name && left.bytes.contentEquals(right.bytes)
    }

/**
 * 校验给定的工作区引用是否属于当前所有者。
 */
internal fun PlatformImportWorkspaceRef.isCurrentFor(currentOwner: PlatformImportOwnerKey): Boolean =
    owner == currentOwner

/**
 * 判断当前批次是否支持显式触发可选的 AI 整理。
 * 条件：
 * 1. 批次分析状态处于 idle 或明确 failed（不处于 running 或已完成 complete）。
 * 2. 批次本身可变（state != confirmed 且 state != closed）。
 * 3. 内存中具有完整的原件文件。
 * 4. AI Provider 已配置且可用。
 */
internal fun canTriggerOptionalAiAnalysis(
    analysisState: String?,
    batchState: String?,
    hasMemoryFiles: Boolean,
    providerEnabled: Boolean = true,
): Boolean {
    if (!hasMemoryFiles || !providerEnabled) return false
    if (batchState == "confirmed" || batchState == "closed") return false
    return analysisState == "idle" || analysisState == "failed"
}
