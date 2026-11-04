# Deployment and installation authorization

User now explicitly requested 完成部署和安装 on 2026-10-17 after local gates passed. This supersedes prior no-deploy/no-install statements ONLY for deployment of the verified merged-import backend and data-preserving installation of the verified Android APK. Existing task remains in_progress; no new task required.

Authorized: production API image build/switch, additive migration012 with consistent off-server backup and isolated rehearsal, health/auth/API-only/data/config/topology verification; adb install -r on the previously used authorized device, installed-byte verification and non-writing launch smoke. Existing Docker build dependencies via frozen repository build are part of deployment, not permission for unrelated local dependency/environment changes.

Not authorized: real financial confirmation, master-data changes, private bill export/provider requests for acceptance, model/secret/timeout settings changes, app data clearing/uninstall, unrelated infrastructure/container recreation, backup cleanup/retention activation, Git staging/commit/archive. Production credentials/env must remain private; compare effective values without printing. Preserve existing volume, accounts/categories/ledger and unrelated services. No automatic database restore over subsequent writes.
