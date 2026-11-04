package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialPlanInputs
import com.yansuu1.jizhang.repo.FinancialPlanSaveRequest
import com.yansuu1.jizhang.repo.SavedFinancialPlan

/**
 * Production WorkOwner / Session Guard for Four-Purpose Financial Plan.
 *
 * Guarantees:
 * - Synchronous re-entry rejection: prevents concurrent loads, previews, or saves.
 * - BaseUrl and Generation validation: ensures responses from old server endpoints
 *   or stale requests are rejected upon arrival.
 * - Strict revision validation: on save / idempotent replay, verifies returned inputs
 *   match submitted inputs, and returned revision strictly equals expectedRevision + 1.
 * - Non-destructive draft and retained-save lifecycle: uncertain requests are not
 *   silently discarded on routine reloads.
 */
class FinancialPlanWorkOwner {

    enum class ActionKind {
        LOAD,
        PREVIEW,
        SAVE,
    }

    data class Ticket(
        val generation: Long,
        val kind: ActionKind,
        val baseUrl: String,
        val saveRequest: FinancialPlanSaveRequest? = null,
        val previewInputs: FinancialPlanInputs? = null,
    )

    private var currentGeneration = 0L
    private var activeTicket: Ticket? = null
    private var isDisposed = false

    val isBusy: Boolean
        get() = activeTicket != null && !isDisposed

    val activeKind: ActionKind?
        get() = activeTicket?.takeUnless { isDisposed }?.kind

    @Synchronized
    fun startLoad(baseUrl: String): Ticket? {
        if (isDisposed || activeTicket != null) return null
        require(baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        val ticket = Ticket(
            generation = ++currentGeneration,
            kind = ActionKind.LOAD,
            baseUrl = baseUrl,
        )
        activeTicket = ticket
        return ticket
    }

    @Synchronized
    fun startPreview(inputs: FinancialPlanInputs, baseUrl: String): Ticket? {
        if (isDisposed || activeTicket != null) return null
        require(baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        val ticket = Ticket(
            generation = ++currentGeneration,
            kind = ActionKind.PREVIEW,
            baseUrl = baseUrl,
            previewInputs = inputs,
        )
        activeTicket = ticket
        return ticket
    }

    @Synchronized
    fun startSave(request: FinancialPlanSaveRequest, baseUrl: String): Ticket? {
        if (isDisposed || activeTicket != null) return null
        require(baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        val ticket = Ticket(
            generation = ++currentGeneration,
            kind = ActionKind.SAVE,
            baseUrl = baseUrl,
            saveRequest = request,
        )
        activeTicket = ticket
        return ticket
    }

    @Synchronized
    fun owns(ticket: Ticket?, currentBaseUrl: String): Boolean {
        if (ticket == null || isDisposed) return false
        if (activeTicket != ticket) return false
        return ticket.baseUrl == currentBaseUrl
    }

    @Synchronized
    fun finish(ticket: Ticket?) {
        if (ticket != null && activeTicket == ticket) {
            activeTicket = null
        }
    }

    @Synchronized
    fun dispose() {
        isDisposed = true
        activeTicket = null
    }

    companion object {
        /**
         * Validates save response integrity per contract:
         * 1) Returned inputs match submitted inputs.
         * 2) Returned revision strictly advances by 1 (expectedRevision + 1).
         */
        fun validateSaveResult(submitted: FinancialPlanSaveRequest, returned: SavedFinancialPlan) {
            require(returned.inputs == submitted.toInputs()) {
                "服务端返回的方案参数与提交内容不符"
            }
            val expectedNext = submitted.expectedRevision + 1L
            require(returned.revision == expectedNext) {
                "服务端返回版本号异常：期望 $expectedNext，实际 ${returned.revision}"
            }
        }
    }
}
