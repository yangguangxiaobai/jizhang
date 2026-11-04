import SwiftUI

@MainActor final class LedgerBillsStore: ObservableObject {
    @Published private(set) var items: [LedgerTransaction] = []
    @Published private(set) var metadata = LedgerMetadata.empty
    @Published private(set) var total = 0
    @Published private(set) var loading = false
    @Published private(set) var loadingMore = false
    @Published private(set) var hasLoaded = false
    @Published private(set) var error: String?
    private var generation = 0
    private var loadedQuery: LedgerBillQuery?
    private var revision: String?
    private let pageSize = 50

    func prepare(query: LedgerBillQuery) {
        guard loadedQuery != query else { return }
        generation += 1
        loadedQuery = query
        items = []
        total = 0
        hasLoaded = false
        error = nil
        loading = true
        loadingMore = false
    }

    func reload(api: APIClient, query: LedgerBillQuery) async {
        generation += 1
        let ticket = generation
        if loadedQuery != query { items = []; total = 0; hasLoaded = false }
        loadedQuery = query
        loading = true
        loadingMore = false
        error = nil
        defer { if generation == ticket { loading = false } }
        do {
            let page: LedgerTransactionPage = try await api.request(query.path(limit: pageSize))
            try page.validate(expectedOffset: 0, expectedLimit: pageSize)
            let metadata = try await LedgerMetadata.load(api: api)
            guard generation == ticket, !Task.isCancelled else { return }
            self.metadata = metadata
            items = page.items
            total = page.total
            revision = page.searchRevision
            hasLoaded = true
        } catch {
            guard generation == ticket, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    func next(api: APIClient) async {
        guard let query = loadedQuery, !loading, !loadingMore, items.count < total else { return }
        let ticket = generation
        let offset = items.count
        loadingMore = true
        error = nil
        defer { if generation == ticket { loadingMore = false } }
        do {
            let page: LedgerTransactionPage = try await api.request(query.path(offset: offset, limit: pageSize))
            try page.validate(expectedOffset: offset, expectedLimit: pageSize)
            guard generation == ticket, !Task.isCancelled else { return }
            guard page.total == total, page.searchRevision == revision,
                  !page.items.isEmpty,
                  Set(items.map(\.id)).isDisjoint(with: Set(page.items.map(\.id))) else {
                throw LedgerDataError.changedPage
            }
            items.append(contentsOf: page.items)
        } catch {
            guard generation == ticket, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

struct LedgerTransactionPage: Decodable {
    let items: [LedgerTransaction]
    let total: Int
    let limit: Int
    let offset: Int
    let searchRevision: String?

    func validate(expectedOffset: Int, expectedLimit: Int) throws {
        guard offset == expectedOffset, limit == expectedLimit, total >= 0,
              offset >= 0, offset <= total, items.count <= limit, items.count <= total - offset,
              Set(items.map(\.id)).count == items.count else { throw LedgerDataError.invalidResponse }
    }
}

@MainActor struct BillsView: View {
    let api: APIClient
    @State private var query: LedgerBillQuery
    @StateObject private var store = LedgerBillsStore()

    init(api: APIClient, initialQuery: LedgerBillQuery = LedgerBillQuery()) {
        self.api = api
        _query = State(initialValue: initialQuery)
    }

    private var grouped: [(String, [LedgerTransaction])] {
        let groups = Dictionary(grouping: store.items) { LedgerFormat.dayKey($0.date) }
        return groups.keys.sorted(by: >).map { ($0, groups[$0] ?? []) }
    }

    var body: some View {
        List {
            Section {
                Picker("收支类型", selection: Binding(get: { query.type ?? -1 }, set: { query.type = $0 == -1 ? nil : $0 })) {
                    Text("全部").tag(-1)
                    Text("支出").tag(0)
                    Text("收入").tag(1)
                }.pickerStyle(.segmented)
                if query.accountId != nil || query.categoryId != nil || query.tag != nil {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            if let id = query.accountId { Text("账户：" + store.metadata.accountName(id)) }
                            if let id = query.categoryId { Text("分类：" + store.metadata.categoryName(id)) }
                            if let tag = query.tag { Text("标签：" + tag) }
                        }.font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("清除筛选") { query.accountId = nil; query.categoryId = nil; query.tag = nil }
                            .font(.caption)
                    }
                }
            }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

            if store.loading && !store.hasLoaded {
                LedgerLoadingView(title: "正在读取账单…").listRowBackground(Color.clear)
            }
            if let error = store.error {
                LedgerErrorView(message: error, showingPrevious: !store.items.isEmpty) {
                    Task { await store.reload(api: api, query: query) }
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            if store.hasLoaded && store.items.isEmpty && !store.loading {
                LedgerEmptyView(title: "没有找到相关账单", message: "可以更换关键词或筛选条件。", symbol: "doc.text.magnifyingglass")
                    .listRowBackground(Color.clear)
            }
            ForEach(grouped, id: \.0) { day, transactions in
                Section(day) {
                    ForEach(transactions) { transaction in
                        NavigationLink {
                            LedgerBillDetailView(api: api, transactionID: transaction.id, metadata: store.metadata)
                        } label: {
                            LedgerTransactionRow(transaction: transaction, metadata: store.metadata)
                        }
                    }
                }
            }
            if store.hasLoaded && !store.items.isEmpty {
                Section {
                    if store.items.count < store.total {
                        Button {
                            Task { await store.next(api: api) }
                        } label: {
                            HStack {
                                Spacer()
                                if store.loadingMore { ProgressView() } else { Text("加载更多") }
                                Spacer()
                            }
                        }.disabled(store.loading || store.loadingMore)
                    }
                    Text("已显示 \(store.items.count) / \(store.total) 笔")
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }.listRowBackground(Color.clear)
            }
        }
        .navigationTitle("账单")
        .searchable(text: $query.text, prompt: "搜索备注、分类或标签")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("全部账户") { query.accountId = nil }
                    ForEach(store.metadata.accounts) { account in
                        Button(account.name) { query.accountId = account.id }
                    }
                } label: {
                    Image(systemName: query.accountId == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }.accessibilityLabel("按账户筛选")
            }
        }
        .task(id: query) {
            store.prepare(query: query)
            if !query.text.isEmpty {
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            }
            await store.reload(api: api, query: query)
        }
        .refreshable { await store.reload(api: api, query: query) }
    }
}

@MainActor struct LedgerBillDetailView: View {
    let api: APIClient
    let transactionID: String
    let metadata: LedgerMetadata
    @StateObject private var resource = LedgerResource<LedgerTransaction>()

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let value = resource.value {
                    LedgerBillDetailContent(transaction: value, metadata: metadata)
                    if let details = value.refundDetails, !details.isEmpty {
                        LedgerCard {
                            LedgerSectionHeading(title: "关联退款")
                            ForEach(details) { detail in
                                NavigationLink {
                                    LedgerBillDetailView(api: api, transactionID: detail.id, metadata: metadata)
                                } label: {
                                    HStack {
                                        Text(LedgerFormat.date(detail.date)).font(.subheadline)
                                        Spacer()
                                        Text("+" + LedgerFormat.money(detail.amountCents)).monospacedDigit().foregroundStyle(AppTheme.accent)
                                        Image(systemName: "chevron.right").font(.caption)
                                    }
                                }
                            }
                        }
                    }
                    if let originalIDs = value.refundLinkedTxIds, !originalIDs.isEmpty {
                        LedgerCard {
                            LedgerSectionHeading(title: "原始支出")
                            ForEach(Array(originalIDs.enumerated()), id: \.element) { index, id in
                                NavigationLink("查看原始账单 \(index + 1)") {
                                    LedgerBillDetailView(api: api, transactionID: id, metadata: metadata)
                                }
                            }
                        }
                    }
                } else if resource.loading { LedgerLoadingView() }
                if let error = resource.error {
                    LedgerErrorView(message: error, showingPrevious: resource.value != nil) { Task { await load() } }
                }
            }.padding(20)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("账单详情").navigationBarTitleDisplayMode(.inline)
        .task(id: transactionID) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        await resource.load { try await api.request("/transactions/" + LedgerURL.segment(transactionID)) }
    }
}

struct LedgerBillDetailContent: View {
    let transaction: LedgerTransaction
    let metadata: LedgerMetadata
    var body: some View {
        VStack(spacing: 20) {
            LedgerCard {
                VStack(spacing: 12) {
                    LedgerSymbol(name: transaction.isRefund ? "arrow.uturn.backward" : (transaction.type == .income ? "arrow.down.left" : "arrow.up.right"))
                    Text(transaction.kindTitle).font(.subheadline).foregroundStyle(.secondary)
                    Text(transaction.sign + LedgerFormat.money(transaction.amountCents))
                        .font(.system(.largeTitle, design: .rounded).weight(.semibold)).monospacedDigit()
                        .foregroundStyle(transaction.type == .income ? AppTheme.accent : Color.primary)
                        .minimumScaleFactor(0.6).lineLimit(1)
                }.frame(maxWidth: .infinity).padding(.vertical, 14)
            }
            LedgerCard {
                LedgerFieldRow(title: "分类", value: metadata.categoryName(transaction.categoryId))
                Divider()
                LedgerFieldRow(title: "账户", value: metadata.accountName(transaction.accountId))
                Divider()
                LedgerFieldRow(title: "日期", value: LedgerFormat.date(transaction.date, time: true))
                Divider()
                LedgerFieldRow(title: "资金用途", value: transaction.fundPurpose?.title ?? "尚未归类")
                if !transaction.note.isEmpty {
                    Divider()
                    LedgerFieldRow(title: "备注", value: transaction.note)
                }
                if !transaction.tags.isEmpty {
                    Divider()
                    LedgerFieldRow(title: "标签", value: transaction.tags.joined(separator: " · "))
                }
                if let refund = transaction.refundSummary, refund.refundCount > 0 {
                    Divider()
                    LedgerFieldRow(title: "关联退款合计", value: LedgerFormat.money(refund.totalRefundCents))
                    Text("普通收支中，退款单独计入收入，原支出金额保持不变。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}
