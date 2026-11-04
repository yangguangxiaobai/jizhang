import XCTest
@testable import Jizhang

final class CoreContractTests: XCTestCase {
    func testServerAddressNormalizesOriginWithoutAcceptingCredentialsOrPaths() throws {
        XCTAssertEqual(try ServerAddress.parse("  https://EXAMPLE.com:443/  ").absoluteString, "https://example.com")
        for input in ["http://example.com", "https://name:password@example.com", "https://example.com/api/v1", "https://example.com?key=1", "https://example.com#anchor", "example.com", ""] {
            XCTAssertThrowsError(try ServerAddress.parse(input), input)
        }
    }

    func testAPIPathCannotChangeOriginOrEscapePrefix() throws {
        let base = try ServerAddress.parse("https://example.com")
        let url = try ServerAddress.endpoint(baseURL: base, path: "/transactions?search=%E9%A4%90%E9%A5%AE&limit=20")
        XCTAssertEqual(url.host, "example.com")
        XCTAssertEqual(url.path, "/api/v1/transactions")
        XCTAssertTrue(url.query?.contains("limit=20") == true)
        for path in ["https://other.test/data", "//other.test/data", "/../private", "/%2E%2E/private", "/data#fragment", "data"] {
            XCTAssertThrowsError(try ServerAddress.endpoint(baseURL: base, path: path), path)
        }
    }

    func testBodylessMutationHasCSRFWithoutJSONContentType() throws {
        let base = try ServerAddress.parse("https://example.com")
        let request = try APIRequestBuilder.make(baseURL: base, path: "/ai/models", method: "POST")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Requested-With"), "fetch")
        XCTAssertNil(request.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertNil(request.httpBody)
        XCTAssertFalse(request.httpShouldHandleCookies)
    }

    func testJSONMutationAndReadHaveDistinctRequestHeaders() throws {
        let base = try ServerAddress.parse("https://example.com")
        let body: JSONValue = .object(["username": .string("fixture"), "password": .string("memory-only")])
        let request = try APIRequestBuilder.make(baseURL: base, path: "/auth/login", method: "POST", body: body)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json; charset=utf-8")
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(request.httpBody)), body)
        let read = try APIRequestBuilder.make(baseURL: base, path: "/auth/me")
        XCTAssertNil(read.value(forHTTPHeaderField: "X-Requested-With"))
        XCTAssertEqual(read.value(forHTTPHeaderField: "Cache-Control"), "no-store")
    }

    func testJSONPreservesInt64AndDoesNotCoerceBooleansStringsOrFractions() throws {
        let data = Data(#"{"amount":9223372036854775807,"enabled":true,"label":"17","fraction":1.5,"nothing":null}"#.utf8)
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(value["amount"].intValue, Int64.max)
        XCTAssertEqual(value["enabled"].boolValue, true)
        XCTAssertNil(value["enabled"].intValue)
        XCTAssertNil(value["label"].intValue)
        XCTAssertNil(value["fraction"].intValue)
        XCTAssertEqual(value["fraction"].doubleValue, 1.5)
        XCTAssertEqual(value["missing"], .null)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value)), value)
    }

    func testCookieHonorsDomainPathSecureAndExpiry() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let cookie = SessionCookie(value: "fixture", domain: "example.com", path: "/api", secure: true, hostOnly: true, expiresAt: now.addingTimeInterval(60))
        XCTAssertTrue(cookie.matches(try XCTUnwrap(URL(string: "https://example.com/api/v1/auth/me")), now: now))
        for address in ["https://example.com/apix", "https://sub.example.com/api", "https://other.com/api", "http://example.com/api"] {
            XCTAssertFalse(cookie.matches(try XCTUnwrap(URL(string: address)), now: now), address)
        }
        XCTAssertFalse(cookie.matches(try XCTUnwrap(URL(string: "https://example.com/api")), now: now.addingTimeInterval(61)))
    }

    func testDomainCookieNeverMatchesSuffixWithoutLabelBoundary() throws {
        let cookie = SessionCookie(value: "fixture", domain: "example.com", path: "/", secure: true, hostOnly: false, expiresAt: nil)
        XCTAssertTrue(cookie.matches(try XCTUnwrap(URL(string: "https://sub.example.com/api"))))
        XCTAssertFalse(cookie.matches(try XCTUnwrap(URL(string: "https://notexample.com/api"))))
    }

    func testCookiesOnlyEnterMatchingRequests() throws {
        let base = try ServerAddress.parse("https://example.com")
        let cookie = SessionCookie(value: "fixture", domain: "other.test", path: "/", secure: true, hostOnly: true, expiresAt: nil)
        let request = try APIRequestBuilder.make(baseURL: base, path: "/auth/me", cookie: cookie)
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
    }

    func testServerErrorCannotEchoProviderSecretOrHTML() {
        let data = Data(#"{"error":{"code":"UPSTREAM_FAILURE","message":"secret-sk-private and <html>"}}"#.utf8)
        let error = APIError.response(status: 502, data: data)
        XCTAssertEqual(error.code, "UPSTREAM_FAILURE")
        XCTAssertFalse(error.localizedDescription.contains("secret-sk"))
        XCTAssertFalse(error.localizedDescription.contains("<html>"))
        let invalidCode = APIError.response(status: 500, data: Data(#"{"error":{"code":"secret:my-key"}}"#.utf8))
        XCTAssertEqual(invalidCode.code, "HTTP_500")
    }
}
