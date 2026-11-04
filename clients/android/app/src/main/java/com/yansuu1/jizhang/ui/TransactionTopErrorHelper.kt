package com.yansuu1.jizhang.ui

/**
 * One top-of-editor error event.
 *
 * [eventId] identifies the *emission*, not the text: showing the same message
 * again increments the id, so a newer error replaces the old one and restarts
 * its timer instead of being swallowed as a duplicate.
 */
data class TransactionTopErrorEvent(
    val eventId: Long,
    val message: String,
    val durationMs: Long,
)

/** Timing rules for the top error overlay. */
object TransactionTopErrorTiming {
    /** Baseline dwell time before the overlay dismisses itself. */
    const val DEFAULT_DURATION_MS = 4_500L

    /**
     * TalkBack may need longer than [DEFAULT_DURATION_MS] to read the message.
     * The platform-recommended timeout can extend the dwell time but must never
     * shorten it, and an absent/zero recommendation keeps the baseline.
     */
    fun effectiveDurationMs(recommendedTimeoutMillis: Int?): Long {
        val recommended = recommendedTimeoutMillis?.toLong() ?: 0L
        return if (recommended <= 0L) DEFAULT_DURATION_MS else maxOf(DEFAULT_DURATION_MS, recommended)
    }
}

/**
 * Owns the top error event lifecycle.
 *
 * Guarantees used by the editor (and asserted by JVM tests):
 * - repeated identical text still allocates a new [TransactionTopErrorEvent.eventId];
 * - a stale timer can only call [dismiss] with its own id, and any id that is no
 *   longer current is refused, so an old timer cannot clear a newer event;
 * - manual dismissal goes through the same id check.
 */
class TransactionTopErrorController(
    private val defaultDurationMs: Long = TransactionTopErrorTiming.DEFAULT_DURATION_MS,
) {
    private var nextEventId = 0L

    var event: TransactionTopErrorEvent? = null
        private set

    fun show(message: String, durationMs: Long = defaultDurationMs): TransactionTopErrorEvent {
        nextEventId += 1
        val next = TransactionTopErrorEvent(
            eventId = nextEventId,
            message = message,
            durationMs = if (durationMs > 0L) durationMs else defaultDurationMs,
        )
        event = next
        return next
    }

    /** @return true only when [eventId] is the event currently shown. */
    fun dismiss(eventId: Long): Boolean {
        if (event?.eventId != eventId) return false
        event = null
        return true
    }

    fun clear() {
        event = null
    }
}
