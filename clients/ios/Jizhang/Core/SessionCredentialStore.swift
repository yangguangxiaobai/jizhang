import Foundation
import Security

struct SessionCookie: Codable, Equatable, Sendable {
    static let name = "jizhang_session"
    let value: String
    let domain: String
    let path: String
    let secure: Bool
    let hostOnly: Bool
    let expiresAt: Date?

    func matches(_ url: URL, now: Date = Date()) -> Bool {
        guard !value.isEmpty, let host = url.host?.lowercased(),
              expiresAt.map({ $0 > now }) ?? true,
              !secure || url.scheme?.lowercased() == "https" else { return false }
        let cookieDomain = domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let domainMatches = host == cookieDomain || (!hostOnly && host.hasSuffix("." + cookieDomain))
        let requestPath = url.path.isEmpty ? "/" : url.path
        let pathMatches = requestPath == path
            || (requestPath.hasPrefix(path) && (path.hasSuffix("/") || requestPath.dropFirst(path.count).hasPrefix("/")))
        return domainMatches && pathMatches
    }

    static func from(_ cookie: HTTPCookie, origin: URL, hostOnly: Bool) -> SessionCookie? {
        guard cookie.name == name, !cookie.value.contains("\r"), !cookie.value.contains("\n"),
              let host = origin.host?.lowercased() else { return nil }
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard host == domain || (!hostOnly && host.hasSuffix("." + domain)) else { return nil }
        return SessionCookie(value: cookie.value, domain: domain, path: cookie.path,
                             secure: cookie.isSecure, hostOnly: hostOnly, expiresAt: cookie.expiresDate)
    }

    var requestHeader: String { "\(Self.name)=\(value)" }
}

protocol SessionCredentialStore {
    func load(server: String) throws -> SessionCookie?
    func save(_ cookie: SessionCookie?, server: String) throws
}

/// No Keychain access group is hardcoded: Sideloadly supplies the application's signing identity.
struct KeychainSessionStore: SessionCredentialStore {
    private let service = "com.yansuu1.jizhang.ios.session"

    func load(server: String) throws -> SessionCookie? {
        var query = key(server: server)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw APIError.credentialStorage }
        do {
            return try JSONDecoder().decode(SessionCookie.self, from: data)
        } catch {
            try save(nil, server: server)
            return nil
        }
    }

    func save(_ cookie: SessionCookie?, server: String) throws {
        let query = key(server: server)
        guard let cookie, cookie.expiresAt != nil else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw APIError.credentialStorage }
            return
        }
        let data = try JSONEncoder().encode(cookie)
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var addition = query
            addition[kSecValueData as String] = data
            addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw APIError.credentialStorage }
        } else if status != errSecSuccess {
            throw APIError.credentialStorage
        }
    }

    private func key(server: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: server,
         kSecAttrSynchronizable as String: false]
    }
}
