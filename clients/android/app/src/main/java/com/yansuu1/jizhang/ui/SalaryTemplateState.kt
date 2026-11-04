package com.yansuu1.jizhang.ui

import org.json.JSONObject

/**
 * Validates usability of a salary allocation template against currently active categories.
 *
 * Requirements:
 * 1. Template `id` is non-blank.
 * 2. `modules` array exists and has at least one element.
 * 3. Every module in `modules` references a non-blank `categoryId` that belongs to [activeCategoryIds].
 */
internal fun JSONObject.isUsableSalaryTemplate(activeCategoryIds: Set<String>): Boolean {
    val templateId = optString("id")
    if (templateId.isBlank()) return false
    val modules = optJSONArray("modules") ?: return false
    if (modules.length() == 0) return false
    for (i in 0 until modules.length()) {
        val module = modules.optJSONObject(i) ?: return false
        val categoryId = module.optString("categoryId")
        if (categoryId.isBlank() || categoryId !in activeCategoryIds) {
            return false
        }
    }
    return true
}
