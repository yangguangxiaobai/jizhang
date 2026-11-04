package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderSettingsHelperTest {

    @Test
    fun normalizeUrl_rootDomain_appendsV1ChatCompletions() {
        assertEquals(
            "https://api.openai.com/v1/chat/completions",
            ProviderSettingsHelper.normalizeUrl("https://api.openai.com")
        )
        assertEquals(
            "https://my-new-api.com/v1/chat/completions",
            ProviderSettingsHelper.normalizeUrl("https://my-new-api.com/")
        )
    }

    @Test
    fun normalizeUrl_v1Path_appendsChatCompletions() {
        assertEquals(
            "https://api.deepseek.com/v1/chat/completions",
            ProviderSettingsHelper.normalizeUrl("https://api.deepseek.com/v1")
        )
        assertEquals(
            "https://api.deepseek.com/v1/chat/completions",
            ProviderSettingsHelper.normalizeUrl("https://api.deepseek.com/v1/")
        )
    }

    @Test
    fun normalizeUrl_fullPath_preserves() {
        assertEquals(
            "https://api.openai.com/v1/chat/completions",
            ProviderSettingsHelper.normalizeUrl("https://api.openai.com/v1/chat/completions")
        )
    }

    @Test
    fun normalizeUrl_customMode_preservesExact() {
        assertEquals(
            "https://custom-api.com/custom/endpoint",
            ProviderSettingsHelper.normalizeUrl("https://custom-api.com/custom/endpoint", mode = "custom")
        )
    }

    @Test
    fun isOpenAiCompatible_detectsCorrectly() {
        assertTrue(ProviderSettingsHelper.isOpenAiCompatible("https://api.new-api.com/v1/chat/completions"))
        assertFalse(ProviderSettingsHelper.isOpenAiCompatible("https://api.anthropic.com/v1/messages"))
    }

    @Test
    fun validateTimeout_boundaryChecks() {
        org.junit.Assert.assertNull(ProviderSettingsHelper.validateTimeout("3000"))
        org.junit.Assert.assertNull(ProviderSettingsHelper.validateTimeout("20000"))
        org.junit.Assert.assertNull(ProviderSettingsHelper.validateTimeout("60000"))
        assertEquals("请输入 3000 到 60000 之间的整数毫秒。", ProviderSettingsHelper.validateTimeout("2999"))
        assertEquals("请输入 3000 到 60000 之间的整数毫秒。", ProviderSettingsHelper.validateTimeout("60001"))
        assertEquals("请输入 3000 到 60000 之间的整数毫秒。", ProviderSettingsHelper.validateTimeout("abc"))
        assertEquals("请输入 3000 到 60000 之间的整数毫秒。", ProviderSettingsHelper.validateTimeout(""))
    }

    @Test
    fun validateHeaders_jsonChecks() {
        org.junit.Assert.assertNull(ProviderSettingsHelper.validateHeaders("{}"))
        org.junit.Assert.assertNull(ProviderSettingsHelper.validateHeaders("{\"Authorization\":\"test\"}"))
        assertEquals("请求头必须是有效的 JSON 对象。", ProviderSettingsHelper.validateHeaders("not a json"))
        assertEquals("请求头必须是有效的 JSON 对象。", ProviderSettingsHelper.validateHeaders("{broken"))
    }

    @Test
    fun defaultResponsePath_checks() {
        assertEquals("choices[0].message.content", ProviderSettingsHelper.defaultResponsePath("chat-completions"))
        assertEquals("output_text", ProviderSettingsHelper.defaultResponsePath("responses"))
        assertEquals("", ProviderSettingsHelper.defaultResponsePath("custom"))
    }

    @Test
    fun formatAdvancedSummary_checks() {
        val summary = ProviderSettingsHelper.formatAdvancedSummary("POST", "20000", "bearer")
        assertEquals("HTTP POST · 超时 20000ms · Bearer", summary)

        val headerSummary = ProviderSettingsHelper.formatAdvancedSummary("GET", "5000", "header")
        assertEquals("HTTP GET · 超时 5000ms · 自定义头", headerSummary)
    }

    @Test
    fun savedStatusLabel_independentOfDraft() {
        val savedDisabled = ProviderDraft(enabled = false)
        val savedEnabled = ProviderDraft(enabled = true)

        assertEquals("服务端未启用", ProviderSettingsHelper.savedStatusLabel(null))
        assertEquals("服务端未启用", ProviderSettingsHelper.savedStatusLabel(savedDisabled))
        assertEquals("服务端已启用", ProviderSettingsHelper.savedStatusLabel(savedEnabled))
    }

    @Test
    fun draftStatusBadge_detectsDraftChanges() {
        val saved = ProviderDraft(enabled = false, model = "m1")
        org.junit.Assert.assertNull(ProviderSettingsHelper.draftStatusBadge(saved, saved, "", false))

        val draftEnabled = saved.copy(enabled = true)
        assertEquals("草稿已开启（待保存）", ProviderSettingsHelper.draftStatusBadge(draftEnabled, saved, "", false))

        val savedOn = ProviderDraft(enabled = true, model = "m1")
        val draftDisabled = savedOn.copy(enabled = false)
        assertEquals("草稿已关闭（待保存）", ProviderSettingsHelper.draftStatusBadge(draftDisabled, savedOn, "", false))

        val draftModelChanged = saved.copy(model = "m2")
        assertEquals("草稿已修改（待保存）", ProviderSettingsHelper.draftStatusBadge(draftModelChanged, saved, "", false))
    }

    @Test
    fun isTestResultValid_invalidatedOnDraftOrConfigChange() {
        val savedV1 = ProviderDraft(url = "https://v1.test/v1/chat/completions", model = "m1")
        val savedV2 = ProviderDraft(url = "https://v2.test/v1/chat/completions", model = "m1")

        // Valid when tested on current saved config and no unsaved changes
        assertTrue(ProviderSettingsHelper.isTestResultValid(savedV1, savedV1, hasUnsavedChanges = false))

        // Invalid if unsaved changes exist
        assertFalse(ProviderSettingsHelper.isTestResultValid(savedV1, savedV1, hasUnsavedChanges = true))

        // Invalid if saved config changed after test
        assertFalse(ProviderSettingsHelper.isTestResultValid(savedV1, savedV2, hasUnsavedChanges = false))
        assertFalse(ProviderSettingsHelper.isTestResultValid(null, savedV1, hasUnsavedChanges = false))
    }
}
