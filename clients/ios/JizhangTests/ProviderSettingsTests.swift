import XCTest
@testable import Jizhang

final class ProviderSettingsTests: XCTestCase {
    private func configuration(configured: Bool = true, enabled: Bool = true, hasSecret: Bool = true,
                               model: String = "example-chat", mode: String = "chat-completions",
                               template: Any = NSNull(), timeout: Int = 20_000) throws -> ProviderConfiguration {
        let object: [String: Any] = [
            "configured": configured, "enabled": enabled, "encryptionKeyConfigured": true, "hasSecret": hasSecret,
            "mode": mode, "name": "Saved provider", "url": "https://example.com/gateway/v1/chat/completions?route=one",
            "method": "POST", "model": model, "timeoutMs": timeout, "headers": ["x-route": "one"],
            "auth": ["kind": "bearer"], "bodyTemplate": template, "responsePath": "choices[0].message.content", "updatedAt": 1_000
        ]
        return try JSONDecoder().decode(ProviderConfiguration.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testBasicEditOmitsSecretAndRedactedTemplate() throws {
        let saved = try configuration()
        var draft = ProviderDraft(saved)
        draft.model = "another-model"
        let body = try draft.payload(saved: saved)
        XCTAssertEqual(body["model"].stringValue, "another-model")
        XCTAssertNil(body.objectValue?["secret"])
        XCTAssertNil(body.objectValue?["bodyTemplate"])
        XCTAssertNil(body.objectValue?["headers"])
        XCTAssertNil(body.objectValue?["auth"])
        XCTAssertNil(body.objectValue?["responsePath"])
    }

    func testBasicEditPreservesReadableCustomTemplate() throws {
        let saved = try configuration(mode: "custom", template: "{\"input\":\"{{input}}\"}")
        var draft = ProviderDraft(saved)
        draft.model = "new-custom-model"
        let body = try draft.payload(saved: saved)
        XCTAssertNil(body.objectValue?["bodyTemplate"])
        XCTAssertNil(body.objectValue?["mode"])
    }

    func testBootstrapExplicitlySavesDisabledConnectionWithoutModel() throws {
        let saved = try configuration(configured: false, enabled: false, hasSecret: false, model: "")
        var draft = ProviderDraft(saved)
        draft.url = "https://example.com"
        draft.secret = "new-key"
        draft.enabled = true
        let body = try draft.payload(saved: saved, forceEnabled: false)
        XCTAssertEqual(body["enabled"].boolValue, false)
        XCTAssertEqual(body["model"].stringValue, "")
        XCTAssertEqual(body["url"].stringValue, "https://example.com/v1/chat/completions")
        XCTAssertEqual(body["secret"].stringValue, "new-key")
    }

    func testEnabledConfigurationRequiresModelAndCredential() throws {
        let saved = try configuration(configured: false, enabled: false, hasSecret: false, model: "")
        var draft = ProviderDraft(saved); draft.enabled = true
        XCTAssertThrowsError(try draft.payload(saved: saved)) { XCTAssertEqual($0 as? ProviderValidationError, .model) }
        draft.model = "test-model"
        XCTAssertThrowsError(try draft.payload(saved: saved)) { XCTAssertEqual($0 as? ProviderValidationError, .secret) }
    }

    func testExplicitKeyClearDoesNotAccidentallyReenableCredentialedProvider() throws {
        let saved = try configuration()
        var draft = ProviderDraft(saved); draft.clearSecret = true
        XCTAssertThrowsError(try draft.payload(saved: saved))
        draft.enabled = false
        let body = try draft.payload(saved: saved)
        XCTAssertEqual(body["clearSecret"].boolValue, true)
        XCTAssertNil(body.objectValue?["secret"])
    }

    func testRootAndVersionPathNormalizeWithoutLosingQueryOrPrefix() throws {
        XCTAssertEqual(try ProviderDraft.normalizedURL(" https://example.com?route=x ", mode: "chat-completions"), "https://example.com/v1/chat/completions?route=x")
        XCTAssertEqual(try ProviderDraft.normalizedURL("https://example.com/gateway/v1/", mode: "responses"), "https://example.com/gateway/v1/responses")
        XCTAssertEqual(try ProviderDraft.normalizedURL("https://example.com/custom/complete?x=1", mode: "chat-completions"), "https://example.com/custom/complete?x=1")
    }

    func testCustomURLIsNotRewrittenAndCredentialURLsAreRejected() throws {
        XCTAssertEqual(try ProviderDraft.normalizedURL("https://example.com/v1?route=x", mode: "custom"), "https://example.com/v1?route=x")
        XCTAssertThrowsError(try ProviderDraft.normalizedURL("https://user:password@example.com", mode: "chat-completions"))
        XCTAssertThrowsError(try ProviderDraft.normalizedURL("https://example.com/#fragment", mode: "chat-completions"))
    }

    func testModelOnlyEditDoesNotInvalidateSavedConnection() throws {
        let saved = ProviderDraft(try configuration())
        var draft = saved; draft.model = "new-model"
        XCTAssertTrue(draft.hasSameConnection(as: saved))
        draft.secret = "replacement"
        XCTAssertFalse(draft.hasSameConnection(as: saved))
    }

    func testModeChangeUpdatesOnlyRecognizedDefaults() throws {
        var draft = ProviderDraft(try configuration())
        draft.mode = "responses"; draft.applyModeDefaults(from: "chat-completions")
        XCTAssertEqual(draft.url, "https://example.com/gateway/v1/responses?route=one")
        XCTAssertEqual(draft.responsePath, "output_text")
        draft.responsePath = "my.custom.path"
        draft.mode = "chat-completions"; draft.applyModeDefaults(from: "responses")
        XCTAssertEqual(draft.responsePath, "my.custom.path")
    }

    func testExistingMillisecondTimeoutIsPreservedUntilEdited() throws {
        let saved = try configuration(timeout: 20_500)
        var draft = ProviderDraft(saved)
        XCTAssertNil(try draft.payload(saved: saved).objectValue?["timeoutMs"])
        draft.timeoutSeconds = "30.25"
        XCTAssertEqual(try draft.payload(saved: saved)["timeoutMs"].intValue, 30_250)
        draft.timeoutSeconds = "30.2501"
        XCTAssertThrowsError(try draft.payload(saved: saved))
    }

    func testInvalidHeaderObjectFailsWithoutARequest() throws {
        let saved = try configuration()
        var draft = ProviderDraft(saved); draft.headersText = "{\"x-route\":123}"
        XCTAssertThrowsError(try draft.payload(saved: saved)) { XCTAssertEqual($0 as? ProviderValidationError, .headers) }
    }

    func testModelListDeduplicatesAndRejectsMalformedIDs() throws {
        let models = try ProviderModelList.validated([.init(id: " model-a "), .init(id: "model-a"), .init(id: "model-b")])
        XCTAssertEqual(models.map(\.id), ["model-a", "model-b"])
        XCTAssertThrowsError(try ProviderModelList.validated([.init(id: "bad\nmodel")]))
        XCTAssertThrowsError(try ProviderModelList.validated([.init(id: "")]))
    }
}
