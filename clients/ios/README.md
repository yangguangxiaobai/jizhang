# Jizhang for iPhone

Native SwiftUI client for iOS 17 and later. It uses the same authenticated Fastify API as Android. The first delivery prioritizes AI conversation presentation and compact provider configuration; the other accounting domains are read-only.

## Build and install from Windows

The GitHub workflow [iOS build and IPA](../../.github/workflows/ios.yml) uses a macOS 15 runner with Xcode 16.4. It runs XCTest on an available iPhone simulator, builds the device app for arm64, and packages an unsigned IPA. Apple ID credentials and signing certificates are not required by CI.

1. Push the iOS source and workflow to your GitHub repository. The workflow runs on iOS changes; it also supports manual dispatch.
2. Wait for a successful run. Download its `Jizhang-ios-<run number>` artifact, containing `Jizhang-unsigned.ipa`, `SHA256SUMS.txt`, `build-metadata.json`, and a real simulator launch screenshot.
3. Or use the PowerShell helper with the exact successful run ID:

   ```powershell
   .\clients\ios\scripts\download-ipa.ps1 -RunId <run-id> -Repository <owner>/jizhang
   ```

   It verifies both the IPA checksum and the artifact's commit against the selected run.

4. Open the IPA in [Sideloadly](https://sideloadly.io/), select your connected iPhone and use your Apple ID locally to sign/install. On this workstation, the existing application is `D:\Sideloadly\Sideloadly.exe`.
5. Complete any iPhone trust or Developer Mode prompt. Keep the app's bundle identifier stable when updating so iOS can retain its local session. The server remains the authoritative store for accounting data.

Sideloadly documents device trust, Developer Mode and signing renewal in its [official FAQ](https://sideloadly.io/faq). A free account's signing expires after seven days; its automatic refresh feature requires the computer to reach the device. Installation is separate from a successful GitHub build.

## Local Mac build

No CocoaPods, XcodeGen or third-party Swift packages are required. Open `Jizhang.xcodeproj`, choose the `Jizhang` scheme and an iPhone simulator. Add your own signing team only when installing directly from Xcode.

The project is checked in and generated deterministically. After adding/removing Swift files:

```sh
python3 scripts/generate_project.py
xcodebuild -project Jizhang.xcodeproj -scheme Jizhang -sdk iphonesimulator \
  -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

Run the same build/test/package sequence as Actions:

```sh
bash scripts/ci-build.sh
```

The generated project contains app and XCTest targets. The script selects a simulator compatible with the selected Xcode SDK rather than assuming a particular device UUID. Native build output stays in the ignored `build/` directory.

## First-delivery feature inventory

| Area | Intended behavior | Boundary |
|---|---|---|
| Login/session | Configurable HTTPS server, login, verified session restoration, logout | Cookie credentials in server-scoped Keychain storage; server switch isolates requests |
| Navigation | Home, Bills, Plan, Assistant, My | iPhone native navigation, safe areas and system appearance |
| Conversations | Full-width history, title search/date groups, creation, selection, archive | Stable server IDs, no narrow fixed-width cards |
| Chat | Text generation, real streaming where supported, Stop, clarification, history and reconnect | Pending accounting actions are readable previews, not executable ledger writes in this delivery |
| AI configuration | Address/key/model, searchable model picker/manual entry, explicit save/test | Advanced fields folded; blank key preserves saved credential; no automatic inference |
| Accounting screens | Server-backed home, bills/details, current funds/plans, stats and My domain lists | Read-only; no duplicated accounting calculations |
| Data tools | Availability information for import/backup/organization | Execution deferred; no simulated successful operations |

The current plan surface follows the backend's continuous four-purpose fund contracts. Cumulative balances are not presented as a monthly reset. Ordinary income/expense views retain their server-defined refund treatment.

## Contracts

- API paths remain under `/api/v1`; mutations require `X-Requested-With: fetch`.
- Session cookie is `jizhang_session`. A restored username does not establish authentication; `/auth/me` must succeed.
- Money uses integer cents and timestamps use epoch milliseconds. Server results own balances, totals and financial windows.
- AI secrets remain encrypted server-side. Model discovery uses saved configuration; the phone never receives an existing plaintext key.
- Same-draft retries keep their request ID. A disconnect reconciles the same generation; it does not automatically create another model request.
- Drafts, messages and in-flight work belong to a server/session/conversation identity. Changing server or expiring a session cannot publish into a newer one.
- Generated previews do not confirm ledger changes. A reply being complete does not mean money was recorded.

## Verification record

Native compilation, XCTest, simulator launch and device installation are recorded separately in the task delivery evidence. A Windows source review alone is not a build. Live-provider behavior also requires a configured backend and explicit interaction.

Initial implementation and verification are tracked in [the iOS task](../../.trellis/tasks/11-04-ios-assistant/implement.md). No production API deployment is included in this client delivery.

The app icon reuses the existing Android brand artwork, converted to the iOS asset-catalog size; no new brand is introduced.
