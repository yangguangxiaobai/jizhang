package com.yansuu1.jizhang.ui

/** A detail response can publish only for the latest requested transaction and attempt. */
class TransactionDetailLoadOwner {
    data class Ticket(val transactionId: String, val generation: Long)
    private var generation = 0L
    private var active: Ticket? = null

    fun start(transactionId: String): Ticket {
        require(transactionId.isNotBlank())
        return Ticket(transactionId, ++generation).also { active = it }
    }

    fun owns(ticket: Ticket): Boolean = ticket == active
}
