import XCTest
@testable import Jizhang

final class LedgerContractTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    func testMoneyPreservesEveryCentAndDoesNotOverflowAtInt64Minimum() {
        XCTAssertEqual(LedgerFormat.money(0), "¥0.00")
        XCTAssertEqual(LedgerFormat.money(1), "¥0.01")
        XCTAssertEqual(LedgerFormat.money(100_001), "¥1,000.01")
        XCTAssertEqual(LedgerFormat.money(-123), "¥-1.23")
        XCTAssertEqual(LedgerFormat.money(9_007_199_254_740_991), "¥90,071,992,547,409.91")
        XCTAssertEqual(LedgerFormat.money(Int64.min), "¥-92,233,720,368,547,758.08")
        XCTAssertEqual(LedgerFormat.money(Int64.max), "¥92,233,720,368,547,758.07")
    }

    func testEpochMillisecondsUseTheDisplayedCalendarDay() {
        XCTAssertEqual(LedgerFormat.dayKey(1_704_038_399_999), "2023-12-31")
        XCTAssertEqual(LedgerFormat.dayKey(1_704_038_400_000), "2024-01-01")
        XCTAssertEqual(LedgerFormat.date(1_704_038_400_000, time: true), "2024年1月1日 00:00")
    }

    func testQueryKeepsExactFiltersAndEscapesChinesePlusAndSeparators() throws {
        let query = LedgerBillQuery(text: "  早餐 + 咖啡&茶  ", type: 0, accountId: "a/1?", categoryId: "c&2", tag: "A+B")
        let path = query.path(offset: 50, limit: 50)
        let url = try XCTUnwrap(URLComponents(string: "https://example.test" + path))
        let pairs = try XCTUnwrap(url.queryItems)
        let values = Dictionary(uniqueKeysWithValues: pairs.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.path, "/transactions")
        XCTAssertEqual(pairs.count, 7)
        XCTAssertEqual(values["search"], "早餐 + 咖啡&茶")
        XCTAssertEqual(values["accountId"], "a/1?")
        XCTAssertEqual(values["categoryId"], "c&2")
        XCTAssertEqual(values["tag"], "A+B")
        XCTAssertEqual(values["type"], "0")
        XCTAssertEqual(values["offset"], "50")
        XCTAssertTrue(path.contains("%2B"))
        XCTAssertFalse(path.contains("+"))
        XCTAssertFalse(LedgerBillQuery(text: " \n ").path().contains("search="))
    }

    func testPathSegmentCannotTurnAnIdentifierIntoAnotherRoute() {
        XCTAssertEqual(LedgerURL.segment("a/b?#"), "a%2Fb%3F%23")
    }

    func testRefundRemainsIncomeAndIntegerCentsAreRequired() throws {
        let value = try decode(LedgerTransaction.self, Self.refund)
        XCTAssertEqual(value.type, .income)
        XCTAssertEqual(value.amountCents, 3_001)
        XCTAssertTrue(value.isRefund)
        XCTAssertEqual(value.kindTitle, "退款收入")
        XCTAssertEqual(value.refundLinkedTxIds, ["expense-1"])
        XCTAssertNil(value.fundPurpose)
        XCTAssertThrowsError(try decode(LedgerTransaction.self, Self.refund.replacingOccurrences(of: "3001", with: "3001.5")))
        XCTAssertThrowsError(try decode(LedgerTransaction.self, Self.refund.replacingOccurrences(of: "\"amountCents\":3001,", with: "")))
    }

    func testTransactionPageRejectsRepeatedRowsAndShiftedOffsets() throws {
        let page = try decode(LedgerTransactionPage.self, """
        {"items":[\(Self.refund)],"total":51,"limit":50,"offset":50,"searchVersion":1,"searchRevision":"revision-a"}
        """)
        XCTAssertNoThrow(try page.validate(expectedOffset: 50, expectedLimit: 50, requiresSearch: true))
        XCTAssertThrowsError(try page.validate(expectedOffset: 0, expectedLimit: 50))
        let duplicate = try decode(LedgerTransactionPage.self, """
        {"items":[\(Self.refund),\(Self.refund)],"total":2,"limit":50,"offset":0}
        """)
        XCTAssertThrowsError(try duplicate.validate(expectedOffset: 0, expectedLimit: 50))
        let inconsistent = try decode(LedgerTransactionPage.self, """
        {"items":[\(Self.refund)],"total":0,"limit":50,"offset":0}
        """)
        XCTAssertThrowsError(try inconsistent.validate(expectedOffset: 0, expectedLimit: 50))
        let oldServer = try decode(LedgerTransactionPage.self, """
        {"items":[\(Self.refund)],"total":1,"limit":50,"offset":0}
        """)
        XCTAssertNoThrow(try oldServer.validate(expectedOffset: 0, expectedLimit: 50))
        XCTAssertThrowsError(try oldServer.validate(expectedOffset: 0, expectedLimit: 50, requiresSearch: true))
    }

    func testBalanceResponseKeepsServerTotalsAndMissingMoneyFails() throws {
        let json = """
        {"items":[{"accountId":"credit","name":"信用卡","type":2,"initialBalanceCents":-10000,
        "incomeCents":3000,"expenseCents":2000,"salaryCents":0,"transferInCents":0,"transferOutCents":0,"balanceCents":-9000}],
        "totalBalanceCents":-9000,"totalAssetsCents":0,"totalLiabilitiesCents":9000}
        """
        let balance = try decode(LedgerBalances.self, json)
        XCTAssertEqual(balance.totalBalanceCents, -9_000)
        XCTAssertEqual(balance.totalLiabilitiesCents, 9_000)
        XCTAssertEqual(balance.items.first?.incomeCents, 3_000)
        XCTAssertThrowsError(try decode(LedgerBalances.self, json.replacingOccurrences(of: "\"totalBalanceCents\":-9000,", with: "")))
        XCTAssertThrowsError(try decode(LedgerBalances.self, "{\"message\":\"unavailable\"}"))
    }

    func testMonthlyTrendRetainsGrossExpenseAndSeparateRefundIncome() throws {
        let trend = try decode(LedgerTrend.self, """
        {"items":[{"month":"2026-01","monthStart":1767196800000,"incomeCents":3000,"netExpenseCents":10000,
        "refundIncomeCents":3000,"salaryIncomeCents":0}],
        "range":{"from":1767196800000,"to":1769875200000,"months":1,"endMonth":"2026-01","label":"2026-01"}}
        """)
        XCTAssertEqual(trend.items.first?.netExpenseCents, 10_000)
        XCTAssertEqual(trend.items.first?.incomeCents, 3_000)
        XCTAssertEqual(trend.items.first?.refundIncomeCents, 3_000)
        XCTAssertEqual(trend.range?.from, 1_767_196_800_000)
    }

    func testStatsWindowUsesServerBoundsIncludingNonCalendarThirtyDays() throws {
        let window = try decode(LedgerStatsWindow.self, """
        {"kind":"last30","from":1788408000000,"to":1791000000000,"timeZone":"Asia/Shanghai","label":"近30天 · 截至现在"}
        """)
        XCTAssertEqual(window.from, 1_788_408_000_000)
        XCTAssertEqual(window.to, 1_791_000_000_000)
        XCTAssertEqual(window.label, "近30天 · 截至现在")
        XCTAssertEqual(window.timeZone, "Asia/Shanghai")
    }

    func testFundSummaryKeepsCumulativeNegativeBalanceAndIncompleteCoverage() throws {
        let summary = try decode(LedgerFundSummary.self, Self.fundSummary)
        XCTAssertNoThrow(try summary.validate())
        XCTAssertEqual(summary.balances.essentials, -7_000)
        XCTAssertEqual(summary.totals.grossSpent.essentials, 10_000)
        XCTAssertEqual(summary.totals.refunded.essentials, 3_000)
        XCTAssertFalse(summary.coverage.complete)
        XCTAssertEqual(summary.coverage.unallocatedSalaryCents, 100_000)
        XCTAssertEqual(summary.coverage.unknownUnallocatedSalaryCount, 1)
        XCTAssertThrowsError(try decode(LedgerFundSummary.self, Self.fundSummary.replacingOccurrences(of: ",\"unknownUnallocatedSalaryCount\":1", with: "")))
    }

    func testFundContractAndRatioValidationRejectUnsupportedOrMalformedValues() throws {
        let future = try decode(LedgerFundSummary.self, Self.fundSummary.replacingOccurrences(of: "\"contractVersion\":1", with: "\"contractVersion\":2"))
        XCTAssertThrowsError(try future.validate())
        let configuration = try decode(LedgerFundConfiguration.self, """
        {"contractVersion":1,"config":{"revision":0,"ratiosBps":{"growth":2500,"reserve":2500,"essentials":4000,"joy":1000},"timeZone":"Asia/Shanghai","updatedAt":null}}
        """)
        XCTAssertNoThrow(try configuration.validate())
        XCTAssertEqual(LedgerFormat.ratio(bps: configuration.config.ratiosBps.essentials), "40%")
        let bad = try decode(LedgerFundConfiguration.self, """
        {"contractVersion":1,"config":{"revision":0,"ratiosBps":{"growth":2500,"reserve":2500,"essentials":4000,"joy":1001},"timeZone":"Asia/Shanghai"}}
        """)
        XCTAssertThrowsError(try bad.validate())
    }

    func testLegacyPlanReviewNeverPresentsAnExactRemainingAmount() throws {
        let plan = try decode(LedgerMonthlyPlan.self, Self.monthlyPlan)
        XCTAssertNoThrow(try plan.validate())
        XCTAssertEqual(plan.summary?.remainingCents, 5_000)
        XCTAssertNil(plan.summary?.displayRemainingCents)
        let exact = try decode(LedgerMonthlyPlan.self, Self.monthlyPlan.replacingOccurrences(of: "review-required", with: "exact"))
        XCTAssertEqual(exact.summary?.displayRemainingCents, 5_000)
        let missing = try decode(LedgerMonthlyPlan.self, Self.monthlyPlan.replacingOccurrences(of: "review-required", with: "exact").replacingOccurrences(of: "5000", with: "null"))
        XCTAssertThrowsError(try missing.validate())
    }

    func testLegacyNoPeriodIsDistinctFromAZeroBudget() throws {
        let plan = try decode(LedgerMonthlyPlan.self, """
        {"state":"no-period","periodId":null,"revision":null,"window":null,"confirmedIncomeCents":null,"targetsCents":null,"summary":null}
        """)
        XCTAssertNoThrow(try plan.validate())
        XCTAssertEqual(plan.state, .noPeriod)
        XCTAssertNil(plan.summary)
    }

    func testUnknownItemCostsStayUnknownAndQuarterlyRulesDecode() throws {
        let item = try decode(LedgerItem.self, """
        {"id":"item-1","name":"相机","category":"摄影","brand":"","model":"","note":"",
        "purchasePriceCents":null,"purchaseDate":1704038400000,"status":"idle","closedDate":null,"salePriceCents":null,
        "purchaseTransactionId":null,"saleTransactionId":null,"photoUrl":null,"heldDays":12,
        "netCostCents":null,"dailyCostCents":null,"createdAt":1704038400000,"updatedAt":1704038400000}
        """)
        XCTAssertNil(item.purchasePriceCents)
        XCTAssertNil(item.dailyCostCents)
        XCTAssertEqual(item.status.title, "闲置")
        let rule = try decode(LedgerRecurringRule.self, """
        {"id":"rule-1","name":"订阅","type":0,"amountCents":9900,"categoryId":"c","accountId":"a","frequency":"quarterly",
        "anchorDate":1704038400000,"nextDueDate":1711900800000,"hasOlderDue":true,"enabled":true,"updatedAt":1704038400000}
        """)
        XCTAssertEqual(rule.frequency.title, "每季度")
        XCTAssertEqual(rule.nextDueDate, 1_711_900_800_000)
        XCTAssertTrue(rule.hasOlderDue)
    }

    func testSalaryFrozenGrantIsNotRecomputedUsingCurrentRatios() throws {
        let salary = try decode(LedgerSalaryDetail.self, """
        {"id":"s1","amountCents":10001,"date":1704038400000,"note":"","accountId":"a","allocations":[],
        "fundGrant":{"grantId":"g1","revision":2,"status":"active","sourceAmountCents":10001,
        "ratiosBps":{"growth":2500,"reserve":2500,"essentials":4000,"joy":1000},
        "targets":{"growth":2500,"reserve":2500,"essentials":4001,"joy":1000}}}
        """)
        XCTAssertEqual(salary.fundGrant?.targets.essentials, 4_001)
        XCTAssertEqual(salary.fundGrant?.revision, 2)
        XCTAssertEqual(salary.amountCents, 10_001)
    }

    private static let refund = """
    {"id":"refund-1","type":1,"amountCents":3001,"categoryId":"refund","accountId":"bank","date":1704038400000,
    "note":"部分退款","tags":["购物"],"isRefund":true,"fundPurpose":null,"refundLinkedTxIds":["expense-1"],"updatedAt":1704038400000,
    "financialPurpose":null,"financialPurposeRevision":0,"futureField":{"accepted":true}}
    """

    private static let fundSummary = """
    {"contractVersion":1,"asOf":1791000000000,"balances":{"growth":20000,"reserve":10000,"essentials":-7000,"joy":0},
    "totals":{"funded":{"growth":20000,"reserve":10000,"essentials":0,"joy":0},
    "income":{"growth":0,"reserve":0,"essentials":0,"joy":0},
    "grossSpent":{"growth":0,"reserve":0,"essentials":10000,"joy":0},
    "refunded":{"growth":0,"reserve":0,"essentials":3000,"joy":0}},
    "coverage":{"complete":false,"unallocatedSalaryCount":1,"unallocatedSalaryCents":100000,
    "unassignedTransactionCount":0,"unassignedTransactionCents":0,"invalidRefundCount":0,"unresolvedRefundCents":0,
    "issueCount":1,"unknownUnallocatedSalaryCount":1},"snapshotToken":"snapshot-v1"}
    """

    private static let monthlyPlan = """
    {"state":"ready","periodId":"period-1","revision":1,
    "window":{"from":1790784000000,"to":1793462400000,"timeZone":"Asia/Shanghai","label":"2026-10-01 ~ 2026-11-01"},
    "confirmedIncomeCents":10000,"targetsCents":{"growth":1000,"reserve":1000,"essentials":6000,"joy":2000},
    "summary":{"consumptionBudgetCents":8000,"confirmedNetSpentCents":3000,"remainingCents":5000,"status":"review-required"}}
    """
}
