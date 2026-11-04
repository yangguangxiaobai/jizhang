import XCTest
@testable import Jizhang

private struct AssistantTestCredentialStore: SessionCredentialStore {
    func load(server: String) throws -> SessionCookie? { nil }
    func save(_ cookie: SessionCookie?, server: String) throws {}
}

private final class AssistantTestURLProtocol: URLProtocol {
    private static let handlerLock = NSLock()
    private static var storedHandler: ((AssistantTestURLProtocol) -> Void)?

    static func configure(_ handler: @escaping (AssistantTestURLProtocol) -> Void) {
        handlerLock.lock(); storedHandler = handler; handlerLock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.handlerLock.lock(); let callback = Self.storedHandler; Self.handlerLock.unlock()
        if let callback { callback(self) }
        else { fail(URLError(.badServerResponse)) }
    }
    override func stopLoading() {}

    func respond(_ object: Any, status: Int = 200) {
        do {
            guard let url = request.url,
                  let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else {
                fail(URLError(.badURL)); return
            }
            let data = try JSONSerialization.data(withJSONObject: object)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { fail(error) }
    }

    func fail(_ error: Error) { client?.urlProtocol(self, didFailWithError: error) }

    func body() -> [String: Any] {
        let data: Data
        if let body = request.httpBody { data = body }
        else if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var result = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                result.append(contentsOf: buffer.prefix(count))
            }
            data = result
        } else { data = Data() }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}

final class AssistantStateTests: XCTestCase {
    @MainActor
    private func makeClient() throws -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AssistantTestURLProtocol.self]
        return try APIClient(baseURL: URL(string: "https://unit.example")!, credentialStore: AssistantTestCredentialStore(),
                             restoreSession: false, configuration: configuration)
    }

    private static func history(_ conversation: String, text: String) -> [String: Any] {
        ["items": [["id": "message-\(text)", "conversationId": conversation, "role": "assistant", "kind": "text",
                    "content": ["version": 1, "text": text], "createdAt": 1_000]]]
    }

    @MainActor
    func testAToBToARejectsFirstALateHistory() async throws {
        let firstAStarted = expectation(description: "First A request is pending")
        let lock = NSLock()
        var aReads = 0
        var pendingA: AssistantTestURLProtocol?
        AssistantTestURLProtocol.configure { transport in
            let path = transport.request.url?.path ?? ""
            if path.hasSuffix("/a/messages") {
                lock.lock(); aReads += 1; let number = aReads
                if number == 1 { pendingA = transport }
                lock.unlock()
                if number == 1 { firstAStarted.fulfill() }
                else { transport.respond(Self.history("a", text: "new-A")) }
            } else if path.hasSuffix("/b/messages") { transport.respond(Self.history("b", text: "only-B")) }
            else { transport.respond(["items": []]) }
        }
        let api = try makeClient(); defer { api.invalidate() }
        let store = AssistantStore(api: api)
        let first = Task { await store.open("a") }
        await fulfillment(of: [firstAStarted], timeout: 3)
        await store.open("b")
        XCTAssertEqual(store.thread("b").messages.first?.content.text, "only-B")
        await store.open("a")
        lock.lock(); let oldRequest = pendingA; lock.unlock()
        oldRequest?.respond(Self.history("a", text: "old-A"))
        await first.value
        XCTAssertEqual(store.selectedID, "a")
        XCTAssertEqual(store.thread("a").messages.map { $0.content.text }, ["new-A"])
        XCTAssertEqual(store.thread("b").messages.map { $0.content.text }, ["only-B"])
    }

    @MainActor
    func testUncertainSendOnlyRetriesExplicitlyWithOriginalID() async throws {
        let lock = NSLock()
        var bodies: [[String: Any]] = []
        AssistantTestURLProtocol.configure { transport in
            let path = transport.request.url?.path ?? ""
            if transport.request.httpMethod == "POST" && path.hasSuffix("/generations") {
                let body = transport.body()
                lock.lock(); bodies.append(body); let number = bodies.count; lock.unlock()
                if number == 1 { transport.fail(URLError(.networkConnectionLost)); return }
                let user: [String: Any] = ["id": "u1", "conversationId": "a", "role": "user", "kind": "text", "createdAt": 1_000,
                                           "content": ["version": 1, "text": "查预算"]]
                transport.respond(["created": false, "generation": [
                    "version": 1, "id": "g1", "conversationId": "a", "userMessageId": "u1", "userMessage": user,
                    "status": "completed", "delivery": "buffered", "lastSeq": 2, "createdAt": 1_000, "updatedAt": 1_001,
                    "partialMessages": [], "messageIds": [], "messages": [], "outcome": "answer", "error": NSNull()
                ]])
            } else { transport.respond(["items": []]) }
        }
        let api = try makeClient(); defer { api.invalidate() }
        let store = AssistantStore(api: api)
        await store.open("a")
        store.setDraft("查预算", for: "a")
        await store.sendText(in: "a")
        XCTAssertNotNil(store.thread("a").pendingSubmission)
        lock.lock(); let countAfterFailure = bodies.count; lock.unlock()
        XCTAssertEqual(countAfterFailure, 1)
        store.setDraft("不应该替换未知请求", for: "a")
        XCTAssertEqual(store.thread("a").draft, "查预算")
        await store.retrySubmission(in: "a")
        lock.lock(); let sentBodies = bodies; lock.unlock()
        XCTAssertEqual(sentBodies.count, 2)
        XCTAssertEqual(sentBodies[0]["clientRequestId"] as? String, sentBodies[1]["clientRequestId"] as? String)
        XCTAssertEqual((sentBodies[1]["input"] as? [String: Any])?["text"] as? String, "查预算")
        XCTAssertNil(store.thread("a").pendingSubmission)
        XCTAssertEqual(store.thread("a").draft, "")
    }

    @MainActor
    func testStaleChoiceRejectionUnlocksComposerAndRefreshesLatestGeneration() async throws {
        let lock = NSLock(); var rejected = false
        let question: [String: Any] = ["id": "question-message", "conversationId": "a", "role": "assistant", "kind": "text", "createdAt": 1_000,
            "content": ["version": 1, "generationId": "g1", "text": "请选账户", "clarification": [
                "id": "q1", "selection": "single", "question": "使用哪个账户？", "allowFreeText": true,
                "options": [["id": "one", "label": "账户一"], ["id": "two", "label": "账户二"]]
            ]]]
        AssistantTestURLProtocol.configure { transport in
            let path = transport.request.url?.path ?? ""
            if transport.request.httpMethod == "POST" {
                lock.lock(); rejected = true; lock.unlock()
                transport.respond(["error": ["code": "ASSISTANT_CHOICE_STALE", "message": "stale"]], status: 409)
            } else if path.hasSuffix("/messages") {
                transport.respond(["items": [question]])
            } else {
                lock.lock(); let latest = rejected; lock.unlock()
                transport.respond(["items": [[
                    "version": 1, "id": latest ? "g2" : "g1", "conversationId": "a", "userMessageId": "u1", "userMessage": NSNull(),
                    "status": "completed", "delivery": "buffered", "lastSeq": 2, "createdAt": latest ? 2_000 : 1_000, "updatedAt": 2_000,
                    "partialMessages": [], "messageIds": [], "messages": [], "outcome": latest ? "answer" : "awaiting-choice", "error": NSNull()
                ]]])
            }
        }
        let api = try makeClient(); defer { api.invalidate() }
        let store = AssistantStore(api: api)
        await store.open("a")
        let message = try XCTUnwrap(store.thread("a").messages.first)
        let option = try XCTUnwrap(message.content.clarification?.options.first)
        XCTAssertTrue(store.canAnswer(message, in: "a"))
        store.setDraft("保留这份草稿", for: "a")
        await store.answer(option, message: message, in: "a")
        XCTAssertNil(store.thread("a").pendingSubmission)
        XCTAssertFalse(store.thread("a").composerLocked)
        XCTAssertEqual(store.thread("a").generation?.id, "g2")
        XCTAssertEqual(store.thread("a").draft, "保留这份草稿")
        XCTAssertFalse(store.canAnswer(message, in: "a"))
        store.setDraft("可以继续输入", for: "a")
        XCTAssertEqual(store.thread("a").draft, "可以继续输入")
    }
}

final class ProviderStateTests: XCTestCase {
    private static func configuration(configured: Bool = true, enabled: Bool = true, model: String = "saved-model", secret: Bool = true) -> [String: Any] {
        ["configured": configured, "enabled": enabled, "encryptionKeyConfigured": true, "hasSecret": secret,
         "mode": "chat-completions", "name": "AI 助手", "url": configured ? "https://provider.example/v1/chat/completions" : "",
         "method": "POST", "model": model, "timeoutMs": 20_000, "headers": [:], "auth": ["kind": "bearer"],
         "bodyTemplate": NSNull(), "responsePath": "choices[0].message.content", "updatedAt": NSNull()]
    }

    @MainActor
    private func makeClient() throws -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AssistantTestURLProtocol.self]
        return try APIClient(baseURL: URL(string: "https://unit.example")!, credentialStore: AssistantTestCredentialStore(),
                             restoreSession: false, configuration: configuration)
    }

    @MainActor
    func testDiscoveryFailureKeepsSelectedModelAndDoesNotTestProvider() async throws {
        let lock = NSLock(); var tests = 0
        AssistantTestURLProtocol.configure { transport in
            let path = transport.request.url?.path ?? ""
            if path.hasSuffix("/ai/models") {
                transport.respond(["error": ["code": "AI_PROVIDER_ERROR", "message": "safe error"]], status: 502)
            } else {
                if path.hasSuffix("/ai/test") { lock.lock(); tests += 1; lock.unlock() }
                transport.respond(Self.configuration())
            }
        }
        let api = try makeClient(); defer { api.invalidate() }
        let store = ProviderSettingsStore(api: api)
        await store.load()
        await store.fetchModels()
        XCTAssertEqual(store.draft.model, "saved-model")
        XCTAssertNotNil(store.error)
        XCTAssertFalse(store.testPassed)
        lock.lock(); let testCalls = tests; lock.unlock()
        XCTAssertEqual(testCalls, 0)
    }

    @MainActor
    func testBootstrapModelSelectionRemainsDraftUntilExplicitSave() async throws {
        let lock = NSLock()
        var writes: [[String: Any]] = []
        var callPaths: [String] = []
        AssistantTestURLProtocol.configure { transport in
            let path = transport.request.url?.path ?? ""
            lock.lock(); callPaths.append(path); lock.unlock()
            if path.hasSuffix("/ai/models") {
                transport.respond(["items": [["id": "chosen-model"], ["id": "other-model"]]])
            } else if transport.request.httpMethod == "PUT" {
                let body = transport.body()
                lock.lock(); writes.append(body); lock.unlock()
                transport.respond(Self.configuration(enabled: body["enabled"] as? Bool ?? false, model: body["model"] as? String ?? ""))
            } else { transport.respond(Self.configuration(configured: false, enabled: false, model: "", secret: false)) }
        }
        let api = try makeClient(); defer { api.invalidate() }
        let store = ProviderSettingsStore(api: api)
        await store.load()
        store.draft.url = "https://provider.example"
        store.draft.secret = "synthetic-test-key"
        await store.fetchModels()
        XCTAssertNil(store.error)
        XCTAssertTrue(store.modelsLoaded)
        XCTAssertFalse(store.saved?.enabled ?? true)
        XCTAssertEqual(store.draft.secret, "")
        store.chooseModel("chosen-model")
        XCTAssertEqual(store.saved?.model, "")
        XCTAssertEqual(store.draft.model, "chosen-model")
        await store.save()
        XCTAssertEqual(store.saved?.model, "chosen-model")
        XCTAssertEqual(store.saved?.enabled, true)
        lock.lock(); let payloads = writes; let paths = callPaths; lock.unlock()
        XCTAssertEqual(payloads.count, 2)
        XCTAssertEqual(payloads[0]["enabled"] as? Bool, false)
        XCTAssertEqual(payloads[1]["enabled"] as? Bool, true)
        XCTAssertNil(payloads[1]["secret"])
        XCTAssertFalse(paths.contains { $0.hasSuffix("/ai/test") })
    }
}
