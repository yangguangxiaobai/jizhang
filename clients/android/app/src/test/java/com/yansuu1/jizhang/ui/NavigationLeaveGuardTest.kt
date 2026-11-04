package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationLeaveGuardTest {

    @Test
    fun outerNavigationConsultsActiveLeaveGuard() {
        val coordinator = NavigationLeaveCoordinator()
        var destinationCalls = 0
        var promptDisplayedCount = 0
        var allowCallback: (() -> Unit)? = null

        val handlers = ActiveNavigationHandlers(
            requestBack = {},
            requestLeave = { onAllow ->
                promptDisplayedCount++
                allowCallback = onAllow
            },
        )

        coordinator.register("owner-1", handlers)
        assertTrue(coordinator.isRegistered("owner-1"))

        // 1. Initial leave request: handler is consulted, destination not invoked yet
        coordinator.requestLeave { destinationCalls++ }
        assertEquals(0, destinationCalls)
        assertEquals(1, promptDisplayedCount)

        // 2. Duplicate click by user while pending: should NOT trigger a second prompt or overwrite target
        coordinator.requestLeave { destinationCalls += 10 }
        assertEquals(1, promptDisplayedCount)
        assertEquals(0, destinationCalls)

        // 3. User approves leave: destination is invoked exactly once
        allowCallback?.invoke()
        assertEquals(1, destinationCalls)

        // 4. Repeated invocation of the same allow callback: must be a no-op (cannot re-navigate)
        allowCallback?.invoke()
        assertEquals(1, destinationCalls)

        // 5. Stale owner test: owner-1 requests leave, but user switches or owner changes before allow
        var staleDestinationCalls = 0
        var staleAllow: (() -> Unit)? = null
        val staleHandlers = ActiveNavigationHandlers(
            requestBack = {},
            requestLeave = { onAllow -> staleAllow = onAllow },
        )
        coordinator.register("owner-stale", staleHandlers)
        coordinator.requestLeave { staleDestinationCalls++ }

        // Owner deregisters or advances before staleAllow fires
        coordinator.register("owner-stale", null)
        assertFalse(coordinator.isRegistered("owner-stale"))

        // Now the old prompt delay fires: it MUST NOT navigate
        staleAllow?.invoke()
        assertEquals(0, staleDestinationCalls)
    }

    @Test
    fun backClosesInnermostLayerBeforeSource() {
        val coordinator = NavigationLeaveCoordinator()
        val actions = mutableListOf<String>()

        var fallbackCalled = false
        val fallback = { fallbackCalled = true }

        // Unregistered coordinator calls fallback
        coordinator.requestBack(fallback)
        assertTrue(fallbackCalled)

        // Active innermost layer registers handler
        val innerHandlers = ActiveNavigationHandlers(
            requestBack = { actions.add("close-inner") },
            requestLeave = { onAllow -> onAllow() },
        )
        coordinator.register("inner-layer", innerHandlers)

        coordinator.requestBack(fallback)
        assertEquals(listOf("close-inner"), actions)

        // Another outer layer cannot unregister inner layer by specifying a mismatched owner
        coordinator.register("outer-layer", null)
        assertTrue(coordinator.isRegistered("inner-layer"))

        // Inner layer unregisters itself on dispose
        coordinator.register("inner-layer", null)
        assertFalse(coordinator.isRegistered("inner-layer"))

        fallbackCalled = false
        coordinator.requestBack(fallback)
        assertTrue(fallbackCalled)
    }
}
