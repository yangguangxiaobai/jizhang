package com.yansuu1.jizhang.repo

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialGoalModelsTest {

    @Test
    fun decodesReadyGoalViewWithReserveAndInvestment() {
        val json = readyGoalPayload()
        val view = FinancialGoalView.fromJson(json)

        assertEquals(1, view.contractVersion)
        assertEquals("manual-confirmed", view.source)
        assertEquals(3L, view.revision)
        assertEquals("ready", view.state)
        assertTrue(view.isConfigured)

        // Reserve opening
        val resOpening = view.reserveOpening
        assertNotNull(resOpening)
        assertEquals(ManualGoal.RESERVE, resOpening?.goal)
        assertEquals(12_000L, resOpening?.openingCents)
        assertEquals(1_767_225_600_000L, resOpening?.openingAt)

        // Investment opening
        val invOpening = view.investmentOpening
        assertNotNull(invOpening)
        assertEquals(ManualGoal.INVESTMENT, invOpening?.goal)
        assertEquals(5_000L, invOpening?.openingCents)

        // Reserve progress
        val resProgress = view.reserveProgress
        assertNotNull(resProgress)
        assertEquals("manual-confirmed", resProgress?.source)
        assertEquals(12_500L, resProgress?.balanceCents)
        assertEquals(ManualGoalTargetState.READY, resProgress?.targetState)
        assertEquals(25_000L, resProgress?.targetCents)
        assertEquals(50, resProgress?.progressPercent)
        assertEquals(12_500L, resProgress?.gapCents)
        assertEquals(9, resProgress?.conditionalContributionCount)

        // Investment progress
        val invProgress = view.investmentProgress
        assertNotNull(invProgress)
        assertEquals(6_500L, invProgress?.balanceCents)
        assertEquals(ManualGoalTargetState.NOT_APPLICABLE, invProgress?.targetState)
        assertNull(invProgress?.targetCents)
        assertNull(invProgress?.conditionalContributionCount)

        // Window
        val window = view.window
        assertNotNull(window)
        assertEquals(1_767_225_600_000L, window?.from)
        assertEquals(1_769_904_000_000L, window?.to)
        assertEquals(2, window?.entryCount)
        assertEquals(500L, window?.reserve?.netAdditionsCents)
        assertEquals(0L, window?.investment?.netAdditionsCents)
    }

    @Test
    fun decodesNotConfiguredGoalView() {
        val json = JSONObject().apply {
            put("contractVersion", 1)
            put("calculatedAt", 1_793_000_000_000L)
            put("source", "manual-confirmed")
            put("revision", 0L)
            put("state", "not-configured")
            put("opening", JSONObject().apply {
                put("reserve", JSONObject.NULL)
                put("investment", JSONObject.NULL)
            })
            put("progress", JSONObject().apply {
                put("asOf", 1_793_000_000_000L)
                put("reserve", JSONObject.NULL)
                put("investment", JSONObject.NULL)
            })
            put("window", JSONObject.NULL)
        }
        val view = FinancialGoalView.fromJson(json)
        assertEquals("not-configured", view.state)
        assertFalse(view.isConfigured)
        assertNull(view.reserveOpening)
        assertNull(view.investmentOpening)
        assertNull(view.reserveProgress)
        assertNull(view.investmentProgress)
    }

    @Test
    fun decodesHistoricalWindowBeforeOpeningWithNotStartedAndNullBalance() {
        val json = readyGoalPayload().apply {
            getJSONObject("progress").getJSONObject("reserve").apply {
                put("targetState", "not-started")
                put("balanceCents", JSONObject.NULL)
                put("targetCents", JSONObject.NULL)
                put("gapCents", JSONObject.NULL)
                put("conditionalContributionCount", JSONObject.NULL)
            }
        }
        val view = FinancialGoalView.fromJson(json)
        val res = view.reserveProgress
        assertNotNull(res)
        assertEquals(ManualGoalTargetState.NOT_STARTED, res?.targetState)
        assertNull(res?.balanceCents)
        assertNull(res?.targetCents)
        assertNull(res?.gapCents)
    }

    @Test
    fun rejectsSourceOtherThanManualConfirmed() {
        val json = readyGoalPayload().apply {
            put("source", "bank-verified")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialGoalView.fromJson(json)
        }
    }

    @Test
    fun rejectsFloatingPointOrUnsafeAmounts() {
        val json = readyGoalPayload().apply {
            getJSONObject("progress").getJSONObject("reserve").put("balanceCents", 1234.56)
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialGoalView.fromJson(json)
        }
    }

    @Test
    fun decodesEntryPageViewWithPaging() {
        val json = JSONObject().apply {
            put("contractVersion", 1)
            put("calculatedAt", 1_793_000_000_000L)
            put("source", "manual-confirmed")
            put("revision", 2L)
            put("total", 1)
            put("limit", 50)
            put("hasMore", false)
            put("nextCursor", JSONObject.NULL)
            put("items", JSONArray().apply {
                put(JSONObject().apply {
                    put("id", "e1")
                    put("goal", "reserve")
                    put("kind", "deposit")
                    put("amountCents", 1500L)
                    put("date", 1_767_225_600_000L)
                    put("note", "工资存入")
                    put("revision", 1L)
                    put("createdAt", 1_767_225_600_000L)
                    put("updatedAt", 1_767_225_600_000L)
                    put("deletedAt", JSONObject.NULL)
                })
            })
        }
        val page = FinancialGoalEntryPageView.fromJson(json)
        assertEquals(1, page.total)
        assertFalse(page.hasMore)
        assertNull(page.nextCursor)
        assertEquals(1, page.items.size)

        val entry = page.items[0]
        assertEquals("e1", entry.id)
        assertEquals(ManualGoal.RESERVE, entry.goal)
        assertEquals(ManualGoalEntryKind.DEPOSIT, entry.kind)
        assertEquals(1500L, entry.amountCents)
        assertEquals("工资存入", entry.note)
        assertNull(entry.deletedAt)
    }

    private fun readyGoalPayload(): JSONObject = JSONObject(
        """
        {
          "contractVersion": 1,
          "calculatedAt": 1793000000000,
          "source": "manual-confirmed",
          "revision": 3,
          "state": "ready",
          "opening": {
            "reserve": {
              "goal": "reserve",
              "openingCents": 12000,
              "openingAt": 1767225600000,
              "revision": 1,
              "updatedAt": 1767225600000
            },
            "investment": {
              "goal": "investment",
              "openingCents": 5000,
              "openingAt": 1767225600000,
              "revision": 1,
              "updatedAt": 1767225600000
            }
          },
          "progress": {
            "asOf": 1793000000000,
            "reserve": {
              "source": "manual-confirmed",
              "openingCents": 12000,
              "openingAt": 1767225600000,
              "depositCents": 1500,
              "withdrawalCents": 1000,
              "balanceCents": 12500,
              "targetState": "ready",
              "targetCents": 25000,
              "progressBasisPoints": 5000,
              "progressPercent": 50,
              "gapCents": 12500,
              "surplusCents": 0,
              "conditionalContributionCount": 9,
              "essentialMonthlyCents": 5000,
              "targetMonths": 5,
              "monthlyReferenceCents": 1500
            },
            "investment": {
              "source": "manual-confirmed",
              "openingCents": 5000,
              "openingAt": 1767225600000,
              "depositCents": 2500,
              "withdrawalCents": 1000,
              "balanceCents": 6500,
              "targetState": "not-applicable",
              "targetCents": null,
              "progressBasisPoints": null,
              "progressPercent": null,
              "gapCents": null,
              "surplusCents": null,
              "conditionalContributionCount": null,
              "essentialMonthlyCents": null,
              "targetMonths": null,
              "monthlyReferenceCents": null
            }
          },
          "window": {
            "from": 1767225600000,
            "to": 1769904000000,
            "entryCount": 2,
            "reserve": {
              "depositCents": 1500,
              "withdrawalCents": 1000,
              "netAdditionsCents": 500,
              "entryCount": 2
            },
            "investment": {
              "depositCents": 0,
              "withdrawalCents": 0,
              "netAdditionsCents": 0,
              "entryCount": 0
            }
          }
        }
        """.trimIndent(),
    )
}
