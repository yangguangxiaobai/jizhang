package com.yansuu1.jizhang.net

import org.json.JSONObject
import java.math.BigDecimal

/**
 * Shared foundation for decoding exact integers from JSON and dynamic objects (Task 6).
 *
 * Contract:
 * - `requireExactLong(raw, field)`: Strictly requires a finite [Number] (rejecting Strings,
 *   nulls, booleans, NaN/Infinity, fractional values, and numbers outside 64-bit signed Long range).
 *   Throws [IllegalArgumentException] on any violation.
 * - `requireExactInt(raw, field)`: Enforces [requireExactLong] and verifies the value fits within 32-bit Int.
 * - `optSafeLong` / `optSafeInt`: Optional variant returning a fallback when absent/invalid or exceeding safe bounds.
 */
object JsonNumberReaders {
    const val MAX_SAFE_INTEGER = 9007199254740991L // 2^53 - 1
    const val MIN_SAFE_INTEGER = -9007199254740991L

    /**
     * Strictly parses [raw] as an exact 64-bit integer.
     * Rejects Strings, non-Numbers, non-finite floats, fractions, and values outside Long range.
     * Throws [IllegalArgumentException] with [field] on failure.
     */
    fun requireExactLong(raw: Any?, field: String): Long {
        if (raw == null) {
            throw IllegalArgumentException("Field '$field' must not be null")
        }
        if (raw is String) {
            throw IllegalArgumentException("Field '$field' expected number, got String: $raw")
        }
        if (raw !is Number) {
            throw IllegalArgumentException("Field '$field' expected number, got ${raw.javaClass.simpleName}")
        }
        if (raw is Double || raw is Float) {
            val d = raw.toDouble()
            if (d.isNaN() || d.isInfinite()) {
                throw IllegalArgumentException("Field '$field' is non-finite: $d")
            }
        }
        val bd = try {
            BigDecimal(raw.toString())
        } catch (e: Exception) {
            throw IllegalArgumentException("Field '$field' invalid number format: $raw", e)
        }
        return try {
            bd.longValueExact()
        } catch (e: ArithmeticException) {
            throw IllegalArgumentException("Field '$field' is fractional or out of range for Long: $raw", e)
        }
    }

    /**
     * Strictly parses [raw] as an exact 32-bit integer.
     */
    fun requireExactInt(raw: Any?, field: String): Int {
        val longVal = requireExactLong(raw, field)
        if (longVal < Int.MIN_VALUE || longVal > Int.MAX_VALUE) {
            throw IllegalArgumentException("Field '$field' out of range for Int: $longVal")
        }
        return longVal.toInt()
    }

    /**
     * Reads a safe 64-bit integer from a [JSONObject].
     * Returns [default] if the key is missing, null, not a finite number,
     * has a fractional component, or falls outside [min]..[max].
     */
    fun optSafeLong(
        json: JSONObject,
        key: String,
        default: Long? = null,
        min: Long = MIN_SAFE_INTEGER,
        max: Long = MAX_SAFE_INTEGER,
    ): Long? {
        if (!json.has(key) || json.isNull(key)) return default
        val raw = json.opt(key) ?: return default
        return try {
            val v = requireExactLong(raw, key)
            if (v in min..max) v else default
        } catch (_: IllegalArgumentException) {
            default
        }
    }

    /**
     * Reads a 32-bit integer from a [JSONObject].
     */
    fun optSafeInt(
        json: JSONObject,
        key: String,
        default: Int? = null,
        min: Int = Int.MIN_VALUE,
        max: Int = Int.MAX_VALUE,
    ): Int? {
        if (!json.has(key) || json.isNull(key)) return default
        val raw = json.opt(key) ?: return default
        return try {
            val v = requireExactInt(raw, key)
            if (v in min..max) v else default
        } catch (_: IllegalArgumentException) {
            default
        }
    }

    /**
     * Reads a basis point value (by default in 0..10000) from a [JSONObject].
     */
    fun optBoundedBps(
        json: JSONObject,
        key: String,
        min: Int = 0,
        max: Int = 10000,
        default: Int? = null,
    ): Int? {
        return optSafeInt(json, key, default, min = min, max = max)
    }
}
