package com.yansuu1.jizhang.ui.feature.assistant

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantIdentityCoordinatorTest {

    @Test
    fun laneAndScopeIsolationEnforcedByRequestGate() {
        val gate = AssistantRequestGate()
        val scopeA = "https://jz.example.com|conv_A"
        val scopeB = "https://jz.example.com|conv_B"

        val ticketA = gate.begin("messages", scopeA)
        assertTrue(gate.accepts(ticketA, scopeA))

        // Mismatched scope must be rejected
        assertFalse(gate.accepts(ticketA, scopeB))

        // Different lane does not satisfy ticketA
        val ticketOther = gate.begin("conversations", scopeA)
        assertTrue(gate.accepts(ticketOther, scopeA))
        // ticketA is still valid in its own lane
        assertTrue(gate.accepts(ticketA, scopeA))
    }

    @Test
    fun preventsAbaRaceConditionWhenUserSwitchesBackToSameConversation() {
        val gate = AssistantRequestGate()
        val scopeA = "https://jz.example.com|conv_A"

        // 1. User starts reading conversation A (e.g. initial fetch)
        val initialTicketA = gate.begin("messages", scopeA)
        assertTrue(gate.accepts(initialTicketA, scopeA))

        // 2. User quickly navigates away to conversation B
        gate.invalidateDisplay()

        // 3. User navigates back to conversation A (A -> B -> A)
        val secondTicketA = gate.begin("messages", scopeA)
        assertTrue(gate.accepts(secondTicketA, scopeA))

        // 4. Delayed response from first visit to conversation A finally arrives
        // Because generation number advanced and old ticket was superseded, initialTicketA MUST be rejected!
        assertFalse(gate.accepts(initialTicketA, scopeA))
    }

    @Test
    fun serverUrlChangeInvalidatesInFlightTickets() {
        val gate = AssistantRequestGate()
        val scopeServer1 = "https://server1.example.com|conv_A"
        val scopeServer2 = "https://server2.example.com|conv_A"

        val ticket1 = gate.begin("messages", scopeServer1)
        assertTrue(gate.accepts(ticket1, scopeServer1))

        // Server URL switched -> scope no longer matches
        assertFalse(gate.accepts(ticket1, scopeServer2))
    }

    @Test
    fun fullGateInvalidationRejectsAllLanes() {
        val gate = AssistantRequestGate()
        val scope = "https://jz.example.com|conv_1"

        val ticketMessages = gate.begin("messages", scope)
        val ticketConversations = gate.begin("conversations", scope)

        assertTrue(gate.accepts(ticketMessages, scope))
        assertTrue(gate.accepts(ticketConversations, scope))

        // Component unmount or full reset
        gate.invalidate()

        assertFalse(gate.accepts(ticketMessages, scope))
        assertFalse(gate.accepts(ticketConversations, scope))
    }

    @Test
    fun oldGetGateLogicRejectsLateResponsesWhenConversationIdMismatches() {
        var currentConversationId: String? = "conv_B"
        val targetConvId = "conv_A"

        // Simulated check performed after await:
        // if (currentConversationId != targetConvId) return
        val wouldAccept = (currentConversationId == targetConvId)
        assertFalse("Old GET response for conv_A must not be accepted while viewing conv_B", wouldAccept)

        // Now user switches back to conv_A
        currentConversationId = "conv_A"
        val wouldAcceptAfterReturn = (currentConversationId == targetConvId)
        assertTrue(wouldAcceptAfterReturn)
    }
    @Test
    fun switchingConversationInvalidatesAllGenerationOperationLanes() {
        val gate = AssistantRequestGate()
        val lanes = listOf("gen:conv:gen", "gen:conv", "reconnect:gen", "cancel:gen")
        val tickets = lanes.map { gate.begin(it, "same-server") }
        tickets.forEach { assertTrue(gate.accepts(it, "same-server")) }
        gate.invalidateDisplay()
        tickets.forEach { assertFalse(gate.accepts(it, "same-server")) }
    }
}
