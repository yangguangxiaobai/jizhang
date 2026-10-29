package com.yansuu1.jizhang.net

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JsonNumberReadersTest {

    @Test
    fun optSafeLongReturnsValueForValidSafeIntegers() {
        val json = JSONObject()
            .put("zero", 0L)
            .put("positive", 123456789L)
            .put("negative", -987654321L)
            .put("maxSafe", JsonNumberReaders.MAX_SAFE_INTEGER)
            .put("minSafe", JsonNumberReaders.MIN_SAFE_INTEGER)

        assertEquals(0L, JsonNumberReaders.optSafeLong(json, "zero"))
        assertEquals(123456789L, JsonNumberReaders.optSafeLong(json, "positive"))
        assertEquals(-987654321L, JsonNumberReaders.optSafeLong(json, "negative"))
        assertEquals(JsonNumberReaders.MAX_SAFE_INTEGER, JsonNumberReaders.optSafeLong(json, "maxSafe"))
        assertEquals(JsonNumberReaders.MIN_SAFE_INTEGER, JsonNumberReaders.optSafeLong(json, "minSafe"))
    }

    @Test
    fun optSafeLongReturnsDefaultForMissingNullAndString() {
        val json = JSONObject()
            .put("nullField", JSONObject.NULL)
            .put("stringNumber", "12345")
            .put("emptyString", "")

        assertNull(JsonNumberReaders.optSafeLong(json, "missing"))
        assertEquals(99L, JsonNumberReaders.optSafeLong(json, "missing", default = 99L))
        assertNull(JsonNumberReaders.optSafeLong(json, "nullField"))
        assertNull(JsonNumberReaders.optSafeLong(json, "stringNumber"))
        assertNull(JsonNumberReaders.optSafeLong(json, "emptyString"))
    }

    @Test
    fun optSafeLongRejectsFractionalAndNonFiniteFloats() {
        val json = JSONObject()
            .put("fractional", 123.45)

        assertNull(JsonNumberReaders.optSafeLong(json, "fractional"))

        // Rejection of non-finite numbers at exact parser layer
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            JsonNumberReaders.requireExactLong(Double.NaN, "nan")
        }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            JsonNumberReaders.requireExactLong(Double.POSITIVE_INFINITY, "infinity")
        }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            JsonNumberReaders.requireExactLong(Double.NEGATIVE_INFINITY, "negInfinity")
        }
    }

    @Test
    fun optSafeLongRejectsOutOfBoundsValues() {
        val json = JSONObject()
            .put("tooBig", 9007199254740992.0) // 2^53
            .put("tooSmall", -9007199254740992.0)
            .put("bounded", 50L)

        assertNull(JsonNumberReaders.optSafeLong(json, "tooBig"))
        assertNull(JsonNumberReaders.optSafeLong(json, "tooSmall"))
        // Test custom min/max
        assertEquals(50L, JsonNumberReaders.optSafeLong(json, "bounded", min = 0L, max = 100L))
        assertNull(JsonNumberReaders.optSafeLong(json, "bounded", min = 60L, max = 100L))
    }

    @Test
    fun optSafeIntRespects32BitBounds() {
        val json = JSONObject()
            .put("validInt", 42)
            .put("overflowInt", 3000000000L) // exceeds Int.MAX_VALUE

        assertEquals(42, JsonNumberReaders.optSafeInt(json, "validInt"))
        assertNull(JsonNumberReaders.optSafeInt(json, "overflowInt"))
        assertEquals(-1, JsonNumberReaders.optSafeInt(json, "overflowInt", default = -1))
    }

    @Test
    fun optBoundedBpsEnforcesStandardBasisPointsRange() {
        val json = JSONObject()
            .put("validBps", 2500)
            .put("zeroBps", 0)
            .put("fullBps", 10000)
            .put("negativeBps", -1)
            .put("overBps", 10001)

        assertEquals(2500, JsonNumberReaders.optBoundedBps(json, "validBps"))
        assertEquals(0, JsonNumberReaders.optBoundedBps(json, "zeroBps"))
        assertEquals(10000, JsonNumberReaders.optBoundedBps(json, "fullBps"))
        assertNull(JsonNumberReaders.optBoundedBps(json, "negativeBps"))
        assertNull(JsonNumberReaders.optBoundedBps(json, "overBps"))
    }
}
