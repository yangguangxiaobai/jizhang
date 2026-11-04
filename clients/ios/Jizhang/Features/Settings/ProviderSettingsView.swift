import SwiftUI

struct ProviderSettingsView: View {
    @StateObject private var store: ProviderSettingsStore
    @State private var revealSecret = false
    @State private var advanced = false
    @State private var clearKeyConfirmation = false

    init(api: APIClient) { _store = StateObject(wrappedValue: ProviderSettingsStore(api: api)) }

    var body: some View {
        Form {
            if let saved = store.saved {
                statusSection(saved)
                connectionSection(saved)
                if let error = store.error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.subheadline).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let notice = store.notice {
                    Section {
                        Label(notice, systemImage: "checkmark.circle")
                            .font(.subheadline).foregroundStyle(AppTheme.accent).fixedSize(horizontal: false, vertical: true)
                    }
                }
                advancedSection(saved)
            } else if store.operation == .load {
                Section { HStack { ProgressView(); Text("正在读取已保存配置…").foregroundStyle(.secondary) }.padding(.vertical, 16) }
            } else {
                Section {
                    AssistantNotice(message: store.error ?? "读取配置后即可开始设置。", buttonTitle: "重新读取") { Task { await store.load() } }
                }
            }
        }
        .navigationTitle("AI 配置")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        .sheet(isPresented: $store.showModels) { modelPicker }
        .confirmationDialog("清除保存的 API Key？", isPresented: $clearKeyConfirmation, titleVisibility: .visible) {
            Button("标记为清除", role: .destructive) { store.draft.clearSecret = true; store.draft.secret = "" }
            Button("取消", role: .cancel) {}
        } message: { Text("点击保存后生效。需要密钥的接口将暂时无法使用。") }
        .task { if store.saved == nil { await store.load() } }
    }

    private func statusSection(_ saved: ProviderConfiguration) -> some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: store.testPassed ? "checkmark.shield" : "sparkles")
                    .font(.title2).foregroundStyle(AppTheme.accent)
                    .frame(width: 43, height: 43).background(AppTheme.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 5) {
                    Text(store.statusLabel).font(.headline)
                    Text(saved.model.isEmpty ? "填好三项，开始和账本对话。" : saved.model)
                        .font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                    if store.dirty && saved.configured { Text("有尚未保存的修改").font(.caption).foregroundStyle(.orange) }
                }
                Spacer(minLength: 0)
            }.padding(.vertical, 6)
        }
    }

    private func connectionSection(_ saved: ProviderConfiguration) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("服务地址", systemImage: "network").font(.subheadline.weight(.medium))
                TextField("https://api.example.com", text: $store.draft.url)
                    .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.body).accessibilityLabel("AI 服务地址")
            }.padding(.vertical, 5)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("API Key", systemImage: "key").font(.subheadline.weight(.medium))
                    Spacer()
                    if store.draft.clearSecret { Text("保存后清除").font(.caption).foregroundStyle(.orange) }
                    else if saved.hasSecret { Text("已保存").font(.caption).foregroundStyle(AppTheme.accent) }
                }
                HStack {
                    Group {
                        if revealSecret { TextField(saved.hasSecret ? "留空保留原密钥" : "粘贴 API Key", text: $store.draft.secret) }
                        else { SecureField(saved.hasSecret ? "留空保留原密钥" : "粘贴 API Key", text: $store.draft.secret) }
                    }
                    .textInputAutocapitalization(.never).autocorrectionDisabled().privacySensitive()
                    .accessibilityLabel("API Key")
                    Button { revealSecret.toggle() } label: { Image(systemName: revealSecret ? "eye.slash" : "eye") }
                        .buttonStyle(.plain).frame(width: 44, height: 36)
                        .accessibilityLabel(revealSecret ? "隐藏密钥" : "显示输入的密钥")
                }
                if !saved.encryptionKeyConfigured {
                    Text("服务器还未配置密钥加密，暂时无法保存 API Key。")
                        .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
            }.padding(.vertical, 5)
            VStack(alignment: .leading, spacing: 8) {
                Label("模型", systemImage: "cpu").font(.subheadline.weight(.medium))
                HStack {
                    TextField("填写模型名称", text: $store.draft.model)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityLabel("模型名称")
                    if store.modelsLoaded {
                        Button("选择") { store.showModels = true }.buttonStyle(.borderless).frame(minHeight: 36)
                    }
                }
            }.padding(.vertical, 5)
            if store.draft.mode != "custom" {
                Button { Task { await store.fetchModels() } } label: {
                    HStack(spacing: 8) {
                        if store.operation == .models { ProgressView().controlSize(.small) }
                        else { Image(systemName: "list.bullet.rectangle") }
                        Text(discoveryTitle).font(.subheadline)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    }.frame(minHeight: 30)
                }
            }
        } header: { Text("连接设置") } footer: {
            Text(store.draft.mode == "custom" ? "自定义接口请手动填写模型名称。" : "支持常用兼容接口。可直接输入模型，或从接口获取后选择。")
        }
        .disabled(store.busy)
        .onChange(of: store.draft.secret) { _, value in if !value.isEmpty && store.draft.clearSecret { store.draft.clearSecret = false } }
    }

    private var discoveryTitle: String {
        if store.operation == .models { return "正在获取模型…" }
        if store.connectionSaved { return store.modelsLoaded ? "刷新可用模型" : "获取可用模型" }
        return store.needsBootstrap ? "保存连接并选择模型" : "保存修改并获取模型"
    }

    private func advancedSection(_ saved: ProviderConfiguration) -> some View {
        Section {
            DisclosureGroup(isExpanded: $advanced) {
                Toggle("启用 AI", isOn: $store.draft.enabled).tint(AppTheme.accent)
                Picker("接口协议", selection: $store.draft.mode) {
                    Text("Chat Completions").tag("chat-completions")
                    Text("Responses").tag("responses")
                    Text("自定义").tag("custom")
                }
                .onChange(of: store.draft.mode) { old, new in
                    store.draft.applyModeDefaults(from: old)
                }
                Picker("认证方式", selection: $store.draft.authKind) {
                    Text("Bearer Token").tag("bearer")
                    Text("自定义请求头").tag("header")
                    Text("无需认证").tag("none")
                }
                if store.draft.authKind == "header" {
                    TextField("认证头名称，例如 x-api-key", text: $store.draft.headerName)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                TextField("配置名称（可选）", text: $store.draft.name)
                HStack {
                    Text("超时（秒）")
                    Spacer()
                    TextField("20", text: $store.draft.timeoutSeconds).keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing).frame(maxWidth: 110).accessibilityLabel("超时秒数")
                }
                if store.draft.mode == "custom" {
                    Picker("请求方法", selection: $store.draft.method) {
                        ForEach(["GET", "POST", "PUT", "PATCH"], id: \.self) { Text($0).tag($0) }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("请求体模板").font(.subheadline)
                        TextEditor(text: $store.draft.bodyTemplate).font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 100).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityLabel("自定义 JSON 请求体模板")
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("响应字段路径").font(.subheadline)
                    TextField("choices[0].message.content", text: $store.draft.responsePath)
                        .font(.footnote).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("额外请求头（JSON）").font(.subheadline)
                    TextEditor(text: $store.draft.headersText).font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 80).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("额外请求头 JSON")
                }
                if saved.hasSecret {
                    Button(store.draft.clearSecret ? "撤销密钥清除" : "清除已保存密钥", role: store.draft.clearSecret ? nil : .destructive) {
                        if store.draft.clearSecret { store.draft.clearSecret = false }
                        else { clearKeyConfirmation = true }
                    }
                }
            } label: {
                Label("高级设置", systemImage: "slider.horizontal.3").font(.subheadline)
            }
        } footer: {
            if advanced { Text("高级设置会随保存一起生效。密钥只保存在服务器，手机不会读取已保存的密钥。") }
        }.disabled(store.busy)
    }

    private var actionBar: some View {
        VStack(spacing: 7) {
            HStack(spacing: 12) {
                Button { Task { await store.test() } } label: {
                    HStack(spacing: 6) {
                        if store.operation == .test { ProgressView().controlSize(.small) }
                        Text("测试连接")
                    }.frame(minHeight: 34)
                }.buttonStyle(.bordered).disabled(!store.canTest)
                Button { Task { await store.save() } } label: {
                    HStack(spacing: 7) {
                        if store.operation == .save { ProgressView().tint(.white) }
                        Text(store.draft.enabled && store.saved?.enabled != true ? "保存并启用" : "保存")
                    }.font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 34)
                }.buttonStyle(.borderedProminent).tint(AppTheme.accent)
                    .disabled(store.saved == nil || store.busy || !store.dirty)
            }
            Text(store.dirty ? "保存修改后可测试连接。" : "测试使用已保存配置，会向服务商发送一次请求。")
                .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.horizontal, 16).padding(.vertical, 12).background(.bar)
    }

    private var modelPicker: some View {
        ProviderModelPicker(models: store.models, selection: store.draft.model) { store.chooseModel($0) }
    }
}

private struct ProviderModelPicker: View {
    let models: [ProviderModel]
    let selection: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    private var filtered: [ProviderModel] { models.filter { search.isEmpty || $0.id.localizedCaseInsensitiveContains(search) } }
    var body: some View {
        NavigationStack {
            List {
                if models.isEmpty {
                    ContentUnavailableView("没有可用模型列表", systemImage: "cpu", description: Text("接口未返回模型。关闭后可手动填写模型名称。"))
                } else if filtered.isEmpty {
                    ContentUnavailableView.search(text: search)
                } else {
                    Section {
                        ForEach(filtered) { model in
                            Button { onSelect(model.id); dismiss() } label: {
                                HStack(spacing: 12) {
                                    Text(model.id).font(.body).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                    if model.id == selection { Image(systemName: "checkmark").foregroundStyle(AppTheme.accent) }
                                }.frame(minHeight: 36).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    } footer: { Text("选择仅修改草稿，返回后点击保存生效。接口列出的模型不一定都支持聊天。") }
                }
            }
            .navigationTitle("选择模型").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "搜索模型名称")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }.presentationDetents([.large])
    }
}
