package com.yansuu1.jizhang.net

import kotlinx.coroutines.runBlocking
import okio.Buffer
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream

class SseParserTest {

    @Test
    fun parsesStandardEventsWithCrlfLfAndCr() = runBlocking {
        val sseData = "id: 1\r\nevent: state\r\ndata: {\"version\":1,\"status\":\"accepted\"}\r\n\r\n" +
            "id: 2\nevent: text-delta\ndata: {\"version\":1,\"text\":\"hello\"}\n\n" +
            "id: 3\revent: terminal\rdata: {\"version\":1,\"status\":\"completed\"}\r\r"

        val buffer = Buffer().writeUtf8(sseData)
        val events = mutableListOf<SseEvent>()

        SseParser.parse(buffer) { event ->
            events.add(event)
        }

        assertEquals(3, events.size)

        assertEquals("1", events[0].id)
        assertEquals("state", events[0].event)
        assertEquals("{\"version\":1,\"status\":\"accepted\"}", events[0].data)

        assertEquals("2", events[1].id)
        assertEquals("text-delta", events[1].event)
        assertEquals("{\"version\":1,\"text\":\"hello\"}", events[1].data)

        assertEquals("3", events[2].id)
        assertEquals("terminal", events[2].event)
        assertEquals("{\"version\":1,\"status\":\"completed\"}", events[2].data)
    }

    @Test
    fun ignoresHeartbeatsAndComments() = runBlocking {
        val sseData = ": heartbeat\n\n" +
            ": another comment\n" +
            "id: 1\n" +
            ": internal comment\n" +
            "data: payload\n\n"

        val buffer = Buffer().writeUtf8(sseData)
        val events = mutableListOf<SseEvent>()

        SseParser.parse(buffer) { events.add(it) }

        assertEquals(1, events.size)
        assertEquals("1", events[0].id)
        assertEquals("payload", events[0].data)
    }

    @Test
    fun multiLineDataFieldsAreJoinedWithNewline() = runBlocking {
        val sseData = "data: line 1\n" +
            "data: line 2\n" +
            "data: line 3\n\n"

        val buffer = Buffer().writeUtf8(sseData)
        val events = mutableListOf<SseEvent>()

        SseParser.parse(buffer) { events.add(it) }

        assertEquals(1, events.size)
        assertNull(events[0].id)
        assertNull(events[0].event)
        assertEquals("line 1\nline 2\nline 3", events[0].data)
    }

    @Test
    fun rejectsLineOversized() = runBlocking {
        // Line exceeds 64 KiB (65536 bytes)
        val longLine = "data: " + "a".repeat(65536) + "\n\n"
        val buffer = Buffer().writeUtf8(longLine)

        try {
            SseParser.parse(buffer, maxLineBytes = 64 * 1024L) { }
            fail("Expected SSE_LINE_OVERSIZED exception")
        } catch (e: ApiException) {
            assertEquals("SSE_LINE_OVERSIZED", e.code)
            assertEquals(400, e.status)
        }
    }

    @Test
    fun rejectsEventDataOversized() = runBlocking {
        // Two lines under 64KiB each (e.g. 50KiB each), but when maxEventDataBytes is 80KiB, total event data exceeds 80KiB
        val chunk = "a".repeat(50 * 1024)
        val sseData = "data: $chunk\ndata: $chunk\n\n"
        val buffer = Buffer().writeUtf8(sseData)

        try {
            SseParser.parse(buffer, maxLineBytes = 64 * 1024L, maxEventDataBytes = 80 * 1024) { }
            fail("Expected SSE_EVENT_OVERSIZED exception")
        } catch (e: ApiException) {
            assertEquals("SSE_EVENT_OVERSIZED", e.code)
            assertEquals(400, e.status)
        }
    }

    @Test
    fun rejectsTotalStreamOversized() = runBlocking {
        val line = "data: 1234567890\n\n"
        val buffer = Buffer()
        // Repeat to exceed total limit (e.g. limit to 100 bytes)
        repeat(20) { buffer.writeUtf8(line) }

        try {
            SseParser.parse(buffer, maxTotalBytes = 100L) { }
            fail("Expected SSE_TOTAL_OVERSIZED exception")
        } catch (e: ApiException) {
            assertEquals("SSE_TOTAL_OVERSIZED", e.code)
            assertEquals(400, e.status)
        }
    }

    @Test
    fun rejectsMalformedUtf8Bytes() = runBlocking {
        val out = ByteArrayOutputStream()
        out.write("data: valid ".toByteArray(Charsets.UTF_8))
        out.write(byteArrayOf(0xFF.toByte(), 0xFE.toByte())) // Invalid UTF-8 sequence
        out.write("\n\n".toByteArray(Charsets.UTF_8))

        val buffer = Buffer().write(out.toByteArray())

        try {
            SseParser.parse(buffer) { }
            fail("Expected SSE_CORRUPT_UTF8 exception")
        } catch (e: ApiException) {
            assertEquals("SSE_CORRUPT_UTF8", e.code)
            assertEquals(400, e.status)
        }
    }

    @Test
    fun doesNotEmitIncompleteEventsAtEof() = runBlocking {
        // Event data present, but stream ends without trailing empty line (\n\n)
        val sseData = "id: 1\nevent: text-delta\ndata: incomplete"
        val buffer = Buffer().writeUtf8(sseData)
        val events = mutableListOf<SseEvent>()

        SseParser.parse(buffer) { events.add(it) }

        // Must NOT emit because trailing empty line delimiter was missing
        assertTrue(events.isEmpty())
    }

    @Test
    fun doesNotEmitUnterminatedLineAtEof() = runBlocking {
        // Stream has one complete event and one unterminated line at EOF
        val sseData = "id: 1\ndata: complete\n\nid: 2\ndata: unfinished"
        val buffer = Buffer().writeUtf8(sseData)
        val events = mutableListOf<SseEvent>()

        SseParser.parse(buffer) { events.add(it) }

        assertEquals(1, events.size)
        assertEquals("1", events[0].id)
        assertEquals("complete", events[0].data)
    }

    @Test
    fun streamingSourceEmitsEventBeforeSourceFinishesAndDoesNotReadPastFirstLfEvent() = runBlocking {
        val event1Chunk = "data: first-streaming-event\n\n"
        val event2Chunk = "data: second-streaming-event\n\n"

        val buffer1 = Buffer().writeUtf8(event1Chunk)
        val buffer2 = Buffer().writeUtf8(event2Chunk)

        var explicitRelease = false
        var sourceExhausted = false

        val streamingSource = object : Source {
            override fun read(sink: Buffer, byteCount: Long): Long {
                if (buffer1.size > 0L) {
                    return buffer1.read(sink, minOf(byteCount, buffer1.size))
                }
                if (!explicitRelease) {
                    throw AssertionError(
                        "Parser read past first complete LF event before explicit release! Violates streaming."
                    )
                }
                if (buffer2.size > 0L) {
                    return buffer2.read(sink, minOf(byteCount, buffer2.size))
                }
                sourceExhausted = true
                return -1L
            }

            override fun timeout(): Timeout = Timeout.NONE
            override fun close() {}
        }

        val bufferedSource = streamingSource.buffer()
        val receivedEvents = mutableListOf<SseEvent>()
        var firstEventReceivedBeforeSourceFinished = false

        SseParser.parse(bufferedSource) { event ->
            receivedEvents.add(event)
            if (event.data == "first-streaming-event") {
                firstEventReceivedBeforeSourceFinished = !sourceExhausted
                // Explicitly release the next chunk now that first event was dispatched
                explicitRelease = true
            }
        }

        assertTrue("First event must be dispatched before stream finishes", firstEventReceivedBeforeSourceFinished)
        assertTrue("Stream must finish after explicit release", sourceExhausted)
        assertEquals(2, receivedEvents.size)
        assertEquals("first-streaming-event", receivedEvents[0].data)
        assertEquals("second-streaming-event", receivedEvents[1].data)
    }

    @Test
    fun streamingSourceEmitsEventBeforeSourceFinishesAndDoesNotReadPastStandaloneCrEvent() = runBlocking {
        // Controlled Source with standalone CR delimiters: \r\r
        val event1Chunk = "data: first-cr-event\r\r"
        val event2Chunk = "data: second-cr-event\r\r"

        val buffer1 = Buffer().writeUtf8(event1Chunk)
        val buffer2 = Buffer().writeUtf8(event2Chunk)

        var explicitRelease = false
        var sourceExhausted = false

        val streamingSource = object : Source {
            override fun read(sink: Buffer, byteCount: Long): Long {
                if (buffer1.size > 0L) {
                    return buffer1.read(sink, minOf(byteCount, buffer1.size))
                }
                if (!explicitRelease) {
                    throw AssertionError(
                        "Parser read past first complete CR event before explicit release! Lookahead blocked streaming."
                    )
                }
                if (buffer2.size > 0L) {
                    return buffer2.read(sink, minOf(byteCount, buffer2.size))
                }
                sourceExhausted = true
                return -1L
            }

            override fun timeout(): Timeout = Timeout.NONE
            override fun close() {}
        }

        val bufferedSource = streamingSource.buffer()
        val receivedEvents = mutableListOf<SseEvent>()
        var firstEventReceivedBeforeSourceFinished = false

        SseParser.parse(bufferedSource) { event ->
            receivedEvents.add(event)
            if (event.data == "first-cr-event") {
                firstEventReceivedBeforeSourceFinished = !sourceExhausted
                // Release the next chunk only after the first CR event was dispatched timely
                explicitRelease = true
            }
        }

        assertTrue("First CR event must be dispatched before stream finishes without lookahead read", firstEventReceivedBeforeSourceFinished)
        assertTrue("Stream must finish after explicit release", sourceExhausted)
        assertEquals(2, receivedEvents.size)
        assertEquals("first-cr-event", receivedEvents[0].data)
        assertEquals("second-cr-event", receivedEvents[1].data)
    }

    @Test
    fun handlesCrAtBufferBoundaryWithCrlf() = runBlocking {
        val chunk1 = Buffer().writeUtf8("data: test-split\r")
        val chunk2 = Buffer().writeUtf8("\n\n")

        val source = object : Source {
            override fun read(sink: Buffer, byteCount: Long): Long {
                if (chunk1.size > 0L) {
                    return chunk1.read(sink, minOf(byteCount, chunk1.size))
                }
                if (chunk2.size > 0L) {
                    return chunk2.read(sink, minOf(byteCount, chunk2.size))
                }
                return -1L
            }
            override fun timeout(): Timeout = Timeout.NONE
            override fun close() {}
        }.buffer()

        val events = mutableListOf<SseEvent>()
        SseParser.parse(source) { events.add(it) }

        assertEquals(1, events.size)
        assertEquals("test-split", events[0].data)
    }
}
