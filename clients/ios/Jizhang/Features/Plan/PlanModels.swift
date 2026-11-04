import Foundation

struct LedgerPurposeAmounts: Decodable, Equatable {
    let growth: Int64
    let reserve: Int64
    let essentials: Int64
    let joy: Int64

    subscript(_ purpose: LedgerPurpose) -> Int64 {
        switch purpose {
        case .growth: return growth
        case .reserve: return reserve
        case .essentials: return essentials
        case .joy: return joy
        }
    }

    func validate(nonnegative: Bool) throws {
        let maximum: Int64 = 9_007_199_254_740_991
        guard LedgerPurpose.allCases.allSatisfy({ self[$0] >= (nonnegative ? 0 : -maximum) && self[$0] <= maximum }) else {
            throw LedgerDataError.invalidResponse
        }
    }
}

struct LedgerFundSummary: Decodable {
    struct Totals: Decodable {
        let funded: LedgerPurposeAmounts
        let income: LedgerPurposeAmounts
        let grossSpent: LedgerPurposeAmounts
        let refunded: LedgerPurposeAmounts
    }

    struct Coverage: Decodable {
        let complete: Bool
        let unallocatedSalaryCount: Int
        let unallocatedSalaryCents: Int64
        let unassignedTransactionCount: Int
        let unassignedTransactionCents: Int64
        let invalidRefundCount: Int
        let unresolvedRefundCents: Int64
        let issueCount: Int
        let unknownUnallocatedSalaryCount: Int
    }

    let contractVersion: Int
    let asOf: Int64
    let balances: LedgerPurposeAmounts
    let totals: Totals
    let coverage: Coverage
    let snapshotToken: String

    func validate() throws {
        guard contractVersion == 1, asOf >= 0, !snapshotToken.isEmpty,
              coverage.unallocatedSalaryCount >= 0, coverage.unassignedTransactionCount >= 0,
              coverage.invalidRefundCount >= 0, coverage.issueCount >= 0,
              coverage.unknownUnallocatedSalaryCount >= 0,
              coverage.unallocatedSalaryCents >= 0, coverage.unassignedTransactionCents >= 0,
              coverage.unresolvedRefundCents >= 0 else { throw LedgerDataError.invalidResponse }
        try balances.validate(nonnegative: false)
        try totals.funded.validate(nonnegative: true)
        try totals.income.validate(nonnegative: true)
        try totals.grossSpent.validate(nonnegative: true)
        try totals.refunded.validate(nonnegative: true)
    }
}

struct LedgerFundConfiguration: Decodable {
    struct Configuration: Decodable {
        let revision: Int
        let ratiosBps: LedgerPurposeAmounts
        let timeZone: String
        let updatedAt: Int64?
    }
    let contractVersion: Int
    let config: Configuration

    func validate() throws {
        let ratios = config.ratiosBps
        guard contractVersion == 1, config.revision >= 0,
              TimeZone(identifier: config.timeZone) != nil,
              LedgerPurpose.allCases.allSatisfy({ ratios[$0] >= 0 && ratios[$0] <= 10_000 }),
              ratios.growth + ratios.reserve + ratios.essentials + ratios.joy == 10_000 else {
            throw LedgerDataError.invalidResponse
        }
    }
}

struct LedgerBudgetOverview: Decodable {
    struct Module: Decodable, Identifiable {
        let categoryId: String
        let categoryName: String
        let budgetCents: Int64
        let spentCents: Int64
        let remainingCents: Int64
        var id: String { categoryId }
    }
    let modules: [Module]
    let carryoverPoolCents: Int64
    let totalBudgetCents: Int64
    let totalSpentCents: Int64
    let hasBudget: Bool
}

struct LedgerMonthlyPlan: Decodable {
    enum State: String, Decodable { case ready, noPeriod = "no-period", disabled }
    struct Window: Decodable { let label: String; let from: Int64; let to: Int64; let timeZone: String }
    struct Summary: Decodable {
        enum Status: String, Decodable { case exact; case reviewRequired = "review-required" }
        let consumptionBudgetCents: Int64
        let confirmedNetSpentCents: Int64
        let remainingCents: Int64?
        let status: Status
        // Uncertain data is never presented as an exact remaining balance.
        var displayRemainingCents: Int64? { status == .exact ? remainingCents : nil }
    }
    let state: State
    let periodId: String?
    let revision: Int?
    let window: Window?
    let confirmedIncomeCents: Int64?
    let targetsCents: LedgerPurposeAmounts?
    let summary: Summary?

    func validate() throws {
        if state == .ready {
            guard let periodId, !periodId.isEmpty, let revision, revision >= 0,
                  let window, window.to > window.from, !window.label.isEmpty,
                  let confirmedIncomeCents, confirmedIncomeCents >= 0,
                  let targetsCents, let summary,
                  summary.consumptionBudgetCents >= 0, summary.confirmedNetSpentCents >= 0,
                  summary.status != .exact || summary.remainingCents != nil else {
                throw LedgerDataError.invalidResponse
            }
            try targetsCents.validate(nonnegative: true)
        } else {
            guard periodId == nil, revision == nil, window == nil,
                  confirmedIncomeCents == nil, targetsCents == nil, summary == nil else {
                throw LedgerDataError.invalidResponse
            }
        }
    }
}
