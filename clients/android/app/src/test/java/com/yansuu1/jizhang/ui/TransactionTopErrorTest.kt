package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM regressions for the editor's top error event: 4500 ms baseline, new event
 * for repeated identical text, stale timers that may not dismiss a newer event,
 * and the accessibility-recommended dwell time.
 */
class TransactionTopErrorTest {

    @Test
    fun baselineDwellIsFourAndAHalfSeconds() {
        assertEquals(4_500L, TransactionTopErrorTiming.DEFAULT_DURATION_MS)
        assertEquals(4_500L, TransactionTopErrorTiming.effectiveDurationMs(null))
        assertEquals(4_500L, TransactionTopErrorTiming.effectiveDurationMs(0))
        // TalkBack may ask for longer, never shorter.
        assertEquals(10_000L, TransactionTopErrorTiming.effectiveDurationMs(10_000))
        assertEquals(4_500L, TransactionTopErrorTiming.effectiveDurationMs(2_000))
    }

    @Test
    fun shownEventCarriesTheRequestedDuration() {
        val controller = TransactionTopErrorController()
        val event = controller.show("保存失败")
        assertEquals(4_500L, event.durationMs)
        assertEquals(event, controller.event)

        val accessible = TransactionTopErrorController().show(
            "保存失败",
            TransactionTopErrorTiming.effectiveDurationMs(8_000),
        )
        assertEquals(8_000L, accessible.durationMs)
    }

    @Test
    fun repeatingTheSameTextStillProducesANewEventId() {
        val controller = TransactionTopErrorController()
        val first = controller.show("金额须为大于 0 的数字")
        val second = controller.show("金额须为大于 0 的数字")
        assertNotEquals(first.eventId, second.eventId)
        assertEquals(second, controller.event)
        assertEquals("金额须为大于 0 的数字", controller.event?.message)
    }

    @Test
    fun oldTimerCannotDismissANewerEvent() {
        val controller = TransactionTopErrorController()
        val first = controller.show("网络错误")
        val second = controller.show("网络错误")

        // The first event's LaunchedEffect fires late: it must be refused.
        assertFalse(controller.dismiss(first.eventId))
        assertEquals(second, controller.event)

        // A dismissal from an id that never existed is refused as well.
        assertFalse(controller.dismiss(first.eventId + 100))
        assertEquals(second, controller.event)

        assertTrue(controller.dismiss(second.eventId))
        assertNull(controller.event)
        // Dismissing again (double tap or a second late timer) is a no-op.
        assertFalse(controller.dismiss(second.eventId))
        assertNull(controller.event)
    }

    @Test
    fun manualDismissAndResetStartFromACleanState() {
        val controller = TransactionTopErrorController()
        val event = controller.show("请选择分类与账户")
        assertTrue(controller.dismiss(event.eventId))
        assertNull(controller.event)

        val next = controller.show("请选择分类与账户")
        assertNotEquals(event.eventId, next.eventId)

        controller.clear()
        assertNull(controller.event)
        // Clearing never rewinds the id sequence, so timers from before the clear stay stale.
        assertFalse(controller.dismiss(next.eventId))
        assertNotEquals(next.eventId, controller.show("再次失败").eventId)
    }
}
