import Foundation

enum ServerAddress {
    static let defaultAddress = "https://jz.yansuu1.xyz"

    static func parse(_ input: String) throws -> URL {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed),
              parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else {
            throw APIError.invalidAddress
        }
        parts.scheme = "https"
        parts.host = host.lowercased()
        parts.path = ""
        if parts.port == 443 { parts.port = nil }
        guard let url = parts.url else { throw APIError.invalidAddress }
        return url
    }

    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && (lhs.port ?? 443) == (rhs.port ?? 443)
    }

    static func endpoint(baseURL: URL, path: String) throws -> URL {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let relative = URLComponents(string: path),
              relative.scheme == nil, relative.host == nil, relative.fragment == nil,
              !relative.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
              var destination = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidPath
        }
        destination.percentEncodedPath = "/api/v1" + relative.percentEncodedPath
        destination.percentEncodedQuery = relative.percentEncodedQuery
        guard let url = destination.url, sameOrigin(url, baseURL) else { throw APIError.invalidPath }
        return url
    }
}
