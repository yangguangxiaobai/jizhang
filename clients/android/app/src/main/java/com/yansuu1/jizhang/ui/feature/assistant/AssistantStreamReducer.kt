package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.repo.AssistantGenerationEvent
import com.yansuu1.jizhang.repo.Clarification
import com.yansuu1.jizhang.repo.GenerationError
import com.yansuu1.jizhang.repo.GenerationSnapshot
import com.yansuu1.jizhang.repo.extractClarification
import org.json.JSONObject

/**
 * Visual lifecycle state for an active streaming generation turn (Ardot AI14–AI18).
 */
enum class StreamVisualState {
    /** Request sent, waiting for connection or first event. */
    CONNECTING,
    /** Real deltas / events arriving, provisional growing bubble rendering. */
    RECEIVING,
    /** Clarification question presented; awaiting user single-select or free text choice. */
    AWAITING_CHOICE,
    /** Action / ledger proposal generated; awaiting human confirmation (never automatic). */
    PENDING_FINANCIAL_CONFIRM,
    /** Generation completed with answer; explicit visual indicator confirming no ledger booking. */
    ANSWERED,
    /** Generation terminated with server or provider failure. */
    FAILED,
    /** Generation explicitly cancelled by user (Stop button). */
    CANCELLED,
    /** Stream interrupted or disconnected; reconciling via GET snapshot without rePOSTing model. */
    RECONCILE,
}

data class StreamProvisionalMessage(
    val messageId: String,
    val step: Int,
    val text: String,
    val validated: Boolean,
)

data class ActiveGenerationState(
    val generationId: String,
    val clientRequestId: String,
    val conversationId: String,
    val visualState: StreamVisualState = StreamVisualState.CONNECTING,
    val status: String = "accepted", // accepted | running | completed | failed | cancelled | interrupted
    val delivery: String = "stream", // stream | buffered
    val lastSeq: Long = 0L,
    val provisionalMessages: Map<String, StreamProvisionalMessage> = emptyMap(), // messageId -> provisional
    val validatedMessages: Map<String, JSONObject> = emptyMap(), // messageId -> final message
    val clarification: Clarification? = null,
    val outcome: String? = null,
    val error: GenerationError? = null,
    val userMessage: JSONObject? = null,
    val selectedOptionId: String? = null, // locks choices to prevent double submission
    val pendingChoiceRequestId: String? = null, // preserved across network uncertainty
    val requiresReconcile: Boolean = false,
)

object AssistantStreamReducer {

    fun initFromSnapshot(snapshot: GenerationSnapshot, clientRequestId: String): ActiveGenerationState {
        val provisionals = snapshot.partialMessages.associate { p ->
            p.messageId to StreamProvisionalMessage(p.messageId, p.step, p.text, p.validated)
        }
        val validated = snapshot.messages.associateBy { it.optString("id") }
        val clar = snapshot.messages.firstNotNullOfOrNull { extractClarification(it) }

        val visual = when (snapshot.status) {
            "completed" -> when (snapshot.outcome) {
                "awaiting-choice" -> StreamVisualState.AWAITING_CHOICE
                "pending-confirmation" -> StreamVisualState.PENDING_FINANCIAL_CONFIRM
                else -> StreamVisualState.ANSWERED
            }
            "failed" -> StreamVisualState.FAILED
            "cancelled" -> StreamVisualState.CANCELLED
            "interrupted" -> StreamVisualState.RECONCILE
            "running" -> StreamVisualState.RECEIVING
            else -> StreamVisualState.CONNECTING
        }

        return ActiveGenerationState(
            generationId = snapshot.id,
            clientRequestId = clientRequestId,
            conversationId = snapshot.conversationId,
            visualState = visual,
            status = snapshot.status,
            delivery = snapshot.delivery,
            lastSeq = snapshot.lastSeq,
            provisionalMessages = provisionals,
            validatedMessages = validated,
            clarification = clar,
            outcome = snapshot.outcome,
            error = snapshot.error,
            userMessage = snapshot.userMessage,
        )
    }

    fun reduceEvent(state: ActiveGenerationState, event: AssistantGenerationEvent): ActiveGenerationState {
        // Discard events for mismatched generation
        if (event.generationId != state.generationId) return state

        // Duplicate seq ignored per protocol-v1
        if (event.seq <= state.lastSeq) return state

        // Sequence gap detection: if seq jumps by more than 1, reconcile snapshot
        // (no first-seq exemption: gap seq > lastSeq + 1 triggers reconcile even when lastSeq == 0)
        if (event.seq > state.lastSeq + 1L) {
            return state.copy(
                requiresReconcile = true,
                visualState = StreamVisualState.RECONCILE,
            )
        }

        return when (event) {
            is AssistantGenerationEvent.State -> {
                val nextVisual = if (event.status == "running") StreamVisualState.RECEIVING else StreamVisualState.CONNECTING
                state.copy(
                    lastSeq = event.seq,
                    status = event.status,
                    visualState = if (state.visualState == StreamVisualState.CONNECTING) nextVisual else state.visualState,
                )
            }
            is AssistantGenerationEvent.TextDelta -> {
                val existing = state.provisionalMessages[event.messageId]
                val currentText = existing?.text.orEmpty()
                // Offset check: must equal accumulated length
                if (event.offset != currentText.length) {
                    return state.copy(
                        requiresReconcile = true,
                        visualState = StreamVisualState.RECONCILE,
                    )
                }
                val updated = StreamProvisionalMessage(
                    messageId = event.messageId,
                    step = event.step,
                    text = currentText + event.text,
                    validated = false,
                )
                state.copy(
                    lastSeq = event.seq,
                    provisionalMessages = state.provisionalMessages + (event.messageId to updated),
                    visualState = StreamVisualState.RECEIVING,
                )
            }
            is AssistantGenerationEvent.Message -> {
                val msgId = event.message.optString("id")
                val clar = extractClarification(event.message) ?: state.clarification
                state.copy(
                    lastSeq = event.seq,
                    provisionalMessages = state.provisionalMessages - msgId,
                    validatedMessages = state.validatedMessages + (msgId to event.message),
                    clarification = clar,
                )
            }
            is AssistantGenerationEvent.Terminal -> {
                val nextVisual = when (event.status) {
                    "completed" -> when (event.outcome) {
                        "awaiting-choice" -> StreamVisualState.AWAITING_CHOICE
                        "pending-confirmation" -> StreamVisualState.PENDING_FINANCIAL_CONFIRM
                        else -> StreamVisualState.ANSWERED
                    }
                    "failed" -> StreamVisualState.FAILED
                    "cancelled" -> StreamVisualState.CANCELLED
                    "interrupted" -> StreamVisualState.RECONCILE
                    else -> state.visualState
                }
                state.copy(
                    lastSeq = event.seq,
                    status = event.status,
                    outcome = event.outcome,
                    error = event.error,
                    visualState = nextVisual,
                )
            }
        }
    }

    fun applyReconciledSnapshot(state: ActiveGenerationState, snapshot: GenerationSnapshot): ActiveGenerationState {
        // Validate conversation and generation identity
        if (snapshot.conversationId != state.conversationId || snapshot.id != state.generationId) {
            return state
        }
        // Validate against stale seq: do not overwrite newer state with an older snapshot!
        if (snapshot.lastSeq < state.lastSeq) {
            return state
        }

        val provisionals = snapshot.partialMessages.associate { p ->
            p.messageId to StreamProvisionalMessage(p.messageId, p.step, p.text, p.validated)
        }
        val validated = snapshot.messages.associateBy { it.optString("id") }
        val clar = snapshot.messages.firstNotNullOfOrNull { extractClarification(it) } ?: state.clarification

        val visual = when (snapshot.status) {
            "completed" -> when (snapshot.outcome) {
                "awaiting-choice" -> StreamVisualState.AWAITING_CHOICE
                "pending-confirmation" -> StreamVisualState.PENDING_FINANCIAL_CONFIRM
                else -> StreamVisualState.ANSWERED
            }
            "failed" -> StreamVisualState.FAILED
            "cancelled" -> StreamVisualState.CANCELLED
            "interrupted" -> StreamVisualState.RECONCILE
            "running" -> StreamVisualState.RECEIVING
            else -> StreamVisualState.CONNECTING
        }

        return state.copy(
            status = snapshot.status,
            delivery = snapshot.delivery,
            lastSeq = snapshot.lastSeq,
            provisionalMessages = provisionals,
            validatedMessages = validated,
            clarification = clar,
            outcome = snapshot.outcome,
            error = snapshot.error,
            userMessage = snapshot.userMessage ?: state.userMessage,
            visualState = visual,
            requiresReconcile = false,
        )
    }

    fun lockChoice(state: ActiveGenerationState, optionId: String, choiceRequestId: String? = null): ActiveGenerationState {
        return state.copy(
            selectedOptionId = optionId,
            pendingChoiceRequestId = choiceRequestId ?: state.pendingChoiceRequestId,
        )
    }

    fun unlockChoice(state: ActiveGenerationState): ActiveGenerationState {
        return state.copy(
            selectedOptionId = null,
            pendingChoiceRequestId = null,
        )
    }
}
