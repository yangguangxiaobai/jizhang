import Foundation

struct ProviderAuthentication: Decodable, Equatable {
    let kind: String
    let headerName: String?
}

struct ProviderConfiguration: Decodable, Equatable {
    let configured: Bool
    let enabled: Bool
    let encryptionKeyConfigured: Bool
    let hasSecret: Bool
    let mode: String
    let name: String
    let url: String
    let method: String
    let model: String
    let timeoutMs: Int
    let headers: [String: String]
    let auth: ProviderAuthentication
    let bodyTemplate: String?
    let responsePath: String
    let updatedAt: Int64?
}

enum ProviderValidationError: LocalizedError, Equatable {
    case address, model, secret, timeout, headers, template, responsePath, authentication, unsupportedModels
    var errorDescription: String? {
        switch self {
        case .address: return "请输入完整的 http(s) 服务地址，不要在地址中包含账号、密码或片段。"
        case .model: return "请填写模型名称，最多 200 字符。"
        case .secret: return "请填写 API Key，或在高级设置中选择无需认证。"
        case .timeout: return "超时时间应在 3 到 60 秒之间，最多三位小数。"
        case .headers: return "额外请求头应为 JSON 对象，每个值都必须是文本。"
        case .template: return "自定义接口需要有效的 JSON 请求体模板。"
        case .responsePath: return "请填写自定义接口的响应字段路径。"
        case .authentication: return "请填写自定义认证头的名称。"
        case .unsupportedModels: return "此接口不支持获取模型列表，请手动填写模型名称。"
        }
    }
}

struct ProviderDraft: Equatable {
    var enabled = true
    var mode = "chat-completions"
    var name = ""
    var url = ""
    var model = ""
    var secret = ""
    var clearSecret = false
    var method = "POST"
    var timeoutSeconds = "20"
    var headersText = "{}"
    var authKind = "bearer"
    var headerName = ""
    var bodyTemplate = ""
    var responsePath = "choices[0].message.content"

    init() {}
    init(_ config: ProviderConfiguration) {
        enabled = config.enabled
        mode = config.mode; name = config.name; url = config.url; model = config.model
        method = config.method; timeoutSeconds = Self.secondsText(config.timeoutMs)
        authKind = config.auth.kind; headerName = config.auth.headerName ?? ""
        bodyTemplate = config.bodyTemplate ?? ""; responsePath = config.responsePath
        if let data = try? JSONSerialization.data(withJSONObject: config.headers, options: [.prettyPrinted, .sortedKeys]),
           let text = String(data: data, encoding: .utf8) { headersText = text }
    }

    private static func secondsText(_ milliseconds: Int) -> String {
        if milliseconds % 1_000 == 0 { return String(milliseconds / 1_000) }
        return NSDecimalNumber(value: milliseconds).dividing(by: NSDecimalNumber(value: 1_000)).stringValue
    }

    static func normalizedURL(_ value: String, mode: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let sample = trimmed.replacingOccurrences(of: #"\{\{([A-Za-z][A-Za-z0-9_]*)\}\}"#,
                                                 with: "template-value", options: .regularExpression)
        guard trimmed.utf16.count <= 2_000, let components = URLComponents(string: sample),
              let scheme = components.scheme?.lowercased(), ["https", "http"].contains(scheme),
              components.host?.isEmpty == false, components.user == nil, components.password == nil,
              components.fragment == nil else { throw ProviderValidationError.address }
        // URLComponents.string percent-encodes the backend's literal {{model}}/{{input}}
        // variables. Validate a substituted sample but retain the original template text.
        guard mode != "custom" else { return trimmed }
        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = mode == "responses" ? "responses" : "chat/completions"
        let addition: String
        if path.isEmpty { addition = "/v1/" + suffix }
        else if path.lowercased().hasSuffix("/v1") || path.lowercased() == "v1" { addition = "/" + suffix }
        else { return trimmed }
        let queryIndex = trimmed.firstIndex(of: "?") ?? trimmed.endIndex
        let base = String(trimmed[..<queryIndex]).replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        return base + addition + String(trimmed[queryIndex...])
    }

    func hasSameConnection(as saved: ProviderDraft) -> Bool {
        (try? Self.normalizedURL(url, mode: mode)) == (try? Self.normalizedURL(saved.url, mode: saved.mode)) &&
        mode == saved.mode && method == saved.method && timeoutSeconds == saved.timeoutSeconds &&
        headersText == saved.headersText && authKind == saved.authKind && headerName == saved.headerName &&
        secret.isEmpty && !clearSecret
    }

    mutating func applyModeDefaults(from old: String) {
        guard mode != old else { return }
        let oldPath = old == "responses" ? "output_text" : "choices[0].message.content"
        if responsePath == oldPath {
            responsePath = mode == "responses" ? "output_text" : (mode == "custom" ? "" : "choices[0].message.content")
        }
        if mode != "custom" { method = "POST" }
        if old != "custom", mode != "custom" {
            let oldSuffix = old == "responses" ? "/responses" : "/chat/completions"
            let queryIndex = url.firstIndex(of: "?") ?? url.endIndex
            let base = String(url[..<queryIndex])
            if base.hasSuffix(oldSuffix) {
                url = String(base.dropLast(oldSuffix.count)) + (mode == "responses" ? "/responses" : "/chat/completions") + String(url[queryIndex...])
            }
        }
    }

    /// Send changed advanced fields only. A redacted bodyTemplate is not an empty template.
    func payload(saved: ProviderConfiguration, forceEnabled: Bool? = nil) throws -> JSONValue {
        let baseline = ProviderDraft(saved)
        let shouldEnable = forceEnabled ?? enabled
        let normalized = try Self.normalizedURL(url, mode: mode)
        let model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard model.utf16.count <= 200, !shouldEnable || !model.isEmpty else { throw ProviderValidationError.model }
        guard let seconds = Decimal(string: timeoutSeconds, locale: Locale(identifier: "en_US_POSIX")),
              seconds >= 3, seconds <= 60 else { throw ProviderValidationError.timeout }
        let milliseconds = NSDecimalNumber(decimal: seconds * 1_000)
        guard milliseconds.compare(NSDecimalNumber(value: milliseconds.intValue)) == .orderedSame else { throw ProviderValidationError.timeout }
        let secret = secret.trimmingCharacters(in: .whitespacesAndNewlines)
        if shouldEnable && authKind != "none" && secret.isEmpty && (!saved.hasSecret || clearSecret) { throw ProviderValidationError.secret }
        if authKind == "header" && headerName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw ProviderValidationError.authentication }
        if shouldEnable && mode == "custom" {
            if responsePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw ProviderValidationError.responsePath }
            if method != "GET" && bodyTemplate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw ProviderValidationError.template }
        }
        var fields: [String: JSONValue] = ["enabled": .bool(shouldEnable), "url": .string(normalized), "model": .string(model)]
        if mode != baseline.mode { fields["mode"] = .string(mode) }
        if name != baseline.name { fields["name"] = .string(name) }
        if method != baseline.method { fields["method"] = .string(method) }
        if timeoutSeconds != baseline.timeoutSeconds { fields["timeoutMs"] = .integer(Int64(milliseconds.intValue)) }
        if authKind != baseline.authKind || headerName != baseline.headerName {
            var auth: [String: JSONValue] = ["kind": .string(authKind)]
            if authKind == "header" { auth["headerName"] = .string(headerName.trimmingCharacters(in: .whitespacesAndNewlines)) }
            fields["auth"] = .object(auth)
        }
        if headersText != baseline.headersText {
            guard let data = headersText.data(using: .utf8),
                  let headers = try? JSONDecoder().decode([String: String].self, from: data), headers.count <= 20 else { throw ProviderValidationError.headers }
            fields["headers"] = .object(headers.mapValues { .string($0) })
        }
        if responsePath != baseline.responsePath { fields["responsePath"] = .string(responsePath) }
        if bodyTemplate != baseline.bodyTemplate {
            fields["bodyTemplate"] = bodyTemplate.isEmpty ? .null : .string(bodyTemplate)
        }
        if !secret.isEmpty { fields["secret"] = .string(secret) }
        if clearSecret { fields["clearSecret"] = .bool(true) }
        return .object(fields)
    }
}

struct ProviderModel: Decodable, Identifiable, Equatable { let id: String }

enum ProviderModelList {
    static func validated(_ values: [ProviderModel]) throws -> [ProviderModel] {
        guard values.count <= 2_000 else { throw ProviderValidationError.unsupportedModels }
        var seen = Set<String>()
        var output: [ProviderModel] = []
        for model in values {
            let id = model.id.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, id.utf16.count <= 200, id.rangeOfCharacter(from: .controlCharacters) == nil else { throw ProviderValidationError.unsupportedModels }
            if seen.insert(id).inserted { output.append(ProviderModel(id: id)) }
        }
        return output
    }
}
