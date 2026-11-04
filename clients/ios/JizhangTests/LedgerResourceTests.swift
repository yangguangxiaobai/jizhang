import XCTest
@testable import Jizhang

final class LedgerResourceTests: XCTestCase {
    @MainActor func testLateRefreshCannotReplaceNewerResults() async {
        let resource = LedgerResource<Int64>()
        let started = expectation(description: "First read started")
        var firstRead: CheckedContinuation<Int64, Never>?
        let firstTask = Task {
            await resource.load {
                await withCheckedContinuation { continuation in
                    firstRead = continuation
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started], timeout: 2)
        await resource.load { 20_001 }
        firstRead?.resume(returning: 10_000)
        await firstTask.value
        XCTAssertEqual(resource.value, 20_001)
        XCTAssertFalse(resource.loading)
        XCTAssertNil(resource.error)
    }

    @MainActor func testFailureHasNoFabricatedValueAndFailedRefreshKeepsPreviousValue() async {
        let resource = LedgerResource<Int64>()
        await resource.load { throw LedgerDataError.invalidResponse }
        XCTAssertNil(resource.value)
        XCTAssertNotNil(resource.error)
        XCTAssertFalse(resource.loading)

        await resource.load { -1_001 }
        XCTAssertNil(resource.error)
        await resource.load { throw LedgerDataError.invalidResponse }
        XCTAssertEqual(resource.value, -1_001)
        XCTAssertNotNil(resource.error)
        XCTAssertFalse(resource.loading)
    }

    @MainActor func testCancelledReadStopsSpinnerWithoutPublishingAValue() async {
        let resource = LedgerResource<Int64>()
        let started = expectation(description: "Cancellable read started")
        var pending: CheckedContinuation<Int64, Never>?
        let task = Task {
            await resource.load {
                await withCheckedContinuation { continuation in
                    pending = continuation
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        pending?.resume(returning: 500)
        await task.value
        XCTAssertNil(resource.value)
        XCTAssertNil(resource.error)
        XCTAssertFalse(resource.loading)
    }

    @MainActor func testClearingScopeRejectsAnInflightResult() async {
        let resource = LedgerResource<Int64>()
        let started = expectation(description: "Read started before scope changed")
        var pending: CheckedContinuation<Int64, Never>?
        let task = Task {
            await resource.load {
                await withCheckedContinuation { continuation in
                    pending = continuation
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started], timeout: 2)
        resource.clear()
        pending?.resume(returning: 500)
        await task.value
        XCTAssertNil(resource.value)
        XCTAssertNil(resource.error)
        XCTAssertFalse(resource.loading)
    }
}
