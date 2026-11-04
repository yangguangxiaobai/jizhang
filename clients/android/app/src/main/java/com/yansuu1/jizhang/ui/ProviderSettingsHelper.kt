package com.yansuu1.jizhang.ui

object ProviderSettingsHelper {

    val POPULAR_MODELS = listOf(
        "gpt-4o-mini",
        "gpt-4o",
        "deepseek-chat",
        "deepseek-reasoner",
        "claude-3-5-sonnet",
        "qwen-plus"
    )

    /**
     * 智能规范化用户输入的 URL。
     * 当用户在 New API / OpenAI 兼容模式下输入根域名或 /v1 时，自动补全为标准的 /v1/chat/completions。
     */
    fun normalizeUrl(input: String, mode: String = "chat-completions"): String {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return ""
        if (mode != "chat-completions") return trimmed

        val clean = trimmed.trimEnd('/')
        return when {
            clean.endsWith("/v1/chat/completions", ignoreCase = true) -> clean
            clean.endsWith("/chat/completions", ignoreCase = true) -> clean
            clean.endsWith("/v1", ignoreCase = true) -> "$clean/chat/completions"
            clean.startsWith("http://", ignoreCase = true) || clean.startsWith("https://", ignoreCase = true) -> {
                "$clean/v1/chat/completions"
            }
            else -> clean
        }
    }

    /**
     * 判断当前 URL 是否匹配 New API / OpenAI 兼容中转站的常见模式
     */
    fun isOpenAiCompatible(url: String): Boolean {
        val lower = url.lowercase()
        return lower.contains("/chat/completions")
    }

    /**
     * 校验超时时间，返回错误提示；若合法返回 null
     */
    fun validateTimeout(timeoutMs: String): String? {
        val value = timeoutMs.trim().toIntOrNull()
        return if (value == null || value !in 3_000..60_000) {
            "请输入 3000 到 60000 之间的整数毫秒。"
        } else null
    }

    /**
     * 校验请求头 JSON 字符串，返回错误提示；若合法返回 null
     */
    fun validateHeaders(headersJson: String): String? {
        return try {
            org.json.JSONObject(headersJson)
            null
        } catch (_: Exception) {
            "请求头必须是有效的 JSON 对象。"
        }
    }

    /**
     * 根据模式提供默认响应路径
     */
    fun defaultResponsePath(mode: String): String = when (mode) {
        "responses" -> "output_text"
        "chat-completions" -> "choices[0].message.content"
        else -> ""
    }

    /**
     * 生成高级设置卡片折叠时的精简摘要
     */
    fun formatAdvancedSummary(method: String, timeoutMs: String, authKind: String): String {
        val authDesc = when (authKind) {
            "bearer" -> "Bearer"
            "header" -> "自定义头"
            "none" -> "无认证"
            else -> authKind
        }
        val timeoutClean = timeoutMs.trim()
        val timeoutSec = timeoutClean.toIntOrNull()?.let { "${it}ms" } ?: timeoutClean
        return "HTTP $method · 超时 $timeoutSec · $authDesc"
    }

    /**
     * 检查当前草稿相对于服务器已保存配置是否有变动
     */
    internal fun isDraftDirty(draft: ProviderDraft, savedDraft: ProviderDraft?, secret: String, clearSecret: Boolean): Boolean {
        if (savedDraft == null) return false
        return draft != savedDraft || secret.isNotEmpty() || clearSecret
    }

    /**
     * 服务端真实已保存状态文案（与本地草稿无关）
     */
    internal fun savedStatusLabel(savedDraft: ProviderDraft?): String {
        return if (savedDraft?.enabled == true) "服务端已启用" else "服务端未启用"
    }

    /**
     * 本地草稿变动提示（当草稿与已保存配置不一致时展示）
     */
    internal fun draftStatusBadge(draft: ProviderDraft, savedDraft: ProviderDraft?, secret: String, clearSecret: Boolean): String? {
        if (savedDraft == null) return null
        if (!isDraftDirty(draft, savedDraft, secret, clearSecret)) return null
        return if (draft.enabled != savedDraft.enabled) {
            if (draft.enabled) "草稿已开启（待保存）" else "草稿已关闭（待保存）"
        } else {
            "草稿已修改（待保存）"
        }
    }

    /**
     * 测试结果是否仍然有效。一旦已保存配置变更或当前草稿有变动，旧测试结果视为失效。
     */
    internal fun isTestResultValid(
        testedSavedDraft: ProviderDraft?,
        currentSavedDraft: ProviderDraft?,
        hasUnsavedChanges: Boolean,
    ): Boolean {
        if (hasUnsavedChanges) return false
        return testedSavedDraft != null && testedSavedDraft == currentSavedDraft
    }
}
