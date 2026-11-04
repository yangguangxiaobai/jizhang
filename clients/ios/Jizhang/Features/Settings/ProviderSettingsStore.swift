import Foundation
import Combine

@MainActor
final class ProviderSettingsStore: ObservableObject {
    enum Operation { case load, save, models, test }
    let api: APIClient
    @Published private(set) var saved: ProviderConfiguration?
    @Published var draft = ProviderDraft() {
        didSet {
            if draft != oldValue { testPassed = false; notice = nil }
            if !draft.hasSameConnection(as: oldValue) { models = []; modelsLoaded = false }
        }
    }
    @Published private(set) var operation: Operation?
    @Published private(set) var error: String?
    @Published private(set) var notice: String?
    @Published private(set) var testPassed = false
    @Published private(set) var models: [ProviderModel] = []
    @Published private(set) var modelsLoaded = false
    @Published var showModels = false
    private var requestTicket = UUID()

    init(api: APIClient) { self.api = api }
    var busy: Bool { operation != nil }
    var dirty: Bool { saved.map { draft != ProviderDraft($0) } ?? false }
    var connectionSaved: Bool { saved.map { $0.configured && draft.hasSameConnection(as: ProviderDraft($0)) } ?? false }
    var needsBootstrap: Bool { saved.map { !$0.configured || (!$0.enabled && $0.model.isEmpty) } ?? true }
    var canTest: Bool { saved?.enabled == true && !dirty && !busy }
    var statusLabel: String {
        guard let saved else { return "尚未读取配置" }
        if testPassed { return "连接测试通过" }
        if !saved.configured { return "尚未配置" }
        return saved.enabled ? "已启用 · 尚未测试" : "已保存 · 未启用"
    }

    func load() async {
        guard !busy else { return }
        let ticket = UUID(); requestTicket = ticket
        operation = .load; error = nil
        defer { if requestTicket == ticket { operation = nil } }
        do {
            let response: ProviderConfiguration = try await api.request("/ai/config")
            try Task.checkCancellation()
            guard requestTicket == ticket else { return }
            adopt(response, prepareSetup: true)
        } catch { if !Task.isCancelled, requestTicket == ticket { self.error = error.localizedDescription } }
    }

    private func adopt(_ value: ProviderConfiguration, prepareSetup: Bool = false) {
        saved = value
        var newDraft = ProviderDraft(value)
        // This is explicitly a draft. The primary action remains “保存并启用”.
        if prepareSetup && (!value.configured || (!value.enabled && value.model.isEmpty)) { newDraft.enabled = true }
        draft = newDraft
        testPassed = false
    }

    func save() async {
        guard !busy, let saved else { return }
        operation = .save; error = nil; notice = nil
        defer { operation = nil }
        do {
            let body = try draft.payload(saved: saved)
            let response: ProviderConfiguration = try await api.request("/ai/config", method: "PUT", body: body)
            try Task.checkCancellation()
            adopt(response)
            notice = response.enabled ? "配置已保存并启用。" : "配置已保存，AI 当前未启用。"
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    func fetchModels() async {
        guard !busy, let previous = saved else { return }
        guard draft.mode != "custom" else { error = ProviderValidationError.unsupportedModels.localizedDescription; return }
        operation = .models; error = nil; notice = nil
        let ticket = UUID(); requestTicket = ticket
        defer { if requestTicket == ticket { operation = nil } }
        do {
            if !connectionSaved {
                let bootstrap = (!previous.configured || (!previous.enabled && previous.model.isEmpty)) && draft.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                let body = try draft.payload(saved: previous, forceEnabled: bootstrap ? false : nil)
                let response: ProviderConfiguration = try await api.request("/ai/config", method: "PUT", body: body)
                try Task.checkCancellation()
                guard requestTicket == ticket else { return }
                adopt(response, prepareSetup: bootstrap)
                notice = "连接已保存。选择模型后再保存生效。"
            }
            let connection = draft
            let response: AssistantItems<ProviderModel> = try await api.request("/ai/models", method: "POST")
            try Task.checkCancellation()
            guard requestTicket == ticket, draft.hasSameConnection(as: connection) else { return }
            models = try ProviderModelList.validated(response.items)
            modelsLoaded = true
            showModels = true
            if models.isEmpty { notice = "接口没有返回模型，可直接手动填写模型名称。" }
        } catch {
            guard !Task.isCancelled, requestTicket == ticket else { return }
            self.error = error.localizedDescription
        }
    }

    func test() async {
        guard canTest else { return }
        operation = .test; error = nil; notice = nil; testPassed = false
        defer { operation = nil }
        do {
            let result: JSONValue = try await api.request("/ai/test", method: "POST")
            try Task.checkCancellation()
            guard result["ok"].boolValue == true else { throw AssistantProtocolError.invalidSnapshot }
            testPassed = true
            notice = "已保存配置的连接测试通过。"
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    func chooseModel(_ model: String) { draft.model = model; showModels = false }
}
