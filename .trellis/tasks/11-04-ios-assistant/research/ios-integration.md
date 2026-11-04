# iOS implementation integration contract

The reviewed task is active. User added GitHub macOS compilation and local Sideloadly installation. Parent owns Xcode project generation, CI, Git operations, build repair, docs and device handoff. Three implementation scopes may work independently under the explicit Phase 2.1 sub-agent instruction. Do not spawn further agents or commit/push from workers.

## Shared API owned by core worker

- `@MainActor final class APIClient: ObservableObject`
- `let identity: UUID` and `let baseURL: URL`; each authenticated/server session has a fresh identity. Parent app uses `.id(api.identity)` to discard old feature state.
- `func request<Response: Decodable>(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> Response`
- `func stream(_ path: String) async throws -> URLSession.AsyncBytes` (validate HTTP status and origin; errors use APIError). Path is relative to `/api/v1`, e.g. `/assistant/conversations`.
- `func invalidate()` cancels owned session requests; unauthorized callback must invalidate only the owning session.
- `enum JSONValue: Codable, Equatable, Sendable` cases `object([String: JSONValue])`, `array([JSONValue])`, `string(String)`, `integer(Int64)`, `number(Double)`, `bool(Bool)`, `null`.
- Read-only accessors `stringValue: String?`, `intValue: Int64?`, `doubleValue: Double?`, `boolValue: Bool?`, `arrayValue: [JSONValue]?`, `objectValue: [String: JSONValue]?`; `subscript(_ key: String) -> JSONValue` returns `.null` for an absent key.
- APIError conforms to LocalizedError and provides a safe Chinese error description. Never log secrets.

Use typed DTOs where the feature contract is stable. JSONValue is the single flexible boundary for heterogeneous assistant card/config data, not permission to render raw dumps or silently assume successful decoding.

## Views owned by feature workers

The shell places each root in a NavigationStack. Feature roots must not add a second stack.

- Assistant worker: `AssistantView(api: APIClient)` and `ProviderSettingsView(api: APIClient)`.
- Read-only worker: `HomeView(api: APIClient)`, `BillsView(api: APIClient)`, `PlanView(api: APIClient)`, `MyView(api: APIClient, onLogout: @escaping () -> Void)`.
- My may navigate to `ProviderSettingsView(api:)`; all feature views receive the same session-owned APIClient.
- Prefix file-private helper/component names by feature where necessary to avoid collisions. Core owns `AppTheme.accent: Color` for a calm emerald tint; use semantic system backgrounds, native typography and generous mobile spacing.

## Files and build

- Core worker owns `clients/ios/Jizhang/Core/**`, `clients/ios/Jizhang/App/**`, and `clients/ios/JizhangTests/Core*`.
- Assistant worker owns `clients/ios/Jizhang/Features/Assistant/**`, `Features/Settings/**`, `JizhangTests/Assistant*`, `JizhangTests/Provider*`.
- Read-only worker owns `clients/ios/Jizhang/Features/Home/**`, `Bills/**`, `Plan/**`, `My/**`, `JizhangTests/Ledger*`.
- Main app module name is `Jizhang`; tests use XCTest with `@testable import Jizhang`.
- Root owns project/plist/assets/workflow/scripts/docs. Swift language mode 5, deployment iOS 17. Avoid Swift 6-only APIs, third-party packages and code-generation dependencies.
- Current host cannot compile SwiftUI. Report source review honestly; root will run actual Apple compilation/tests on GitHub and send failures for repair.
