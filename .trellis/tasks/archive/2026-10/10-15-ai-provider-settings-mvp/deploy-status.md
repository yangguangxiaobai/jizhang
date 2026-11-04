# Conversation follow-up deployment — 2026-10-15

User approved deployment and APK installation explicitly. Backend is deployed; APK installation is blocked by the device being absent from ADB (two checks plus reconnect). Do not claim installed.

- Running image `jizhang:api-ai-chat-fix-20261015T063906Z`, ID `sha256:8648f391da315011224307ea514f594e399148886e97b21d3f9ad3b0d79768a6`, healthy, started `2026-10-15T06:40:39Z`.
- Source bundle allowlist 96 files verified. Relative to prior deployed source bundle only three runtime source files differ: routes/assistant.ts, assistant-types.ts and assistant-conversation-service.ts.
- Public health status ok; root JSON 404 verified. Compiled failed-progress contract and safe error mapping markers verified in actual running image.
- Deployment before/after manifests: integrity ok, all 20 tables identical, no changed tables. Effective environment, topology/volume and protected production config unchanged except image override; Caddy/cutout/Komari IDs/images/start times unchanged.
- Protected rollback configs/image and consistent CLI-verified snapshot: `/opt/jizhang-backups/ai-chat-fix-20261015T063906Z/`. Snapshot `database/jizhang-2026-10-15T06-39-45-472.db` SHA256 `a134febab4d31989c0df8126e9a4e9b14e1a2333c665ef8f8c404b0932ef5774` matches off-server copy under ignored `artifacts/backups/ai-chat-fix-20261015T063906Z/`. Off-server isolated in-memory SQLite backup/restore and integrity check passed.
- APK awaiting device: `clients/android/app/build/outputs/apk/debug/app-debug.apk`, SHA256 `dd3a50a9ded90eba2b0137701ebd68f8f967a3b1471bda2e0ccaf303a0c70eb7`.
- No provider request or ledger confirmation during deployment. Existing 20-second real-conversation timeout is NOT resolved by error/presentation deployment. No model/timeout/credential changes, backup deletion or timer activation.

## Installation completed after direct USB reconnect
Device TNL0220A15028072 became visible after user bypassed the hub. `adb install -r` returned Success. Installed public base.apk was read back and SHA256 matched the built APK exactly: dd3a50a9ded90eba2b0137701ebd68f8f967a3b1471bda2e0ccaf303a0c70eb7. Installation verified; conversation runtime/timeout acceptance remains separate. No driver changes or ledger confirmations.
