package com.yansuu1.jizhang.net

import okio.BufferedSource
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * Pure, bounded, reusable Server-Sent Events (SSE) parser.
 *
 * Adheres strictly to the SSE specification:
 * - Line separators: CRLF (\r\n), LF (\n), or CR (\r)
 * - Comment / heartbeat lines: lines starting with ':' are ignored
 * - Bounds enforcement:
 *     maxLineBytes (default 64 KiB): single line length bound
 *     maxEventDataBytes (default 128 KiB): accumulated data bytes per event bound
 *     maxTotalBytes (default 2 MiB): total stream bytes bound
 * - Strict UTF-8: CharacterCodingException thrown on malformed or unmappable input
 * - Incomplete EOF: incomplete events (without terminating blank line) are NOT emitted.
 * - Unterminated lines at EOF are discarded without emission.
 */
object SseParser {

    const val DEFAULT_MAX_LINE_BYTES: Long = 64 * 1024L // 64 KiB
    const val DEFAULT_MAX_EVENT_DATA_BYTES: Int = 128 * 1024 // 128 KiB
    const val DEFAULT_MAX_TOTAL_BYTES: Long = 2 * 1024 * 1024L // 2 MiB

    /**
     * Stateful bounded line reader for SSE streams.
     * Delimited by CRLF (\r\n), LF (\n), or CR (\r).
     *
     * Standalone CR immediately returns line without blocking lookahead for '\n',
     * carrying [skipOptionalLf] state into the next line call.
     */
    class SseStreamReader(
        private val source: BufferedSource,
        private val maxLineBytes: Long = DEFAULT_MAX_LINE_BYTES,
    ) {
        var skipOptionalLf: Boolean = false
            private set

        fun readBoundedLine(): Pair<ByteArray, Int>? {
            var extraDelimiterBytes = 0
            if (skipOptionalLf) {
                skipOptionalLf = false
                // If the very next byte is LF from a previous CRLF sequence across buffer/chunk boundaries,
                // consume it without treating it as an empty line delimiter.
                if (source.request(1L) && source.buffer[0] == '\n'.code.toByte()) {
                    source.skip(1L)
                    extraDelimiterBytes = 1
                }
            }

            var scanIndex = 0L

            while (true) {
                if (scanIndex > maxLineBytes) {
                    throw ApiException(400, "SSE_LINE_OVERSIZED", "SSE 行大小超过上限（64KiB）")
                }

                if (scanIndex >= source.buffer.size) {
                    if (!source.request(scanIndex + 1L)) {
                        // Stream exhausted before delimiter
                        return null
                    }
                }

                val b = source.buffer[scanIndex]
                if (b == '\n'.code.toByte()) {
                    val lineBytes = source.readByteArray(scanIndex)
                    source.skip(1L)
                    return Pair(lineBytes, 1 + extraDelimiterBytes)
                } else if (b == '\r'.code.toByte()) {
                    if (scanIndex + 1L < source.buffer.size) {
                        // Next byte is already present in buffer: check immediately without blocking I/O
                        val isCrLf = source.buffer[scanIndex + 1L] == '\n'.code.toByte()
                        val delimiterBytes = if (isCrLf) 2 else 1
                        val lineBytes = source.readByteArray(scanIndex)
                        source.skip(delimiterBytes.toLong())
                        return Pair(lineBytes, delimiterBytes + extraDelimiterBytes)
                    } else {
                        // CR is at buffer boundary: return line immediately WITHOUT blocking lookahead.
                        // Carry skipOptionalLf into next line read.
                        val lineBytes = source.readByteArray(scanIndex)
                        source.skip(1L)
                        skipOptionalLf = true
                        return Pair(lineBytes, 1 + extraDelimiterBytes)
                    }
                }

                scanIndex++
            }
        }
    }

    /**
     * Reads a single line delimited by \r\n, \n, or \r from [source], bounded by [maxLineBytes].
     *
     * Returns the raw byte array of line contents (excluding line delimiters),
     * or null if the source is exhausted before a valid delimiter is found.
     * Throws [ApiException] if line length exceeds [maxLineBytes].
     */
    fun readBoundedLine(
        source: BufferedSource,
        maxLineBytes: Long = DEFAULT_MAX_LINE_BYTES,
    ): Pair<ByteArray, Int>? {
        return SseStreamReader(source, maxLineBytes).readBoundedLine()
    }

    /**
     * Parses an SSE stream from [source] into discrete [SseEvent]s.
     */
    suspend fun parse(
        source: BufferedSource,
        maxLineBytes: Long = DEFAULT_MAX_LINE_BYTES,
        maxEventDataBytes: Int = DEFAULT_MAX_EVENT_DATA_BYTES,
        maxTotalBytes: Long = DEFAULT_MAX_TOTAL_BYTES,
        onEvent: suspend (SseEvent) -> Unit,
    ) {
        var totalBytes = 0L
        var currentId: String? = null
        var currentEvent: String? = null
        val dataLines = mutableListOf<String>()
        var currentDataBytes = 0

        val utf8Decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)

        val reader = SseStreamReader(source, maxLineBytes)

        while (true) {
            val linePair = reader.readBoundedLine() ?: break
            val lineBytes = linePair.first
            val delimiterBytes = linePair.second

            totalBytes += lineBytes.size + delimiterBytes
            if (totalBytes > maxTotalBytes) {
                throw ApiException(400, "SSE_TOTAL_OVERSIZED", "SSE 流总量超过上限（2MiB）")
            }

            val line = try {
                utf8Decoder.decode(ByteBuffer.wrap(lineBytes)).toString()
            } catch (e: CharacterCodingException) {
                throw ApiException(400, "SSE_CORRUPT_UTF8", "SSE 接收到非法 UTF-8 编码字节")
            }

            if (line.isEmpty()) {
                // Empty line dispatches the current event buffer
                if (dataLines.isNotEmpty()) {
                    val data = dataLines.joinToString("\n")
                    onEvent(SseEvent(id = currentId, event = currentEvent, data = data))
                    dataLines.clear()
                    currentDataBytes = 0
                    currentEvent = null
                }
            } else if (line.startsWith(":")) {
                // Heartbeat / comment line; ignore
                continue
            } else {
                val colonIndex = line.indexOf(':')
                val field: String
                val value: String
                if (colonIndex != -1) {
                    field = line.substring(0, colonIndex).trim()
                    var v = line.substring(colonIndex + 1)
                    if (v.startsWith(" ")) v = v.substring(1)
                    value = v
                } else {
                    field = line.trim()
                    value = ""
                }

                when (field) {
                    "id" -> currentId = value
                    "event" -> currentEvent = value
                    "data" -> {
                        val dBytes = value.toByteArray(Charsets.UTF_8).size
                        if (currentDataBytes + dBytes > maxEventDataBytes) {
                            throw ApiException(400, "SSE_EVENT_OVERSIZED", "SSE 单事件大小超过上限（128KiB）")
                        }
                        dataLines.add(value)
                        currentDataBytes += dBytes
                    }
                }
            }
        }

        // Note: Incomplete events at EOF without a terminating blank line are intentionally
        // NOT dispatched to comply with SSE framing guarantees.
    }
}
