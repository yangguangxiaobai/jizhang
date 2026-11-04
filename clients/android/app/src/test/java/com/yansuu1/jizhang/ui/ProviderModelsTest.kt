package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.ProviderModels
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProviderModelsTest {
    private fun payload(vararg ids: Any?): JSONObject = JSONObject().put("items",
        JSONArray().apply { ids.forEach { put(JSONObject().put("id", it ?: JSONObject.NULL)) } })

    @Test fun decodesAndDeduplicatesWithoutChangingOrderOrCase() {
        assertEquals(listOf("gpt-test", "DeepSeek/chat"), ProviderModels.decode(payload("gpt-test", "DeepSeek/chat", "gpt-test")))
    }

    @Test fun emptyIsValidButMissingArrayIsNot() {
        assertTrue(ProviderModels.decode(payload()).isEmpty())
        assertThrows(IllegalStateException::class.java) { ProviderModels.decode(JSONObject()) }
        assertThrows(IllegalStateException::class.java) { ProviderModels.decode(JSONObject().put("items", "wrong")) }
    }

    @Test fun invalidIdsAreNotSilentlySkipped() {
        for (id in listOf(null, 42, true, "", " padded", "x\ny", "a\u007fb", "x".repeat(201))) {
            assertThrows(IllegalArgumentException::class.java) { ProviderModels.decode(payload(id)) }
        }
        assertThrows(IllegalStateException::class.java) {
            ProviderModels.decode(JSONObject().put("items", JSONArray().put("not-object")))
        }
    }

    @Test fun listCapRejectsRatherThanTruncates() {
        assertEquals(2000, ProviderModels.decode(payload(*(0 until 2000).map { "m-$it" }.toTypedArray())).size)
        assertThrows(IllegalArgumentException::class.java) {
            ProviderModels.decode(payload(*(0..2000).map { "m-$it" }.toTypedArray()))
        }
    }

    @Test fun searchIsTrimmedCaseInsensitiveAndDoesNotMutateSource() {
        val ids = listOf("DeepSeek/chat", "gpt-test", "provider/GPT-test")
        assertEquals(listOf("gpt-test", "provider/GPT-test"), ProviderModels.search(ids, " GPT "))
        assertEquals(ids, ProviderModels.search(ids, " "))
        assertTrue(ProviderModels.search(ids, "not-found").isEmpty())
        assertEquals(3, ids.size)
    }

    @Test fun modelOnlyEditAllowsDiscoveryButConnectionChangesRequireSave() {
        val saved = ProviderDraft(url = "https://example.test/v1/chat/completions", model = "old")
        assertTrue(saved.copy(model = "new").canDiscoverModels(saved, "", false))
        assertFalse(saved.copy(url = "https://other.test/v1/chat/completions").canDiscoverModels(saved, "", false))
        assertFalse(saved.copy(headers = "{\"x\":\"v\"}").canDiscoverModels(saved, "", false))
        assertFalse(saved.canDiscoverModels(saved, "new-secret", false))
        assertFalse(saved.canDiscoverModels(saved, "", true))
        assertFalse(saved.canDiscoverModels(null, "", false))
    }

    @Test fun disabledBlankModelSupportsBootstrapWhileCustomDoesNot() {
        val initial = ProviderDraft(enabled = false, url = "https://example.test/v1/chat/completions")
        assertTrue(initial.canDiscoverModels(initial, "", false))
        val custom = initial.copy(mode = "custom")
        assertFalse(custom.canDiscoverModels(custom, "", false))
        val empty = ProviderDraft()
        assertFalse(empty.canDiscoverModels(empty, "", false))
    }
}
