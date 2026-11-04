package com.yansuu1.jizhang.net

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertTrue
import org.junit.Test

class CancellableBlockingFlowTest {
    @Test
    fun cancellationInterruptsBlockedReadBeforeReaderJobCanComplete() = runBlocking {
        val entered = CountDownLatch(1)
        val unblock = CountDownLatch(1)
        val cancelled = AtomicBoolean(false)
        val consumer = launch(Dispatchers.Default) {
            cancellableBlockingFlow<Int>(cancelTransport = {
                cancelled.set(true)
                unblock.countDown()
            }) {
                entered.countDown()
                check(unblock.await(5, TimeUnit.SECONDS)) { "Blocking read was not cancelled" }
            }.collect()
        }
        assertTrue(entered.await(3, TimeUnit.SECONDS))
        try {
            withTimeout(2000) { consumer.cancelAndJoin() }
            assertTrue(cancelled.get())
        } finally {
            unblock.countDown()
            consumer.cancelAndJoin()
        }
    }
}
