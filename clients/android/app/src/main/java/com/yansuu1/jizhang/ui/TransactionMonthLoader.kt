package com.yansuu1.jizhang.ui

import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject

/**
 * Complete result of one filtered month load.
 *
 * [total] is the server's authoritative count for the query scope. It is never
 * re-derived from [items] because the rows can change while paging.
 */
data class TransactionMonthResult(
    val items: List<JSONObject>,
    val total: Int,
    val searchRevision: String? = null,
)

/**
 * Authoritative server-side daily totals for a filtered transaction scope.
 * Amounts are kept in cents exactly as returned; the client never sums rows.
 */
data class TransactionDaySummary(
    val day: String,
    val expenseCents: Long,
    val incomeCents: Long,
    val count: Int,
)

/** Batch size for the complete-month loader; independent of UI pagination. */
internal const val TRANSACTION_MONTH_BATCH_SIZE = 500

/** Resource guard for pathological/unbounded result sets. */
internal const val TRANSACTION_MONTH_MAX_ROWS = 100_000

private const val TRANSACTION_DAY_PATTERN = "yyyy-MM-dd"
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
private val TRANSACTION_DAY_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/**
 * Stable device-local day key used for grouping rows and matching daily summaries.
 *
 * The server receives the same device time zone and groups with the same
 * `yyyy-MM-dd` contract, so both sides agree on month/day boundaries.
 */
fun transactionDayKey(date: Long, timeZone: TimeZone = TimeZone.getDefault()): String {
    val formatter = SimpleDateFormat(TRANSACTION_DAY_PATTERN, Locale.US)
    formatter.timeZone = timeZone
    return formatter.format(Date(date))
}

/**
 * Converts a device time zone to an IANA name accepted by the daily-summary API.
 *
 * Android can report fixed-offset IDs such as `GMT+08:00`, which Intl rejects.
 * Whole-hour offsets are mapped to the equivalent inverted `Etc/GMT` zone
 * (`GMT+08:00` becomes `Etc/GMT-8`; zero becomes `Etc/UTC`). Fractional fixed
 * offsets have no exact IANA equivalent here and are returned unchanged, so the
 * server rejects them and the UI shows the summary as unavailable instead of
 * grouping days under a guessed zone.
 */
fun transactionSummaryTimeZone(timeZone: TimeZone = TimeZone.getDefault()): String {
    val zoneId = runCatching { timeZone.toZoneId().normalized() }.getOrElse { return timeZone.id }
    if (zoneId !is ZoneOffset) return zoneId.id

    val totalSeconds = zoneId.totalSeconds
    if (totalSeconds % 3600 != 0) return timeZone.id

    val hours = totalSeconds / 3600
    if (hours == 0) return "Etc/UTC"
    if (hours < -12 || hours > 14) return timeZone.id
    return if (hours > 0) "Etc/GMT-$hours" else "Etc/GMT+${-hours}"
}

/**
 * Loads every live transaction in the [from,to) scope, starting at offset 0.
 *
 * The query's UI pagination (`page`, `pageSize`) is intentionally ignored: each
 * request uses at most [TRANSACTION_MONTH_BATCH_SIZE] rows. All filter predicates
 * from [query] are preserved.
 *
 * The load is all-or-nothing. Any changed total, duplicate/missing id, short or
 * empty page, or final count mismatch throws so callers never publish a partial
 * month as complete. Cancellation is never swallowed.
 */
suspend fun loadTransactionMonth(
    query: TransactionQuery,
    from: Long,
    to: Long,
    fetch: suspend (Map<String, String>) -> JSONObject,
): TransactionMonthResult {
    val baseParams = query.toServerParams(from, to)
    val items = mutableListOf<JSONObject>()
    val seenIds = HashSet<String>()
    var authoritativeTotal: Int? = null
    var searchRevision: String? = null
    var offset = 0

    while (true) {
        currentCoroutineContext().ensureActive()

        val totalBeforePage = authoritativeTotal
        val batchSize = if (totalBeforePage == null) {
            TRANSACTION_MONTH_BATCH_SIZE
        } else {
            minOf(TRANSACTION_MONTH_BATCH_SIZE, totalBeforePage - offset)
        }
        if (batchSize <= 0) {
            throw IllegalStateException(
                "Transaction month total changed while loading (offset=$offset, total=$totalBeforePage)",
            )
        }

        val params = baseParams.toMutableMap()
        params["limit"] = batchSize.toString()
        params["offset"] = offset.toString()

        val response = fetch(params)
        currentCoroutineContext().ensureActive()
        val pageRevision = requireTransactionSearchRevision(response, query.search.isNotBlank())
        if (searchRevision != null && pageRevision != searchRevision) {
            throw TransactionSearchRevisionChangedException()
        }
        searchRevision = pageRevision

        val pageTotal = readMonthTotal(response)
        val knownTotal = authoritativeTotal
        if (knownTotal == null) {
            if (pageTotal > TRANSACTION_MONTH_MAX_ROWS) {
                throw IllegalStateException(
                    "Transaction month has $pageTotal rows, exceeding the $TRANSACTION_MONTH_MAX_ROWS row limit",
                )
            }
            authoritativeTotal = pageTotal
        } else if (pageTotal != knownTotal) {
            throw IllegalStateException(
                "Transaction month total changed while loading: expected $knownTotal, server returned $pageTotal",
            )
        }
        val total = authoritativeTotal!!

        val page = readMonthItems(response)
        if (page.length() > batchSize) {
            throw IllegalStateException(
                "Transaction page at offset $offset returned ${page.length()} rows, more than the requested $batchSize",
            )
        }
        if (page.length() == 0) {
            if (items.size != total) {
                throw IllegalStateException(
                    "Empty page at offset $offset before all $total transaction rows were loaded",
                )
            }
            break
        }

        for (index in 0 until page.length()) {
            val item = page.optJSONObject(index)
                ?: throw IllegalArgumentException("Transaction page item $index at offset $offset must be an object")
            val id = (item.opt("id") as? String)?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException(
                    "Transaction page item $index at offset $offset is missing a non-empty id",
                )
            if (!seenIds.add(id)) {
                throw IllegalStateException("Duplicate transaction id '$id' returned while loading the month")
            }
            items.add(item)
        }

        offset += page.length()
        if (items.size > total) {
            throw IllegalStateException(
                "Transaction month returned ${items.size} rows but reported a total of $total",
            )
        }
        if (items.size == total) break
        if (page.length() < batchSize) {
            throw IllegalStateException(
                "Transaction page at offset ${offset - page.length()} returned ${page.length()} of $batchSize rows " +
                    "before reaching the reported total of $total",
            )
        }
    }

    val total = authoritativeTotal ?: 0
    if (items.size != total) {
        throw IllegalStateException(
            "Transaction month row count ${items.size} does not match the reported total $total",
        )
    }
    return TransactionMonthResult(items = items.toList(), total = total, searchRevision = searchRevision)
}

/**
 * Decodes the additive `GET /api/v1/transactions/daily-summary` payload:
 * `{items:[{day:"yyyy-MM-dd", expenseCents, incomeCents, count}]}`.
 *
 * Fields are validated strictly. Missing/ambiguous data is an error rather than
 * a zero default, so the UI can show "unavailable" instead of a fabricated total.
 */
class TransactionSearchRevisionChangedException : IllegalStateException("账单已变化，请刷新后重试")

fun requireTransactionSearchVersion(response: JSONObject, searching: Boolean) {
    if (!searching) return
    val version = response.opt("searchVersion")
    if (version !is Number || version.toDouble() != 1.0) {
        throw IllegalStateException("当前服务端不支持账单搜索，请升级服务端后重试")
    }
}

fun requireTransactionSearchRevision(response: JSONObject, searching: Boolean): String? {
    requireTransactionSearchVersion(response, searching)
    if (!searching) return null
    val revision = response.opt("searchRevision") as? String
    if (revision == null || !Regex("^[0-9a-fA-F]{64}$").matches(revision)) {
        throw IllegalStateException("服务端搜索快照无效，请升级服务端或刷新后重试")
    }
    return revision.lowercase(Locale.ROOT)
}

fun decodeTransactionDaySummaries(
    response: JSONObject,
    searching: Boolean = false,
    expectedSearchRevision: String? = null,
): Map<String, TransactionDaySummary> {
    val revision = requireTransactionSearchRevision(response, searching)
    if (searching && (expectedSearchRevision == null || revision != expectedSearchRevision)) {
        throw TransactionSearchRevisionChangedException()
    }
    val items = response.optJSONArray("items")
        ?: throw IllegalArgumentException("Daily summary response is missing an items array")

    val summaries = LinkedHashMap<String, TransactionDaySummary>()
    for (index in 0 until items.length()) {
        val item = items.optJSONObject(index)
            ?: throw IllegalArgumentException("Daily summary item $index must be an object")

        val day = item.opt("day") as? String
            ?: throw IllegalArgumentException("Daily summary item $index is missing a string day")
        if (!isValidTransactionDay(day)) {
            throw IllegalArgumentException("Daily summary item $index has invalid day '$day'")
        }
        if (summaries.containsKey(day)) {
            throw IllegalArgumentException("Duplicate daily summary day '$day'")
        }

        val expenseCents = requireNonNegativeInteger(
            item.opt("expenseCents"),
            "expenseCents for day $day",
            MAX_SAFE_INTEGER,
        )
        val incomeCents = requireNonNegativeInteger(
            item.opt("incomeCents"),
            "incomeCents for day $day",
            MAX_SAFE_INTEGER,
        )
        val count = requireNonNegativeInteger(
            item.opt("count"),
            "count for day $day",
            Int.MAX_VALUE.toLong(),
        )

        summaries[day] = TransactionDaySummary(
            day = day,
            expenseCents = expenseCents,
            incomeCents = incomeCents,
            count = count.toInt(),
        )
    }
    return summaries
}

/**
 * Validates that the authoritative summary has exactly one entry per local day
 * present in [items] and that every daily count matches the loaded rows.
 *
 * This is a count-only consistency check; it deliberately performs no money
 * arithmetic and cannot alter summary amounts.
 */
fun validateTransactionDaySummaryCounts(
    items: List<JSONObject>,
    summaries: Map<String, TransactionDaySummary>,
) {
    val rowCounts = LinkedHashMap<String, Int>()
    for ((index, item) in items.withIndex()) {
        val date = requireEpochMillis(item.opt("date"), "Transaction item $index date")
        val day = transactionDayKey(date)
        rowCounts[day] = (rowCounts[day] ?: 0) + 1
    }

    for ((day, rowCount) in rowCounts) {
        val summary = summaries[day]
            ?: throw IllegalArgumentException("Missing daily summary for day $day")
        if (summary.day != day) {
            throw IllegalArgumentException(
                "Daily summary key '$day' does not match summary day '${summary.day}'",
            )
        }
        if (summary.count != rowCount) {
            throw IllegalArgumentException(
                "Daily summary count mismatch for day $day: summary=${summary.count}, rows=$rowCount",
            )
        }
    }
    for ((day, summary) in summaries) {
        if (!rowCounts.containsKey(day)) {
            throw IllegalArgumentException("Daily summary contains unexpected day $day")
        }
        if (summary.count < 0) {
            throw IllegalArgumentException("Daily summary count for day $day must not be negative")
        }
    }
}

private fun readMonthTotal(response: JSONObject): Int {
    val total = requireNonNegativeInteger(
        response.opt("total"),
        "Transaction response total",
        TRANSACTION_MONTH_MAX_ROWS.toLong(),
    )
    if (total > Int.MAX_VALUE) {
        throw IllegalArgumentException("Transaction response total is too large")
    }
    return total.toInt()
}

private fun readMonthItems(response: JSONObject): JSONArray {
    return response.optJSONArray("items")
        ?: throw IllegalArgumentException("Transaction response is missing an items array")
}

private fun requireNonNegativeInteger(value: Any?, field: String, max: Long): Long {
    if (value == null || value === JSONObject.NULL || value !is Number) {
        throw IllegalArgumentException("$field must be a non-negative integer")
    }
    val number = value.toDouble()
    if (!number.isFinite() || number % 1.0 != 0.0) {
        throw IllegalArgumentException("$field must be a non-negative integer")
    }
    if (number < 0.0 || number > max.toDouble()) {
        throw IllegalArgumentException("$field must be a non-negative integer no greater than $max")
    }
    return number.toLong()
}

private fun requireEpochMillis(value: Any?, field: String): Long {
    if (value == null || value === JSONObject.NULL || value !is Number) {
        throw IllegalArgumentException("$field must be a numeric epoch timestamp")
    }
    val number = value.toDouble()
    if (!number.isFinite() || number % 1.0 != 0.0 ||
        number < -MAX_SAFE_INTEGER.toDouble() || number > MAX_SAFE_INTEGER.toDouble()
    ) {
        throw IllegalArgumentException("$field must be a safe integer epoch timestamp")
    }
    return number.toLong()
}

private fun isValidTransactionDay(day: String): Boolean {
    if (!TRANSACTION_DAY_REGEX.matches(day)) return false
    return try {
        LocalDate.parse(day)
        true
    } catch (_: DateTimeParseException) {
        false
    }
}
