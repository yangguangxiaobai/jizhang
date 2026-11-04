package com.yansuu1.jizhang.repo

import org.json.JSONObject

/** Minimal bounded model ids; no upstream metadata, credentials or raw errors. */
object ProviderModels {
    const val MAX_ITEMS = 2_000

    fun decode(payload: JSONObject): List<String> {
        val items = payload.optJSONArray("items") ?: error("模型列表格式无法识别，可继续手动填写模型名。")
        require(items.length() <= MAX_ITEMS) { "模型列表过大，请手动填写模型名。" }
        return buildList {
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: error("模型列表条目格式无效。")
                val raw = item.opt("id")
                require(raw is String && raw.isNotBlank() && raw.length <= 200 &&
                    raw == raw.trim() && raw.none { it.code < 32 || it.code in 127..159 }) {
                    "模型名称格式无效，可继续手动填写模型名。"
                }
                add(raw)
            }
        }.distinct()
    }

    fun search(ids: List<String>, query: String): List<String> {
        val needle = query.trim()
        return if (needle.isEmpty()) ids else ids.filter { it.contains(needle, ignoreCase = true) }
    }
}
