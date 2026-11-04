package com.yansuu1.jizhang.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SalaryTemplateStateTest {

    @Test
    fun deletedDefaultCategoryRequiresRepair() {
        val activeCategories = setOf("cat-food", "cat-rent")

        // Template references cat-food (active) and cat-deleted (deleted)
        val template = JSONObject().apply {
            put("id", "tpl-1")
            put("name", "默认分配")
            put("isDefault", true)
            put(
                "modules",
                JSONArray().apply {
                    put(JSONObject().put("categoryId", "cat-food").put("ratio", 50))
                    put(JSONObject().put("categoryId", "cat-deleted").put("ratio", 50))
                },
            )
        }

        assertFalse(
            "Template referencing deleted category must not be usable",
            template.isUsableSalaryTemplate(activeCategories),
        )
    }

    @Test
    fun templateWithAllActiveCategoriesIsUsable() {
        val activeCategories = setOf("cat-food", "cat-rent", "cat-invest")

        val template = JSONObject().apply {
            put("id", "tpl-1")
            put("name", "正常模板")
            put("isDefault", true)
            put(
                "modules",
                JSONArray().apply {
                    put(JSONObject().put("categoryId", "cat-food").put("ratio", 50))
                    put(JSONObject().put("categoryId", "cat-rent").put("ratio", 50))
                },
            )
        }

        assertTrue(
            "Template where all categories are active must be usable",
            template.isUsableSalaryTemplate(activeCategories),
        )
    }

    @Test
    fun templateWithBlankIdOrEmptyModulesIsNotUsable() {
        val activeCategories = setOf("cat-food")

        // Blank id
        val blankIdTemplate = JSONObject().apply {
            put("id", "")
            put("modules", JSONArray().put(JSONObject().put("categoryId", "cat-food")))
        }
        assertFalse(blankIdTemplate.isUsableSalaryTemplate(activeCategories))

        // Empty modules
        val emptyModulesTemplate = JSONObject().apply {
            put("id", "tpl-2")
            put("modules", JSONArray())
        }
        assertFalse(emptyModulesTemplate.isUsableSalaryTemplate(activeCategories))

        // Null modules
        val nullModulesTemplate = JSONObject().apply {
            put("id", "tpl-3")
        }
        assertFalse(nullModulesTemplate.isUsableSalaryTemplate(activeCategories))

        // Module missing categoryId
        val missingCatIdTemplate = JSONObject().apply {
            put("id", "tpl-4")
            put("modules", JSONArray().put(JSONObject().put("categoryId", "")))
        }
        assertFalse(missingCatIdTemplate.isUsableSalaryTemplate(activeCategories))
    }
}
